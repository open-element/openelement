/**
 * Nested-host expansion for the generated SSR producer (alpha16 slice).
 *
 * The class lane expands a nested custom-element host because its serializer
 * walks `renderNestedElement` for every `*-*` tag. A generated element's `__ssr`
 * is a STRING BUILDER, so it had no such walk and every host inside its markup
 * stayed an unexpanded tag — which is a second island-descriptor-less element,
 * not DSD. This module is that walk's generated-lane counterpart: ONE call the
 * emitted producer makes for each dash tag, so the expansion rule stays in the
 * runtime where the class lane's already lives.
 *
 * Two properties this helper guarantees:
 *
 * - **Additive.** When the render supplies no expander (a nested render, a unit
 *   test, a module with no admitted tags) or the host declines the tag
 *   (`undefined`), the caller's own literal bytes are returned verbatim. An
 *   admission regression therefore shows up as "no DSD", never as wrong markup.
 * - **No second serializer.** It builds nothing: the host expander owns the
 *   nested markup, and the caller owns the literal fallback.
 */

import { NESTED_HOST_EXPANDER } from '@openelement/protocol/style-sheet';

/** What a nested host needs from the caller's markup, already serialized. */
export interface NestedHostRequest {
  /** The dash tag, e.g. `open-page-rail`. */
  readonly tag: string;
  /**
   * The element's evaluated attribute pairs, in authored order. The SAME values
   * the `open` string carries (evaluated once, recorded twice), so an expander
   * that seeds a nested host's props cannot disagree with the serialized bytes.
   */
  readonly attributes: ReadonlyArray<readonly [string, string]>;
  /** The element's serialized start tag (open tag plus attributes and `>`). */
  readonly open: string;
  /** The caller's already-serialized children (may be empty). */
  readonly children: string;
  /**
   * Authored-order direct child groups for light-root projection. Older emitted
   * producers omit this field and retain the one-default-slot `children` form.
   */
  readonly groups?: ReadonlyArray<readonly [slotName: string, html: string]>;
  /** True when the authored child list can project content after a later update. */
  readonly hasChildren?: boolean;
  /** The caller's literal markup for the whole element. */
  readonly fallback: string;
}

/**
 * The expander one render supplies on its host record.
 *
 * `undefined` is the explicit "this tag is not admitted here" answer; a string
 * is the expanded markup and replaces the caller's literal bytes.
 */
export type NestedHostExpander = (
  request: NestedHostRequest,
) => string | undefined | NestedHostFallback;

/**
 * A boundary-owned failure, handed back instead of a string.
 *
 * `16b-EB` (execution plan §19.2): a descendant producer that throws is owned by
 * the enclosing error boundary, so the throw must not fail the whole render. The
 * expander catches it and returns this record — the boundary's fallback BYTES
 * plus the error that caused them — and the caller decides what to render. That
 * is the same shape as the class lane's boundary reset (an error boundary renders
 * the reset output for the subtree it owns, the render continues), and the error
 * stays OBSERVABLE because it is carried out, not swallowed: the caller hands it
 * to the boundary's own `onError` handler, and with no handler registered the
 * original failure propagates (the unchanged pre-`16b-EB` behaviour).
 */
export interface NestedHostFallback {
  readonly kind: 'fallback';
  /** The boundary's fallback bytes for the failing descendant. */
  readonly html: string;
  /** The error the descendant producer threw. Never swallowed. */
  readonly error: unknown;
}

/** True for the boundary-fallback answer (a string is a normal expansion). */
export function isNestedHostFallback(value: unknown): value is NestedHostFallback {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.kind === 'fallback' && typeof record.html === 'string';
}

/**
 * The compiler-private host field carrying the expander.
 *
 * The literal lives in `@openelement/protocol` because the COMPILER emits the
 * host record that carries it (P-6): one spelling, two ends.
 */
export const NESTED_HOST_PROPERTY = NESTED_HOST_EXPANDER;

/**
 * Ask the render's host to expand one nested custom-element host, or return the
 * caller's literal markup.
 *
 * The host record is optional by construction: a generated element's `__ssr`
 * runs in renders that carry no expansion (a nested render of an un-admitted
 * tag, a direct unit call), and those must keep today's bytes rather than fail.
 */
export function nestedHost(host: unknown, request: NestedHostRequest): string {
  if (host === null || host === undefined || typeof host !== 'object') return request.fallback;
  const expander = (host as Record<string, unknown>)[NESTED_HOST_PROPERTY];
  if (typeof expander !== 'function') return request.fallback;
  const expanded = (expander as NestedHostExpander)(request);
  // The boundary-fallback answer renders the boundary's bytes here and re-raises
  // through the host's reporter: `nestedHost` never decides to swallow, it only
  // decides what BYTES the failing descendant contributes.
  if (isNestedHostFallback(expanded)) {
    reportNestedHostFallback(host, expanded.error);
    return expanded.html;
  }
  return typeof expanded === 'string' ? expanded : request.fallback;
}

/** The compiler-private host field carrying the boundary's failure reporter. */
export const NESTED_HOST_REPORTER_PROPERTY = '__oe_reportNestedFailure';

/**
 * Hand one boundary-owned descendant failure to the enclosing host.
 *
 * With no reporter the failure PROPAGATES — the unchanged pre-`16b-EB` behaviour,
 * and the reason this is not a silent swallow: an error boundary that wants the
 * fallback also has to own reporting it, which it does by supplying the reporter.
 */
function reportNestedHostFallback(host: object, error: unknown): void {
  const reporter = (host as Record<string, unknown>)[NESTED_HOST_REPORTER_PROPERTY];
  if (typeof reporter === 'function') {
    (reporter as (error: unknown) => void)(error);
    return;
  }
  throw error;
}
