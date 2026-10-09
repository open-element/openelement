/**
 * @openelement/element — ErrorBoundary (compiled element model).
 *
 * Public error-boundary contract implemented over the compiled kernel's
 * CompiledErrorBoundary service (internal/compiled/runtime/error-boundary.ts).
 * The kernel captures connect/claim failures into the same service, so
 * boundary state observed here and by the runtime never diverges.
 *
 * Fallback presentation is program-defined in the compiled architecture: a
 * boundary's Part Program expresses its fallback as a Region (a `when` over
 * the `hasError` state), not as a VNode returned from render(). The legacy
 * VNode `onError()`/`render()` fallback machinery was removed with the legacy
 * renderer.
 *
 * `hasError` is this class's error-state property, maintained by the boundary
 * itself (catchError / retry / reset and the kernel's automatic captures). A
 * compiled subclass whose render() branches on it declares the same name as a
 * compiled property:
 *
 * ```tsx
 * @element('my-boundary', { root: 'shadow-open' })
 * export class MyBoundary extends ErrorBoundary {
 *   // The error state the boundary maintains. Declared because a compiled
 *   // render reads @property signals; the boundary writes through it, so the
 *   // branch updates when a failure is captured or cleared.
 *   @property({ reflect: false, attribute: false })
 *   hasError = false;
 *
 *   render() {
 *     return <div>{this.hasError ? <p>Something went wrong</p> : <slot></slot>}</div>;
 *   }
 * }
 * ```
 *
 * The property is declared on the base class (rather than exposed as a
 * getter) precisely so that subclass declaration is legal TypeScript: a class
 * field may shadow a base field, but overriding a base accessor with a field
 * is a type error (TS2610).
 */

import { OpenElement } from './open-element.ts';
import type { OpenElementError } from './internal/core/index.ts';

/** Base class for elements that catch descendant render/hydration errors and apply a retry policy. */
export abstract class ErrorBoundary extends OpenElement {
  /**
   * Marks this component as an error boundary. The kernel
   * wires an unbounded-budget CompiledErrorBoundary for classes carrying this
   * flag; the user-facing retry policy lives on this class (maxRetries).
   */
  static override isErrorBoundary = true;

  /** Maximum number of retry attempts before giving up. Default: 3. */
  protected maxRetries = 3;

  /**
   * Current error state. The boundary machinery is the writer: catchError /
   * retry / reset publish here, and the kernel's automatic captures (connect,
   * claim and update failures) route through the same publication. Read it
   * directly, or — in a compiled subclass — declare it as a compiled property
   * and branch render() on it.
   */
  hasError = false;

  get error(): OpenElementError | null {
    return this._errors.error;
  }

  get retryCount(): number {
    return this._errors.retryCount;
  }

  /**
   * Capture an error at this boundary. Called explicitly by application code,
   * or by the kernel when activation fails. `source` identifies the failing
   * element so retry() can re-activate it.
   */
  catchError(error: Error, source?: unknown): void {
    this._errors.catchError(error, source);
    this.hasError = this._errors.hasError;
  }

  /**
   * Retry after an error. Resets error state, increments the retry counter,
   * and re-activates the captured source element when it is still connected.
   * A repeated failure re-enters catchError() through the source's own
   * activation path, restoring the error state.
   */
  retry(): void {
    if (this.retryCount >= this.maxRetries) return; // exhausted
    // Capture the source first: the service clears it before running recover.
    const source = this._errors.source;
    this._errors.retry(() => {
      if (
        typeof (source as { disconnectedCallback?: unknown } | null)?.disconnectedCallback ===
          'function' &&
        typeof (source as { connectedCallback?: unknown }).connectedCallback === 'function' &&
        (source as { isConnected?: unknown }).isConnected === true
      ) {
        try {
          (source as { disconnectedCallback(): void }).disconnectedCallback();
          (source as { connectedCallback(): void }).connectedCallback();
        } catch {
          // A still-failing source recaptures through its own kernel error
          // path; retry() itself never throws (legacy update() contract).
        }
      }
    });
    // A successful recovery cleared the service state; a recaptured failure
    // set it again. Publish whichever is true now.
    this.hasError = this._errors.hasError;
  }

  /**
   * Fully reset the error boundary, including the retry count.
   * Call this when the underlying issue has been resolved externally.
   * (The kernel already resets captured state after a successful reconnect.)
   */
  reset(): void {
    this._errors.reset();
    this.hasError = this._errors.hasError;
  }

  /**
   * The base class's publish seam: the kernel captures connect/claim/update
   * failures into the boundary service without calling through this class, so
   * the service's state is mirrored into `hasError` here — the one place the
   * error state is written from either side (application calls and automatic
   * captures), keeping the field and the service in agreement.
   */
  protected override _publishErrorState(): void {
    this.hasError = this._errors.hasError;
  }
}

export {
  CompiledErrorBoundary,
  type CompiledErrorBoundaryOptions,
} from './internal/compiled/runtime/error-boundary.ts';
