import { ErrorCode, OpenElementError } from '../../core/index.ts';
import type { ErrorSeverity } from '../../protocol/errors.ts';

function toBoundaryError(error: unknown): OpenElementError {
  if (error instanceof OpenElementError) return error;
  const cause = error instanceof Error ? error : undefined;
  return new OpenElementError(cause?.message ?? String(error), {
    code: ErrorCode.BOUNDARY_CAUGHT,
    severity: 'error' as ErrorSeverity,
    phase: 'render',
    recoverable: true,
    cause,
  });
}

export interface CompiledErrorBoundaryOptions {
  maxRetries?: number;
  onError?: (error: OpenElementError, source: unknown) => void;
  onReset?: () => void;
}

/** Element-local error state for compiled Part Program activation. */
export class CompiledErrorBoundary {
  static isErrorBoundary = true;

  #error: OpenElementError | null = null;
  #source: unknown = null;
  #retryCount = 0;
  #disposed = false;
  #maxRetries: number;
  #onError?: (error: OpenElementError, source: unknown) => void;
  #onReset?: () => void;

  constructor(options: CompiledErrorBoundaryOptions = {}) {
    const requested = options.maxRetries ?? 3;
    this.#maxRetries = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 3;
    this.#onError = options.onError;
    this.#onReset = options.onReset;
  }

  get hasError(): boolean {
    return this.#error !== null;
  }

  get error(): OpenElementError | null {
    return this.#error;
  }

  get source(): unknown {
    return this.#source;
  }

  get retryCount(): number {
    return this.#retryCount;
  }

  get maxRetries(): number {
    return this.#maxRetries;
  }

  catchError(error: unknown, source?: unknown): void {
    if (this.#disposed) return;
    this.#error = toBoundaryError(error);
    this.#source = source ?? null;
    this.#onError?.(this.#error, this.#source);
  }

  capture(error: unknown, source?: unknown): void {
    this.catchError(error, source);
  }

  retry(recover?: () => void): boolean {
    if (this.#disposed || !this.#error || this.#retryCount >= this.#maxRetries) return false;
    this.#retryCount++;
    this.#error = null;
    this.#source = null;
    recover?.();
    return true;
  }

  reset(): void {
    if (this.#disposed) return;
    this.#error = null;
    this.#source = null;
    this.#retryCount = 0;
    this.#onReset?.();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#error = null;
    this.#source = null;
    this.#onError = undefined;
    this.#onReset = undefined;
  }
}
