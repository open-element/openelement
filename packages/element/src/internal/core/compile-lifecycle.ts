/**
 * Runtime fail-closed stand-ins for the compile-time-only lifecycle/change
 * intrinsics `onConnect` / `onDispose` (`16b-LC` author surface, option 1a),
 * `onPropertyChange` (experience-edition change channel, execution-plan §17),
 * `onError` (`16b-EB` author-facing error boundary), `ref` (`16b-REF`
 * author-facing node handle) and `provideContext` / `useContext` (`16b-CTX`
 * author-facing scope tree).
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

/**
 * Compiler-recognized node-handle factory (`16b-REF`): declares a REF HANDLE
 * for one intrinsic DOM node of this component.
 *
 * The returned value is handed to that node's existing JSX `ref` attribute:
 *
 * ```tsx
 * const field = ref<HTMLInputElement>((element) => {
 *   element?.focus();
 *   return () => {/* detach cleanup *\/};
 * });
 * // … return <input ref={field} />;
 * ```
 *
 * The handle is the same object for the whole element lifetime: the compiler
 * erases this call into the retained instance factory, so a reconnect, a claim
 * of server DOM and an update all observe one handle rather than a per-pass
 * copy. It is a REF CHANNEL VALUE, not a reactive source: `current` is written
 * when the node attaches, cleared when it detaches, and it notifies nothing —
 * a tracked slot reading `current` would be a one-shot value, which is why the
 * compiler admits a handle ONLY in a `ref` attribute expression.
 *
 * The optional callback is the attach/detach notification the existing `ref`
 * channel already defines: called with the element on attach, and with `null`
 * on detach AFTER the cleanup it returned has run. Because the handle rides the
 * same `ref` channel, the cleanup ordering, the once-per-detach rule and the
 * scope ownership are the existing ones — this intrinsic adds no second
 * attachment mechanism.
 *
 * Erased by the compiler; calling it at runtime fails closed.
 */
export function ref<T extends globalThis.Element = globalThis.Element>(
  callback?: (element: T | null) => void | (() => void),
): {
  (element: globalThis.Element | null): void;
  readonly current: T | null;
} {
  void callback;
  outsideCompiler('ref');
}

/**
 * Compiler-recognized PROVIDER intrinsic (`16b-CTX`): declares that this
 * component provides `context` with the current value of `read` to its subtree.
 *
 * ```tsx
 * const ThemeContext = createContext(Symbol('theme'), 'light');
 *
 * function App() {
 *   provideContext(ThemeContext, () => props.theme);
 *   return <Child />;
 * }
 * ```
 *
 * The second argument is a VALUE THUNK, deliberately: the compiler erases this
 * call into the component's retained setup record and re-reads the thunk on
 * connect and after every declared-row commit, so a provider follows the
 * lane's one change channel (a property write) rather than introducing a second
 * reactivity model. A `computed` would be the class lane's answer; this lane
 * deliberately has no author `computed`.
 *
 * Published over the generated owner tree, hostless owners included: provider
 * discovery is the Community Context Protocol `context-request` composed event,
 * so the nearest ancestor provider wins and two sibling subtrees cannot see each
 * other. A provider registers on connect, unregisters exactly once on
 * disconnect, and registers again on reconnect.
 *
 * Erased by the compiler; calling it at runtime fails closed.
 */
export function provideContext<T>(
  context: {
    readonly key: symbol;
    readonly defaultValue: T;
  },
  read: () => T,
): void {
  void context;
  void read;
  outsideCompiler('provideContext');
}

/**
 * Compiler-recognized CONSUMER intrinsic (`16b-CTX`): declares a tracked
 * consumer of `context` for this component and returns the signal its value
 * lives in.
 *
 * ```tsx
 * const theme = useContext(ThemeContext);
 * return <p>{theme.value}</p>;   // a tracked slot: refreshes on provider change
 * ```
 *
 * The returned signal is ONE persistent consumer-local signal: the compiler
 * erases this call into the component's retained setup record, so a reconnect
 * re-reads the nearest provider into the SAME object and a tracked slot keeps
 * exactly one subscription target for the whole element lifetime. Lookup follows
 * the nearest owning component, so an inner provider shadows an outer one and a
 * component with no ancestor provider reads the context's declared default.
 *
 * Reading `.value` in a tracked slot is the supported use — this is the lane's
 * reactive channel, unlike `ref`'s `current`. Reading it inside a handler also
 * works (the signal is live), but only tracked slots refresh.
 *
 * Erased by the compiler; calling it at runtime fails closed.
 */
export function useContext<T>(context: { readonly key: symbol; readonly defaultValue: T }): {
  readonly value: T;
  subscribe(fn: (value: T) => void): () => void;
} {
  void context;
  outsideCompiler('useContext');
}
