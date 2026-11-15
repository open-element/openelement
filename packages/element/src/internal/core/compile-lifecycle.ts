/**
 * Runtime fail-closed stand-ins for the compile-time-only lifecycle intrinsics
 * `onConnect` / `onDispose` (`16b-LC` author surface, option 1a).
 *
 * The OpenElement compiler (the generated-element lane in
 * `@openelement/compiler`) recognizes these calls by binding provenance — a
 * runtime named import of `onConnect`/`onDispose` from '@openelement/element',
 * aliases followed — admits them only as direct top-level statements of the
 * generated element root setup, and ERASES them from the emitted module: the
 * callback becomes a record entry / instance-scope registration in the
 * compiler-owned `__oe_rootInstance` factory, and the emitted module never
 * imports or calls these functions.
 *
 * These implementations carry no lifecycle semantics. A call that reaches them
 * means the module was evaluated outside the compiler pipeline, where silently
 * dropping an author's connection cleanup would be a lie, so they fail closed —
 * the same posture (and the same catalogue identity, "ran outside the compiler
 * pipeline") as the JSX runtime factories. No new public error code is added:
 * `FacadeErrorCode.JSX_OUTSIDE_COMPILER` is the existing "outside the compiler
 * pipeline" code; the exception message names the lifecycle intrinsic
 * precisely. The signatures are the author-visible types only; they are not a
 * runtime dispatcher and there is no hook-order slot or lifecycle context (the
 * connection-scope helper channel is a later, additive slice).
 */

import { FacadeErrorCode, OpenElementError } from './errors.ts';

function outsideCompiler(intrinsic: string): never {
  throw new OpenElementError(
    `[openElement] ${intrinsic}(...) is a compile-time intrinsic executed outside the ` +
      'compiler pipeline. The generated-element lane erases it into the retained instance ' +
      'factory of a compiled root setup; run the OpenElement Vite adapter so the island is ' +
      'compiled instead of calling the standalone import at runtime.',
    { code: FacadeErrorCode.JSX_OUTSIDE_COMPILER, phase: 'build' },
  );
}

/**
 * Compiler-recognized connect intrinsic: runs the callback on every
 * connection of the generated element (initial mount and each reconnect) and
 * releases the optional returned cleanup at that disconnection. Erased by the
 * compiler; calling it at runtime fails closed.
 */
export function onConnect(callback: () => void | (() => void)): void {
  void callback;
  outsideCompiler('onConnect');
}

/**
 * Compiler-recognized dispose intrinsic: runs the callback exactly once when
 * the generated element instance is torn down (explicit `dispose()`), after
 * that connection's connect-cleanups. Erased by the compiler; calling it at
 * runtime fails closed.
 */
export function onDispose(callback: () => void): void {
  void callback;
  outsideCompiler('onDispose');
}
