/**
 * @openelement/element — ErrorBoundary (compiled element model).
 *
 * Public error-boundary contract implemented over the compiled kernel's
 * CompiledErrorBoundary service (internal/compiled/runtime/error-boundary.ts).
 * The kernel captures connect/claim failures into the same service, so
 * boundary state observed here and by the runtime never diverges.
 *
 * Fallback presentation is program-defined in the compiled architecture: a
 * boundary's Part Program expresses its fallback as a Region (a `when` over an
 * error-state signal written from a `catchError` override), not as a VNode
 * returned from render(). The legacy VNode `onError()`/`render()` fallback
 * machinery was removed with the legacy renderer.
 *
 * Usage:
 * ```tsx
 * class MyBoundary extends ErrorBoundary {
 *   // compiled render expresses the fallback branch over hasError state
 * }
 * ```
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

  get hasError(): boolean {
    return this._errors.hasError;
  }

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
  }

  /**
   * Fully reset the error boundary, including the retry count.
   * Call this when the underlying issue has been resolved externally.
   * (The kernel already resets captured state after a successful reconnect.)
   */
  reset(): void {
    this._errors.reset();
  }
}

export {
  CompiledErrorBoundary,
  type CompiledErrorBoundaryOptions,
} from './internal/compiled/runtime/error-boundary.ts';
