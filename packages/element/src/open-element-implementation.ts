/**
 * @openelement/element - OpenElement base class (v0.44 compiled facade).
 *
 * The public OpenElement base class is a thin facade over the compiled Part
 * Program kernel (internal/compiled/runtime/kernel.ts). A 0.44 component is
 * authored in TSX and passed through the OpenElement compiler (the
 * @openelement/element/compiler `open:compiled-element` transform), which emits a
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

import { OpenElementError } from './internal/core/errors.ts';
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
import {
  capturePreUpgradeEvents,
  type PreUpgradeEventCapture,
  releasePreUpgradeEvents,
  replayPreUpgradeEvents,
} from './internal/compiled/runtime.ts';
import { CompiledErrorBoundary } from './internal/compiled/runtime/error-boundary.ts';
import {
  CompiledElementKernel,
  type CompiledRootMode,
} from './internal/compiled/runtime/kernel.ts';
import { ElementLifecycle } from './open-element-lifecycle.ts';
import { ElementParams } from './open-element-params.ts';
import { OpenElementConfiguration } from './open-element-configuration.ts';

/** Per-instance facade state, keyed off the element (constructor closures). */
const facadeStates = new WeakMap<OpenElement, FacadePropertyState>();

// ─── Pre-upgrade event capture (claim replay seam) ──────────────────

const preUpgradeCaptures = new Map<EventTarget, PreUpgradeEventCapture>();

/**
 * Install the bounded pre-upgrade interaction capture on an owning root
 * (default: the document). Generated client entries call this before any
 * compiled element upgrades; after a successful claim the element replays the
 * captured events whose targets live inside its root (compiled claim
 * capture/replay, internal/compiled/runtime.ts). Idempotent per root and a no-op
 * where no DOM exists (SSR).
 *
 * Invariant: the capture itself — one fixed listener set per owning root,
 * installed once per page — is page-lifetime by design and is NOT the leak.
 * The M1 leak was retained event-target records; each element releases exactly
 * its own records at its activation decision (success or failure), while
 * records owned by still-pending elements survive for their delayed/lazy
 * upgrade (#1170).
 */
export function ensurePreHydrationClickCapture(root?: EventTarget): void {
  const target = root ??
    (typeof document !== 'undefined' ? (document as unknown as EventTarget) : undefined);
  if (!target || typeof target.addEventListener !== 'function') return;
  if (preUpgradeCaptures.has(target)) return;
  preUpgradeCaptures.set(target, capturePreUpgradeEvents(target));
}

/** Replay captured pre-upgrade events owned by a successfully claimed root. */
function replayPreUpgradeCaptures(root: Node): void {
  for (const capture of preUpgradeCaptures.values()) {
    replayPreUpgradeEvents(root, capture.events);
  }
}

/**
 * Per-element release at the activation decision — success or failure: drop
 * exactly this root's captured records (the strong event-target references)
 * from every shared capture. The shared listener set stays installed for
 * elements that have not yet activated; their records are left pending.
 */
function releasePreUpgradeCapturesFor(root: Node): void {
  for (const capture of preUpgradeCaptures.values()) {
    releasePreUpgradeEvents(root, capture.events);
  }
}

function failMissingProgram(ctor: object): never {
  throw new OpenElementError(
    `[openElement] <${classNameOf(ctor)}> has no compiled Part Program. ` +
      'In 0.44 every OpenElement component must pass through the OpenElement ' +
      'compiler (the @openelement/element/compiler open:compiled-element transform); ' +
      'the runtime JSX render path was removed.',
    { code: 'OE_PROGRAM_MISSING', phase: 'csr' },
  );
}

/**
 * Custom Element base class for the compiled Part Program architecture.
 *
 * Subclasses are produced by the 0.44 compiler; hand-written subclasses that
 * never pass through the compiler fail closed at connect time.
 */
export class OpenElement extends OpenElementConfiguration {
  /** v0.42.0-alpha.15 (#904): route params box (open-element-params.ts). */
  #params = new ElementParams();

  /**
   * Lifecycle fallback used only when no compiled kernel exists (an instance
   * without a program never connects; the kernel owns the connected lifecycle
   * otherwise).
   */
  #detachedLifecycle = new ElementLifecycle();

  /** Error state owner used before a kernel exists (never connected). */
  #detachedErrors = new CompiledErrorBoundary();

  /** Present only when the class carries a compiled Part Program. */
  #kernel?: CompiledElementKernel;

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

    const rootMode: CompiledRootMode = program.root.kind === 'light'
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
      errorBoundary: ctor.isErrorBoundary === true
        // The public ErrorBoundary owns the user-facing retry policy
        // (maxRetries field); the kernel service only tracks state, so its
        // own retry budget stays out of the way.
        ? { maxRetries: Number.MAX_SAFE_INTEGER }
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
    applyPendingOwnValues(state);

    // The kernel's connect result owns the claim-vs-fresh truth; the facade
    // derives its hooks from it and never guesses from pre-connect state.
    try {
      const activation = kernel.connect();
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
      // still awaiting their delayed/lazy upgrade (#1170).
      const root = kernel.root;
      if (root) releasePreUpgradeCapturesFor(root as unknown as Node);
    }
    this.clientActivate();
  }

  /**
   * v0.23.0: Hook called after a successful claim of server-rendered DOM.
   *
   * Subclasses override this instead of relying on fragile
   * `super.connectedCallback()` call order. At this point the program's DOM
   * is claimed and Parts/Regions are live.
   *
   * No-op by default.
   */
  protected onDsdHydrated(): void {}

  /**
   * v0.23.0: Hook called after fresh client-side DOM creation completes.
   *
   * Subclasses override this for post-render initialization that depends on
   * the program's DOM being populated.
   *
   * No-op by default.
   */
  protected onCsrRendered(): void {}

  /**
   * v0.40.0: Client-side activation hook.
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
    this.#kernel?.disconnect();
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
  attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    newValue: string | null,
  ): void {
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
