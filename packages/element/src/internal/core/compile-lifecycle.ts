/**
 * Runtime fail-closed stand-ins for the compile-time-only lifecycle/change
 * intrinsics `onConnect` / `onDispose` (`16b-LC` author surface, option 1a),
 * `onPropertyChange` (experience-edition change channel, execution-plan §17) and
 * `onError` (`16b-EB` author-facing error boundary).
 *
 * The OpenElement compiler (the generated-element lane in
 * `@openelement/compiler`) recognizes these calls by binding provenance — a
 * runtime named import of one of these names from '@openelement/element',
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
 * connection-scope helper channel is a later, additive slice). `onError` adds no
 * second error channel either: the generated-element SHELL owns the capture
 * points and the handler list, and the compiler only registers the callback.
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
 *
 * The callback may keep the original zero-argument form or declare ONE `env`
 * parameter. `env.host` is the generated element the connection belongs to (for
 * a depth-1 retained hostless child: its nearest ancestor generated element),
 * and `env.signal` aborts at the START of that disconnection, before any
 * registered cleanup runs; a reconnect gets a fresh, un-aborted signal. The
 * parameter's type is the author-facing contract only — the compiler erases it
 * and passes the value from the connection scope the callback runs in.
 */
export function onConnect(
  callback: (env: {
    readonly host: HTMLElement;
    readonly signal: AbortSignal;
    readonly states: CustomStateSet;
  }) => void | (() => void),
): void {
  void callback;
  outsideCompiler('onConnect');
}

/**
 * Compiler-recognized dispose intrinsic: runs the callback exactly once when
 * the generated element instance is torn down (explicit `dispose()`), after
 * that connection's connect-cleanups. Erased by the compiler; calling it at
 * runtime fails closed.
 *
 * The callback may keep the original zero-argument form or declare ONE `env`
 * parameter whose `signal` is the instance-lifetime teardown signal: it is
 * aborted at the start of teardown, before this and every other disposal
 * callback runs, so `env.signal.aborted` is `true` inside the callback.
 */
export function onDispose(
  callback: (env: {
    readonly host: HTMLElement;
    readonly signal: AbortSignal;
    readonly states: CustomStateSet;
  }) => void,
): void {
  void callback;
  outsideCompiler('onDispose');
}

/**
 * Compiler-recognized change intrinsic: runs the callback after a DECLARED
 * property of this generated element commits a new value, for an attribute
 * write and for a property write, and never at setup. Erased by the compiler —
 * the callback is registered on the element-lifetime instance owner through the
 * compiler-private host record; calling it at runtime fails closed.
 *
 * `event.host` is the generated element (the nearest ancestor generated element
 * for a depth-1 retained hostless child), `event.signal` is the instance-lifetime
 * teardown signal, and `event.name`/`event.value` are the changed row and its
 * committed value. The callback may keep the zero-argument form.
 */
export function onPropertyChange(
  callback: (event: {
    readonly host: HTMLElement;
    readonly signal: AbortSignal;
    readonly states: CustomStateSet;
    readonly name: string;
    readonly value: unknown;
  }) => void,
): void {
  void callback;
  outsideCompiler('onPropertyChange');
}

/**
 * Compiler-recognized error intrinsic (`16b-EB`): the author-facing error
 * boundary of ONE generated element. The callback runs when a value escapes
 * from the element's own work — the connect/claim pass (mount, claim, setup and
 * the `onConnect` replay) and an UPDATE-phase write (a tracked slot refresh or a
 * DOM event handler dispatched inside the compiled body). Erased by the
 * compiler; calling it at runtime fails closed.
 *
 * `env.host` is the generated element the failing work belongs to (the nearest
 * ancestor generated element for a depth-1 retained hostless child),
 * `env.signal` is the per-connection `LifetimeScope` signal for a connect-phase
 * failure and the instance-lifetime teardown signal otherwise, `env.states` is
 * the element's `CustomStateSet`, and `env.error` is the thrown value EXACTLY as
 * it was thrown (never wrapped or replaced). The callback may keep the
 * zero-argument form.
 *
 * A catching handler changes only whether the error escapes: a connect-phase
 * failure still leaves the element in its defined post-failure state (no
 * projection, no listeners, a later reconnect retries from scratch), and an
 * update-phase failure leaves the previously written DOM in place with the
 * subscription still live for the next write. A handler that itself throws
 * REPLACES the original error — that new throw is what surfaces. With no
 * registered handler the pre-existing rethrow/rollback behaviour is unchanged.
 *
 * The callback is CLIENT-owned: it is erased into the compiled module and never
 * runs during `__ssr` (a server render has no element, no connection scope and
 * no handler registry; a producer throw fails the render, exactly as before).
 */
export function onError(
  callback: (env: {
    readonly host: HTMLElement;
    readonly signal: AbortSignal;
    readonly states: CustomStateSet;
    readonly error: unknown;
  }) => void,
): void {
  void callback;
  outsideCompiler('onError');
}
