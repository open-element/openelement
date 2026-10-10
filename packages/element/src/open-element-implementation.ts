/**
 * @openelement/element - OpenElement base class (compiled facade).
 *
 * The public OpenElement base class is a thin facade over the compiled Part
 * Program kernel (internal/compiled/runtime/kernel.ts). A component is
 * authored in TSX and passed through the OpenElement compiler (the
 * @openelement/compiler `open:compiled-element` transform), which emits a
 * decorator-free class carrying the compiled statics this facade consumes:
 *
 *   - `static __partProgram`        — the validated Part Program v1 artifact
 *   - `static __compiledProperties` — JSON property records
 *     ({ name, attribute, type, converter, reflect, default })
 *   - `static __elementMetadata`    — element metadata (tag, cem, ...)
 *   - `static observedAttributes`   — compiler-owned attribute list
 *
 * At construction the facade builds the kernel host: one engine-backed signal
 * per compiled property, the program-referenced handlers bound to instance
 * methods, and an empty refs record (internal/compiled/facade-host.ts owns
 * the property contract). Claim-vs-fresh activation is owned by the kernel:
 * `kernel.connect()` returns the activation result (`mode: 'claim' | 'fresh'`
 * plus the resolved root) and the facade derives its hooks from that result —
 * never from a pre-connect guess.
 *
 * There is no fallback render path: an OpenElement subclass that reaches
 * `connectedCallback()` without a `__partProgram` fails closed with an
 * OpenElementError (code `OE_PROGRAM_MISSING`).
 *
 * Lifecycle:
 *   Server: renderDsd() -> serializeCompiledProgram() -> deterministic HTML
 *   Client (SSR DOM present): connectedCallback -> kernel.connect() claims
 *     the existing tree (mode 'claim') -> pre-upgrade replay -> onDsdHydrated()
 *   Client (no SSR DOM): connectedCallback -> kernel.connect() creates fresh
 *     DOM (mode 'fresh') -> onCsrRendered()
 *   Either way the element's own pre-upgrade capture records are released
 *   with the decision; the shared page-level capture stays for pending
 *   elements (#1170).
 *
 * @module @openelement/element/open-element
 */

import { FacadeErrorCode, OpenElementError, raiseFrameworkError } from './internal/core/errors.ts';
import {
  applyPendingOwnValues,
  bindProgramHandlers,
  classNameOf,
  type CompiledStatics,
  createFacadePropertyState,
  type FacadePropertyState,
  handleCompiledAttributeChange,
  installAccessors,
  reconcileOwnProperties,
  syncAttributesToSignals,
} from './internal/compiled/facade-host.ts';
import { markPreUpgradeIslandSettled } from './internal/compiled/runtime.ts';
import {
  releasePreUpgradeCapturesFor,
  replayPreUpgradeCaptures,
} from './internal/compiled/runtime/pre-upgrade-events.ts';
import { CompiledErrorBoundary } from './internal/compiled/runtime/error-boundary.ts';
import {
  CompiledElementKernel,
  type CompiledRootMode,
} from './internal/compiled/runtime/kernel.ts';
import { streamHostState } from './internal/compiled/stream-state.ts';
import { LifetimeScope } from './internal/compiled/lifetime-scope.ts';
import { ElementParams } from './open-element-params.ts';
import { OpenElementConfiguration } from './open-element-configuration.ts';

/** Per-instance facade state, keyed off the element (constructor closures). */
const facadeStates = new WeakMap<OpenElement, FacadePropertyState>();

function failMissingProgram(ctor: object): never {
  raiseFrameworkError(
    'csr',
    FacadeErrorCode.PROGRAM_MISSING,
    `[openElement] <${classNameOf(ctor)}> has no compiled Part Program. ` +
      'Every OpenElement component must pass through the OpenElement ' +
      'compiler (the @openelement/compiler open:compiled-element transform); ' +
      'the runtime JSX render path was removed.',
  );
}

/**
 * Whether a parent node is a shadow root: a document fragment (nodeType 11)
 * carrying a host. Checked structurally so the climb works against both the
 * platform DOM and the minimal facade DOM the tests run on — a plain
 * DocumentFragment (no host) is not a shadow boundary and stops the climb.
 */
function isShadowRootLike(node: unknown): node is ShadowRoot {
  if (!node || typeof node !== 'object') return false;
  if ((node as { nodeType?: unknown }).nodeType !== 11) return false;
  return (
    typeof (node as { host?: unknown }).host === 'object' &&
    (node as { host: unknown }).host !== null
  );
}

/**
 * Custom Element base class for the compiled Part Program architecture.
 *
 * Subclasses are produced by the compiler; hand-written subclasses that
 * never pass through the compiler fail closed at connect time.
 */
export class OpenElement extends OpenElementConfiguration {
  /** Route params box (#904, open-element-params.ts). */
  #params = new ElementParams();

  /**
   * Lifecycle fallback used only when no compiled kernel exists (an instance
   * without a program never connects; the kernel owns the connected lifecycle
   * otherwise).
   */
  #detachedLifecycle = new LifetimeScope();

  /** Error state owner used before a kernel exists (never connected). */
  #detachedErrors = new CompiledErrorBoundary();

  /** Present only when the class carries a compiled Part Program. */
  #kernel?: CompiledElementKernel;
  #streamUnsubscribe?: () => void;

  constructor() {
    super();
    const ctor = this.constructor as CompiledStatics & { name?: string };
    const program = ctor.__partProgram;
    const properties = Array.isArray(ctor.__compiledProperties) ? ctor.__compiledProperties : [];

    // Signal-backed accessors live on the subclass prototype so generated
    // class field initializers can be reconciled at connect time.
    installAccessors(properties, Object.getPrototypeOf(this), facadeStates);

    const state = createFacadePropertyState(this, properties, ctor.__computedFields);
    facadeStates.set(this, state);

    if (!program) return;

    const rootMode: CompiledRootMode =
      program.root.kind === 'light'
        ? 'light'
        : program.root.kind === 'shadow-open'
          ? 'open'
          : 'closed';

    state.kernel = new CompiledElementKernel(this as unknown as HTMLElement, program, {
      signals: state.signals,
      handlers: bindProgramHandlers(this, ctor, program),
      refs: {},
      rootMode,
      delegatesFocus: ctor.delegatesFocus ?? false,
      styles: ctor.styles as never,
      formAssociated: ctor.formAssociated ?? false,
      errorBoundary:
        ctor.isErrorBoundary === true
          ? {
              // The public ErrorBoundary owns the user-facing retry policy
              // (maxRetries field); the kernel service only tracks state, so its
              // own retry budget stays out of the way.
              maxRetries: Number.MAX_SAFE_INTEGER,
              // Publish every automatic capture (connect, claim and update
              // failures) into the element's own error state: a compiled
              // ErrorBoundary subclass that declares `hasError` as a property
              // reads the write through its signal-backed accessor — so a
              // render() branch on hasError flips on kernel-captured failures
              // too, not only on application catchError() calls.
              onError: () => {
                this._publishErrorState();
              },
              // The kernel clears the service after a successful connect
              // (kernel.ts `if (this.errors.hasError) this.errors.reset()`);
              // publish that too, or a recovered element would keep showing
              // the fallback branch.
              onReset: () => {
                this._publishErrorState();
              },
            }
          : undefined,
    });
    this.#kernel = state.kernel;
  }

  /**
   * The element-local error boundary service. Compiled instances delegate to
   * the kernel's service so connect-time capture and public ErrorBoundary
   * state agree; uncompiled instances (which never connect) get a detached
   * service so the protected surface stays usable pre-connect.
   */
  protected get _errors(): CompiledErrorBoundary {
    return this.#kernel?.errors ?? this.#detachedErrors;
  }

  /**
   * Publish the boundary service's state after the kernel captured or cleared
   * an error automatically (connect/claim/update captures and the post-connect
   * reset). No-op on the base class (a plain OpenElement carries no boundary
   * state); `ErrorBoundary` overrides it to write its `hasError` field, so a
   * compiled subclass that declares `hasError` as a property reads the
   * automatic transitions through the same signal its render() branches on.
   */
  protected _publishErrorState(): void {}

  /**
   * Route one error to the nearest error boundary in the composed ancestor
   * chain (P6: the one routing path every automatic capture rides — the
   * compiler-emitted lifecycle wrappers, the facade property setter, and the
   * kernel's update-error sink all funnel here; no second error channel).
   *
   * Prior art is the React error boundary (lifecycle/render throws bubble to
   * the nearest boundary); the compiled difference is WHERE the capture point
   * lives — the compiler emits the try/catch around platform lifecycle bodies
   * at compile time (P2: pay at compile time, minimal runtime delta), and the
   * runtime adds the two points compilation cannot see: synchronous
   * signal-graph evaluation at a property write (facade-host.ts) and the
   * kernel's Region-update isolation (kernel.ts onUpdateError).
   *
   * The climb starts at `this` (a boundary class may capture its own
   * author-code errors), then walks `parentElement`, crossing shadow
   * boundaries through `shadowRoot.host` (an error inside a child island's
   * shadow tree must still reach a boundary in the parent island's light
   * DOM). It stops at the document or a host-less fragment. An element is a
   * boundary iff its constructor carries `isErrorBoundary === true` (the
   * public ErrorBoundary base and the kernel-wired facade set it).
   *
   * Capture goes through the boundary's own `_errors.catchError(error, this)`
   * so publication rides the existing service options: a compiled boundary
   * subclass's kernel wires `onError` → `_publishErrorState()` → the
   * `hasError` property write, so the fallback Region flips exactly as an
   * application `catchError()` call would. The captured `source` is `this`
   * (the failing element), so `retry()` re-activates the right host.
   *
   * Returns true when a boundary captured the error, false when the climb
   * found none (callers rethrow so uncaught semantics outside boundaries are
   * unchanged). A boundary whose service already holds the identical error
   * object reports true without re-capturing — the composition where the
   * kernel captures a boundary's own connect failure and the emitted
   * lifecycle wrapper then routes the rethrown error must not publish the
   * same failure twice.
   */
  protected _captureError(error: unknown): boolean {
    type BoundaryCandidate = Element & { parentElement?: unknown; parentNode?: unknown };
    let current: BoundaryCandidate = this as unknown as BoundaryCandidate;
    for (;;) {
      const constructor = Object.getPrototypeOf(current)?.constructor as
        | { isErrorBoundary?: boolean }
        | undefined;
      if (constructor?.isErrorBoundary === true) {
        const service = (current as unknown as OpenElement)._errors;
        if (service.error === error) return true;
        service.catchError(error, this);
        return true;
      }
      const parentElement = current.parentElement;
      if (parentElement && typeof parentElement === 'object') {
        current = parentElement as BoundaryCandidate;
        continue;
      }
      // parentElement is null/absent: an element whose parentNode is a shadow
      // root keeps climbing at the host (the facade test DOM exposes only
      // parentNode, hence the element fallback in the same read).
      const parentNode = current.parentNode;
      if (isShadowRootLike(parentNode)) {
        current = (parentNode as ShadowRoot).host as BoundaryCandidate;
        continue;
      }
      if (
        parentNode &&
        typeof parentNode === 'object' &&
        (parentNode as { nodeType?: unknown }).nodeType === 1
      ) {
        current = parentNode as BoundaryCandidate;
        continue;
      }
      // Document or host-less DocumentFragment: no boundary remains.
      return false;
    }
  }

  /**
   * Returns an AbortSignal that is aborted when the element is disconnected.
   * Useful for tying async work (fetch, event listeners) to element lifecycle.
   */
  protected _lifecycleSignal(): AbortSignal {
    return this.#kernel?.lifecycle.signal ?? this.#detachedLifecycle.signal;
  }

  /**
   * setTimeout wrapper that auto-clears when the element disconnects.
   */
  protected _setTimeout(handler: TimerHandler, timeout?: number): number {
    return (this.#kernel?.lifecycle ?? this.#detachedLifecycle).setTimeout(handler, timeout);
  }

  /**
   * requestAnimationFrame wrapper that auto-cancels when the element disconnects.
   */
  protected _requestAnimationFrame(callback: FrameRequestCallback): number {
    return (this.#kernel?.lifecycle ?? this.#detachedLifecycle).requestAnimationFrame(callback);
  }

  /** Reactive route parameters. Updates automatically on SPA navigation. */
  get params(): Record<string, string> {
    return this.#params.value;
  }

  set params(value: Record<string, string>) {
    this.#params.value = value;
  }

  /** ElementInternals for form-associated custom elements. */
  protected get _internals(): ElementInternals | undefined {
    return this.#kernel?.form.internals;
  }

  /**
   * Lifecycle: called when the element is connected to the DOM.
   *
   * Fails closed (OE_PROGRAM_MISSING) when the class carries no compiled
   * Part Program. Otherwise syncs route params, reconciles property state
   * into the compiled signals (field initializers, then present attributes,
   * then pre-upgrade JS sets), and connects the kernel; the kernel claims
   * existing SSR DOM or creates fresh DOM from the program.
   */
  connectedCallback(): void {
    const kernel = this.#kernel;
    const state = facadeStates.get(this);
    if (!kernel || !state) failMissingProgram(this.constructor);
    this.#params.syncFromAttribute(this as unknown as HTMLElement);
    reconcileOwnProperties(this, state);
    syncAttributesToSignals(this, state);
    // The kernel's connect result owns the claim-vs-fresh truth; the facade
    // derives its hooks from it and never guesses from pre-connect state.
    try {
      const stream = streamHostState(this as unknown as HTMLElement, kernel.program);
      // Pre-upgrade JS sets land before the streamed seed application: a
      // resolved seed is the server's value for a deferred field and must win
      // over a pre-upgrade write, exactly like the late-frame listener below
      // lets the server value win once the frame arrives. Applying the seed
      // before applyPendingOwnValues let a pre-upgrade write overwrite an
      // early-arrived frame's value, drifting the claim text away from the
      // server-rendered DOM — and with owning recovery disabled in stream
      // mode the element could then never hydrate.
      applyPendingOwnValues(state);
      if (stream) {
        for (const property of state.properties) {
          if (property.computed) continue;
          const seed = stream.properties[property.name];
          if (!seed) continue;
          if (seed.type !== property.type) {
            throw new OpenElementError(
              `[openElement] streamed property "${property.name}" has a mismatched type.`,
              { code: FacadeErrorCode.STREAM_TYPE_MISMATCH, phase: 'csr' },
            );
          }
          if (seed.state === 'resolved') state.signals[property.name].value = seed.value;
        }
      }
      const activation = kernel.connect();
      this.#streamUnsubscribe?.();
      this.#streamUnsubscribe = stream?.listen((part, field, outcome) => {
        if (outcome !== 'content') return;
        const seed = stream.properties[field];
        const property = state.properties.find((item) => item.name === field);
        if (!seed || seed.state !== 'resolved' || property?.type !== seed.type) return;
        state.signals[field].value = seed.value;
        kernel.resolveStreamPart(part);
      });
      if (activation.mode === 'claim') {
        replayPreUpgradeCaptures(activation.root as unknown as Node);
        this.onDsdHydrated();
      } else {
        this.onCsrRendered();
      }
    } finally {
      // Per-element release, win or lose: this element's captured records
      // (strong event-target references) never outlive its activation
      // decision. The shared page-level capture stays installed for elements
      // still awaiting their delayed/lazy upgrade (#1170). A failed claim may
      // leave kernel.root unset, so fall back to the host element itself:
      // its light children / shadow content are still inside it, while a
      // pending sibling's records live outside it and survive. The host is
      // marked settled first so later live traffic inside it no longer
      // enters the queue (nested pending islands keep their own unsettled
      // host on the path and still capture).
      markPreUpgradeIslandSettled(this as unknown as object);
      const root = kernel.root ?? (this as unknown as Node);
      if (root) releasePreUpgradeCapturesFor(root as unknown as Node);
    }
    this.clientActivate();
  }

  /**
   * Hook called after a successful claim of server-rendered DOM.
   *
   * Subclasses override this instead of relying on fragile
   * `super.connectedCallback()` call order. At this point the program's DOM
   * is claimed and Parts/Regions are live.
   *
   * No-op by default.
   */
  protected onDsdHydrated(): void {}

  /**
   * Hook called after fresh client-side DOM creation completes.
   *
   * Subclasses override this for post-render initialization that depends on
   * the program's DOM being populated.
   *
   * No-op by default.
   */
  protected onCsrRendered(): void {}

  /**
   * Client-side activation hook.
   *
   * Called once after the element is connected and the compiled program has
   * been claimed or created. This is the right place for framework hydration
   * (Preact, React, Vue, Lit) to take over from the compiled DOM.
   *
   * Default implementation is a no-op.
   */
  protected clientActivate(): void {
    // default no-op
  }

  /**
   * Lifecycle: called when the element is disconnected from the DOM.
   * Disposes the kernel activation (subscriptions, listeners, styles).
   */
  disconnectedCallback(): void {
    try {
      this.#streamUnsubscribe?.();
      this.#streamUnsubscribe = undefined;
      // Removal / morph replacement must not strand this root's records:
      // release them with the disconnect (detached targets are additionally
      // swept by the release itself, so cancelled islands free their queue).
      const root = this.#kernel?.root;
      if (root) releasePreUpgradeCapturesFor(root as unknown as Node);
    } finally {
      this.#kernel?.disconnect();
    }
  }

  /** Lifecycle: called when the element is adopted into a new document. */
  adoptedCallback(): void {
    this.#kernel?.adopted();
  }

  /**
   * Lifecycle: called when an observed attribute changes.
   *
   * Routes the change into the compiled property contract (convert + write
   * through the accessor; removal restores the compiled default). Writes that
   * came from property reflection are ignored (loop guard).
   */
  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    const state = facadeStates.get(this);
    if (!state || !this.#kernel) return;
    handleCompiledAttributeChange(this, state, name, newValue);
  }

  /** Platform form callback: the kernel owns ElementInternals. */
  formAssociatedCallback(_form: HTMLFormElement | null): void {
    // Subclass override point; kernel.form attached the internals at connect.
  }

  /** Platform form callback routed into the kernel form controller. */
  formResetCallback(): void {
    this.#kernel?.form.formResetCallback();
  }

  /** Platform form callback routed into the kernel form controller. */
  formStateRestoreCallback(state: File | string | FormData | null, mode: string): void {
    this.#kernel?.form.formStateRestoreCallback(state, mode);
  }

  /**
   * Read locale from JS property (set by SSR injection) first,
   * then HTML attribute, then fallback to provided default.
   *
   * @param fallback - Default value when neither source has a value. Defaults to 'en'.
   */
  protected _getLocale(fallback = 'en'): string {
    const prop = this.locale;
    if (typeof prop === 'string' && prop) return prop;
    return this.getAttribute('locale') || fallback;
  }
}
