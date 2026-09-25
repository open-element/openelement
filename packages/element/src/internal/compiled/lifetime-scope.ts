import { frameworkError, KernelErrorCode } from '../protocol/errors.ts';

/** One tree-shaped browser lifetime owner for components, Parts and Regions. */
export class LifetimeScope {
  #parent?: LifetimeScope;
  #children = new Set<LifetimeScope>();
  #cleanups: Array<() => void> = [];
  #rangeCleanups: Array<() => void> = [];
  #controller?: AbortController;
  #active = false;
  #disposed = false;
  #detachOwnedNodes = false;

  constructor(parent?: LifetimeScope) {
    this.#parent = parent;
    if (parent) {
      if (parent.#disposed) {
        throw frameworkError(
          KernelErrorCode.DISPOSED,
          'cannot attach to a disposed LifetimeScope',
          { phase: 'csr' },
        );
      }
      parent.#children.add(this);
    }
  }

  child(): LifetimeScope {
    return new LifetimeScope(this);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get active(): boolean {
    return this.#active;
  }

  get signal(): AbortSignal {
    this.#controller ??= new AbortController();
    if (this.#disposed && !this.#controller.signal.aborted) this.#controller.abort();
    return this.#controller.signal;
  }

  connect(): void {
    if (this.#disposed) {
      throw frameworkError(
        KernelErrorCode.DISPOSED,
        'cannot activate a disposed LifetimeScope',
        { phase: 'csr' },
      );
    }
    this.#active = true;
  }

  add(cleanup: () => void): void {
    if (this.#disposed) {
      cleanup();
      return;
    }
    this.#cleanups.push(cleanup);
  }

  addRangeCleanup(cleanup: () => void): void {
    if (this.#disposed) {
      if (this.#detachOwnedNodes) cleanup();
      return;
    }
    this.#rangeCleanups.push(cleanup);
  }

  setTimeout(handler: TimerHandler, timeout?: number): number {
    const id = globalThis.setTimeout(handler, timeout);
    this.add(() => globalThis.clearTimeout(id));
    return id;
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const id = globalThis.requestAnimationFrame(callback);
    this.add(() => globalThis.cancelAnimationFrame(id));
    return id;
  }

  dispose(detachOwnedNodes = false): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#detachOwnedNodes = detachOwnedNodes;
    this.#active = false;
    let firstError: unknown;
    let hasError = false;
    const attempt = (cleanup: () => void) => {
      try {
        cleanup();
      } catch (error) {
        if (!hasError) firstError = error;
        hasError = true;
      }
    };

    if (this.#controller) attempt(() => this.#controller!.abort());
    for (const child of [...this.#children]) attempt(() => child.dispose(detachOwnedNodes));
    this.#children.clear();
    for (const cleanup of this.#cleanups.splice(0).reverse()) attempt(cleanup);
    const rangeCleanups = this.#rangeCleanups.splice(0).reverse();
    if (detachOwnedNodes) { for (const cleanup of rangeCleanups) attempt(cleanup); }
    if (this.#parent) this.#parent.#children.delete(this);
    if (hasError) throw firstError;
  }
}
