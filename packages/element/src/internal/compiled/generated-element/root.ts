/**
 * M09-shadow — root resolution for the generated-element shell.
 *
 * This module owns the ONE mapping from the compiler-private `RootMode` fact
 * (`light | shadow-open | shadow-closed`) to a real DOM claim/mount parent, and
 * the coded failures around it. It is a browser-safe leaf: it imports only the
 * protocol error dialect and the protocol `RootMode` type, never the old
 * runtime kernel, the server serializer or any executor.
 *
 * The platform facts it relies on are deliberately small:
 *
 * - `host.shadowRoot` is the only open-root discovery channel;
 * - a closed declarative root is discoverable only through
 *   `ElementInternals.shadowRoot`, and `attachInternals()` can be called once
 *   per element. A host whose internals were already attached therefore has no
 *   discovery channel left. This module fails closed instead of calling
 *   `attachShadow()` to guess: on an existing imperative root or a
 *   different-mode declarative root the platform throws `NotSupportedError`,
 *   while on a same-mode declarative root `attachShadow()` SUCCEEDS by clearing
 *   that root's children. Neither outcome is safe discovery, so the shell never
 *   uses it as one.
 * - `attachShadow()` is the only creation path. Its platform throw is wrapped
 *   with the original error as `cause`.
 *
 * The resolved root is returned to the shell and retained on the element state;
 * this module never caches or discovers a second root. Closed-root internals are
 * handed to the caller's single discovery record at the moment they are
 * attached, so a retry reuses that one owner instead of attaching again.
 *
 * @module ./root.ts
 */

import { frameworkError } from '@openelement/protocol/errors';
import type { RootMode } from '@openelement/protocol/part-program';

/** Light descriptor on a host that already owns a shadow root. */
export const SHELL_ROOT_MODE_MISMATCH = 'OEIR_SHELL_ROOT_MODE_MISMATCH';
/** `mode` or `delegatesFocus` differs from the existing root. */
export const SHELL_ROOT_OPTION_MISMATCH = 'OEIR_SHELL_ROOT_OPTION_MISMATCH';
/** `attachShadow()` threw on the platform. */
export const SHELL_ATTACH_SHADOW_FAILED = 'OEIR_SHELL_ATTACH_SHADOW_FAILED';
/** A `template[shadowrootmode]` child the parser did not adopt. */
export const SHELL_DSD_NOT_ADOPTED = 'OEIR_SHELL_DSD_NOT_ADOPTED';
/** A closed root cannot be discovered (no/consumed/unusable internals). */
export const SHELL_CLOSED_ROOT_UNREACHABLE = 'OEIR_SHELL_CLOSED_ROOT_UNREACHABLE';

/** The resolved root kind, in the platform's spelling (not the author's mode). */
export type GeneratedRootKind = 'light' | 'open' | 'closed';

/** One resolved root. Light uses the host; shadow modes use a ShadowRoot. */
export interface ResolvedGeneratedRoot {
  readonly kind: GeneratedRootKind;
  readonly root: HTMLElement | ShadowRoot;
  /** True only when this resolution created the root via `attachShadow()`. */
  readonly created: boolean;
}

/**
 * The caller-owned closed-root discovery record. The shell is the single owner:
 * once `attachInternals()` succeeds the instance is stored here and reused for
 * every later resolution, so a retry cannot consume the one-shot channel again
 * or misreport the shell's own earlier attachment as another subsystem's.
 */
export interface ElementInternalsRecord {
  internals: ElementInternals | null;
}

/**
 * Backward-compatible internal alias for the former closed-root-only record.
 * The record is now the ONE element-lifetime `ElementInternals` owner shared by
 * closed-root discovery and form association (M09-2d).
 */
export type ClosedRootDiscovery = ElementInternalsRecord;

function fail(code: string, message: string, cause?: Error): never {
  throw frameworkError(code, `[generated-element] ${message}`, {
    phase: 'csr',
    ...(cause === undefined ? {} : { cause }),
  });
}

/** Map the compiler-private mode to the platform root kind. */
export function generatedRootKind(mode: RootMode | undefined): GeneratedRootKind {
  if (mode === undefined || mode === 'light') return 'light';
  if (mode === 'shadow-open') return 'open';
  if (mode === 'shadow-closed') return 'closed';
  return fail(SHELL_ROOT_MODE_MISMATCH, `unknown root mode ${JSON.stringify(mode)}`);
}

/**
 * A declarative shadow host that was parsed without the platform's DSD path
 * keeps its `template[shadowrootmode]` as a light child. Attaching a shadow
 * root there would create an empty tree beside inert server markup, so the
 * shell fails closed before any attach. The check is deliberately shallow:
 * only a DIRECT child can be a declarative shadow root.
 */
function hasUnadoptedDsdTemplate(host: HTMLElement): boolean {
  for (let child = host.firstElementChild; child !== null; child = child.nextElementSibling) {
    if (
      child.localName === 'template' &&
      child.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
      child.hasAttribute('shadowrootmode')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validate an already-resolved existing root against the descriptor. The shell
 * caches the root first and then calls this, so a mismatch is re-reported with
 * the same identity on every retry instead of being lost with the failed
 * resolution attempt. Newly attached roots already carry these options.
 */
export function assertGeneratedRootOptions(
  root: ShadowRoot,
  kind: 'open' | 'closed',
  delegatesFocus: boolean,
): void {
  if (root.mode !== kind) {
    fail(
      SHELL_ROOT_MODE_MISMATCH,
      `descriptor requests a ${kind} root but the existing root is ${root.mode}`,
    );
  }
  const actual = root.delegatesFocus === true;
  if (actual !== delegatesFocus) {
    fail(
      SHELL_ROOT_OPTION_MISMATCH,
      `delegatesFocus mismatch: descriptor ${String(delegatesFocus)}, existing root ${String(actual)}`,
    );
  }
}

function attachRoot(
  host: HTMLElement,
  mode: 'open' | 'closed',
  delegatesFocus: boolean,
): ShadowRoot {
  try {
    return host.attachShadow({ mode, delegatesFocus });
  } catch (error) {
    return fail(
      SHELL_ATTACH_SHADOW_FAILED,
      `attachShadow({ mode: ${JSON.stringify(mode)} }) failed`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/**
 * Read the closed root from an internals instance. A platform without the
 * `shadowRoot` accessor has no discovery channel; this failure is cached by the
 * caller's discovery record and re-reported unchanged on retry.
 */
function closedRootFrom(internals: ElementInternals): ShadowRoot | null {
  if (!('shadowRoot' in internals)) {
    return fail(
      SHELL_CLOSED_ROOT_UNREACHABLE,
      'ElementInternals.shadowRoot is unavailable, so an existing closed root cannot be distinguished from none',
    );
  }
  return internals.shadowRoot;
}

/**
 * Discover the element's closed root through its own internals. The caller has
 * already ruled out an open root. A channel this shell attached earlier is
 * reused from `discovery`; an unavailable channel, or one attached outside
 * this shell before discovery, is unreachable because there is no second
 * `attachInternals()` and no safe `attachShadow()` fallback.
 */
function discoverClosedRoot(
  host: HTMLElement,
  discovery: ElementInternalsRecord,
): ShadowRoot | null {
  if (discovery.internals !== null) return closedRootFrom(discovery.internals);
  const attachInternals = (host as { attachInternals?: () => ElementInternals }).attachInternals;
  if (typeof attachInternals !== 'function') {
    return fail(
      SHELL_CLOSED_ROOT_UNREACHABLE,
      'closed root discovery needs ElementInternals.attachInternals(), which this platform does not provide',
    );
  }
  let internals: ElementInternals;
  try {
    internals = attachInternals.call(host);
  } catch (error) {
    return fail(
      SHELL_CLOSED_ROOT_UNREACHABLE,
      'ElementInternals were already attached outside this shell, so a closed root cannot be discovered',
      error instanceof Error ? error : new Error(String(error)),
    );
  }
  // Store the instance before reading it: the shell now owns this one-shot
  // channel, and every retry must see the same internals and the same root.
  discovery.internals = internals;
  return closedRootFrom(internals);
}

/**
 * Resolve the root for one connect. This runs BEFORE the generated recipe is
 * created, so a coded failure leaves no projection, no subscription and no
 * generated DOM write. It does not promise a zero-allocation or zero-write
 * connect: the shell has already allocated its per-connection owner and may
 * have reflected a pre-upgrade property value before this call. It never
 * clears, replaces or otherwise mutates an existing root.
 *
 * The shell calls this once per element and retains the result; a failed
 * recipe/claim after a successful resolution keeps that root for retry. An
 * existing root is returned unvalidated so the caller can record it first;
 * callers must run {@linkcode assertGeneratedRootOptions} on it. Closed
 * discovery is stored in `discovery` even when that later option check fails,
 * so the retry reports the same failure instead of re-attaching internals.
 */
export function resolveGeneratedElementRoot(
  host: HTMLElement,
  mode: RootMode | undefined,
  delegatesFocus = false,
  discovery: ElementInternalsRecord = { internals: null },
): ResolvedGeneratedRoot {
  const kind = generatedRootKind(mode);
  if (kind === 'light') {
    // A light descriptor never probes a closed root (that would consume the
    // form internals channel); it only refuses an open root it can see.
    if (host.shadowRoot !== null) {
      fail(
        SHELL_ROOT_MODE_MISMATCH,
        'light root descriptor found an existing shadow root on the host',
      );
    }
    return { kind: 'light', root: host, created: false };
  }

  if (hasUnadoptedDsdTemplate(host)) {
    fail(
      SHELL_DSD_NOT_ADOPTED,
      `a direct child template[shadowrootmode] was not adopted by the HTML parser; ` +
        `the ${kind} root cannot be claimed (use the parser's DSD path, not innerHTML)`,
    );
  }

  if (kind === 'open') {
    const existing = host.shadowRoot;
    if (existing !== null) {
      return { kind: 'open', root: existing, created: false };
    }
    return { kind: 'open', root: attachRoot(host, 'open', delegatesFocus), created: true };
  }

  // closed
  if (host.shadowRoot !== null) {
    fail(
      SHELL_ROOT_MODE_MISMATCH,
      'closed root descriptor found an existing open root on the host',
    );
  }
  const existing = discoverClosedRoot(host, discovery);
  if (existing !== null) {
    return { kind: 'closed', root: existing, created: false };
  }
  return { kind: 'closed', root: attachRoot(host, 'closed', delegatesFocus), created: true };
}
