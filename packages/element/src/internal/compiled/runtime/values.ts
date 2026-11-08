/**
 * The canonical compiled value semantics: sink coercions, the text display
 * rule, the one URL-write guard, trusted-HTML capability access and range
 * removal. Browser-reachable and compiler-neutral — every execution mode
 * (fresh DOM, hydration/claim, the seed and server serializers, the public
 * `__h`/`__t` server helpers and the generated-code runtime primitives) reads
 * THIS module, so one program with one signal state cannot be coerced two
 * different ways on two paths.
 *
 * This module was extracted from `program-kernel.ts` (`displayValue`,
 * `assertSafeUrlAttribute`, `removeNodes`) and `server/shared.ts`
 * (`attributeValueOf`, `classValueOf`, `styleValueOf`): the browser DOM
 * executor imported the server module only for these three coercions, which
 * inverted the layer. The server module now re-exports from here (single
 * source, no duplicated table); behaviour is unchanged and pinned by the
 * existing sink/escape parity suites.
 *
 * The one shared validation failure also lives here rather than in the server
 * grammar module for the same reason: a coercion failure raised on the client
 * is the same failure a consumer catches by code on the server.
 *
 * @module ./values.ts
 */

import {
  AuthoringErrorCode,
  OpenElementError,
  raiseFrameworkError,
  ServerErrorCode,
} from '@openelement/protocol/errors';
import { unsafeStreamFrameAttribute } from '@openelement/protocol/stream-frame-policy';
import { trustedHtmlValue } from '../../core/security.ts';

/**
 * One compiled-program validation failure (#1386 item 3): an `OpenElementError`
 * carrying the caller's code, so the whole compiled grammar/value boundary is
 * catchable as one type. `path` names the program record (or sink location)
 * that failed; it stays a field rather than moving into the code, because the
 * path is per-site data and the code is the contract.
 *
 * Owned here (the browser-safe shared module) and re-exported by
 * `server/shared.ts`, which is where the server grammar validator defines the
 * rest of its failure surface.
 */
export class CompiledProgramValidationError extends OpenElementError {
  readonly path: string;

  constructor(path: string, message: string, code: string = ServerErrorCode.PROGRAM_INVALID) {
    super(`[compiled-program] ${path}: ${message}`, {
      code,
      severity: 'error',
      phase: 'validation',
      recoverable: false,
    });
    this.name = 'CompiledProgramValidationError';
    this.path = path;
  }
}

/** The canonical text-Part display rule: null/undefined render as no text. */
export function displayValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * The canonical attribute coercion: null/undefined omit the attribute, every
 * other value (including `false` and `0`) is its string form — the rule the
 * server serializer, fresh DOM creation and hydration recovery share.
 */
export function attributeValueOf(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function cssName(name: string): string {
  if (name.startsWith('--')) return name;
  const vendor = /^(Webkit|Moz|ms|O)([A-Z].*)$/.exec(name);
  const kebab = (value: string): string =>
    value[0].toLowerCase() +
    value.slice(1).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  if (vendor) return `-${vendor[1].toLowerCase()}-${kebab(vendor[2])}`;
  return kebab(name);
}

/**
 * The canonical class coercion: strings/numbers pass through, arrays flatten in
 * order, records sort by key and drop falsy entries. A shape that is not
 * class-like fails closed instead of rendering `[object Object]`.
 */
export function classValueOf(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(classValueOf).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => Boolean((value as Record<string, unknown>)[key]))
      .join(' ');
  }
  throw new CompiledProgramValidationError(
    'host.signals',
    'class Part expects a string, array, or record',
  );
}

/**
 * The canonical style coercion: CSS text and numbers pass through, arrays join
 * with semicolons, records sort by key, kebab-case non-custom property names
 * and join `name:value` pairs. A non-declaration shape fails closed.
 */
export function styleValueOf(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(styleValueOf).filter(Boolean).join(';');
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => {
        const item = (value as Record<string, unknown>)[key];
        return item !== null && item !== undefined && item !== false;
      })
      .map((key) => `${cssName(key)}:${String((value as Record<string, unknown>)[key])}`)
      .join(';');
  }
  throw new CompiledProgramValidationError(
    'host.signals',
    'style Part expects CSS text or a declaration record',
  );
}

/**
 * The one URL-write guard: a URL-carrying attribute name whose value carries a
 * script-bearing scheme is refused BEFORE the DOM write, with the same
 * `OE_UNSAFE_URL_SINK` code the server constructor (`__h`) raises for its
 * markup sinks. The predicate is the ONE shared protocol policy; do not
 * reintroduce a scheme list here.
 */
export function assertSafeUrlAttribute(name: string, value: string): void {
  if (!unsafeStreamFrameAttribute(name, value)) return;
  raiseFrameworkError(
    'render',
    AuthoringErrorCode.UNSAFE_URL_SINK,
    `[compiled-runtime] URL attribute ${JSON.stringify(name)} received a script-bearing ` +
      `scheme (${JSON.stringify(value.slice(0, 32))}); the value is refused.`,
  );
}

/** Remove every node in a list from its current parent; detached nodes are no-ops. */
export function removeNodes(nodes: readonly Node[]): void {
  for (const node of nodes) node.parentNode?.removeChild(node);
}

// The trusted-HTML capability (its WeakSet and the `trustedHtml` brand stay in
// `core/security.ts`, the one trust boundary; the opaque capability does not
// serialize). Re-exported so the generated-code runtime has one import surface
// for the sink semantics it must honour.
export { trustedHtmlValue };
