/**
 * Runtime no-op stand-ins for the compile-time-only @element/@property
 * decorator intrinsics (ADR-0143, #1209).
 *
 * The OpenElement compiler (the @openelement/router/vite
 * open:compiled-element transform) recognizes these decorators by binding
 * provenance — a runtime named import of `element`/`property` from
 * '@openelement/element', aliases followed — and erases the applications
 * from generated code (the bindings are stripped from generated imports, so
 * compiled output never calls them). They carry no runtime semantics and are
 * not a second recognizer.
 *
 * Modules that are also evaluated WITHOUT the compiler (package unit tests,
 * config evaluation) import the same canonical bindings; these inert no-op
 * implementations keep module evaluation and class definition safe, and an
 * uncompiled class still fails closed at connect time (OE_PROGRAM_MISSING).
 */

/** Compiler-recognized element decorator; inert no-op at runtime. */
export function element(
  _tag: string,
  _options?: {
    root?: 'light' | 'shadow-open' | 'shadow-closed';
    delegatesFocus?: boolean;
    formAssociated?: boolean;
  },
): (target: unknown, context?: unknown) => void {
  // Liberal call signature: accepted by both the legacy (experimental) and
  // the standard (TC39) decorator typings consumers may typecheck under.
  return () => undefined;
}

/** Compiler-recognized property decorator; inert no-op at runtime. */
export function property(_options: {
  reflect: boolean;
  attribute?: false | string;
  type?: unknown;
  converter?: unknown;
}): (target: unknown, context?: unknown) => void {
  return () => undefined;
}
