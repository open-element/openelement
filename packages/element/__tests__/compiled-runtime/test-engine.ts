/**
 * Small protocol-only SignalEngine used by the conformance tests. This lives
 * in the test tree on purpose: it is not part of the shipped package, and
 * @preact/signals-core stays the only engine supported by 1.0.0-alpha.1.
 *
 * It intentionally differs from the default Preact adapter in two observable
 * ways allowed by the protocol: subscriptions are lazy (no initial callback),
 * and `batch()` coalesces invalidations. The Part runtime must therefore read
 * initial values during construction and subscribe only to future writes.
 */

import { SIGNAL_BRAND } from '../../src/internal/protocol/signal.ts';
import type {
  ReadonlySignal,
  Unsubscribe,
  WritableSignal,
} from '../../src/internal/protocol/signal.ts';
import type { BatchedSignalEngine } from '../../src/internal/signal/types.ts';

interface ReactiveSource {
  addInvalidation(listener: () => void): Unsubscribe;
}

interface TrackingFrame {
  dependencies: Set<ReactiveSource>;
}

let activeFrame: TrackingFrame | undefined;
let batchDepth = 0;
let flushing = false;
const pendingJobs = new Set<() => void>();

function track(source: ReactiveSource): void {
  activeFrame?.dependencies.add(source);
}

function schedule(job: () => void): void {
  pendingJobs.add(job);
  if (batchDepth === 0 && !flushing) flush();
}

function flush(): void {
  if (flushing) return;
  flushing = true;
  try {
    while (pendingJobs.size > 0) {
      const jobs = [...pendingJobs];
      pendingJobs.clear();
      for (const job of jobs) job();
    }
  } finally {
    flushing = false;
  }
}

function withTracking<T>(run: () => T): { value: T; dependencies: Set<ReactiveSource> } {
  const previous = activeFrame;
  const frame: TrackingFrame = { dependencies: new Set() };
  activeFrame = frame;
  try {
    return { value: run(), dependencies: frame.dependencies };
  } finally {
    activeFrame = previous;
  }
}

function replaceDependencies(
  current: Map<ReactiveSource, Unsubscribe>,
  next: Set<ReactiveSource>,
  invalidate: () => void,
): void {
  for (const [source, unsubscribe] of current) {
    if (!next.has(source)) {
      unsubscribe();
      current.delete(source);
    }
  }
  for (const source of next) {
    if (!current.has(source)) current.set(source, source.addInvalidation(invalidate));
  }
}

class TestSignal<T> implements WritableSignal<T>, ReactiveSource {
  readonly [SIGNAL_BRAND] = true as const;
  #value: T;
  #listeners = new Set<(value: T) => void>();
  #pendingValues = new Map<(value: T) => void, { value: T }>();
  #listenerJobs = new Map<(value: T) => void, () => void>();
  #invalidations = new Set<() => void>();

  constructor(initialValue: T) {
    this.#value = initialValue;
  }

  get value(): T {
    track(this);
    return this.#value;
  }

  set value(next: T) {
    if (Object.is(next, this.#value)) return;
    this.#value = next;
    const listeners = [...this.#listeners];
    const invalidations = [...this.#invalidations];
    for (const listener of listeners) {
      const job = this.#listenerJobs.get(listener);
      if (!job) continue;
      this.#pendingValues.set(listener, { value: next });
      schedule(job);
    }
    for (const invalidate of invalidations) schedule(invalidate);
  }

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.#listeners.add(listener);
    const job = (): void => {
      const pending = this.#pendingValues.get(listener);
      if (!pending) return;
      this.#pendingValues.delete(listener);
      if (this.#listeners.has(listener)) listener(pending.value);
    };
    this.#listenerJobs.set(listener, job);
    return () => {
      this.#listeners.delete(listener);
      this.#pendingValues.delete(listener);
      this.#listenerJobs.delete(listener);
    };
  }

  addInvalidation(listener: () => void): Unsubscribe {
    this.#invalidations.add(listener);
    return () => this.#invalidations.delete(listener);
  }
}

class TestComputed<T> implements ReadonlySignal<T>, ReactiveSource {
  readonly [SIGNAL_BRAND] = true as const;
  #compute: () => T;
  #value!: T;
  #listeners = new Set<(value: T) => void>();
  #invalidations = new Set<() => void>();
  #dependencies = new Map<ReactiveSource, Unsubscribe>();
  #disposed = false;

  constructor(compute: () => T) {
    this.#compute = compute;
    this.#evaluate(true);
  }

  get value(): T {
    track(this);
    return this.#value;
  }

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  addInvalidation(listener: () => void): Unsubscribe {
    this.#invalidations.add(listener);
    return () => this.#invalidations.delete(listener);
  }

  #evaluate(initial: boolean): void {
    if (this.#disposed) return;
    const result = withTracking(this.#compute);
    replaceDependencies(this.#dependencies, result.dependencies, () => this.#evaluate(false));
    if (initial) {
      this.#value = result.value;
      return;
    }
    if (Object.is(result.value, this.#value)) return;
    this.#value = result.value;
    const listeners = [...this.#listeners];
    const invalidations = [...this.#invalidations];
    for (const listener of listeners) schedule(() => listener(result.value));
    for (const invalidate of invalidations) schedule(invalidate);
  }
}

class TestEffect {
  #run: () => void | Unsubscribe;
  #dependencies = new Map<ReactiveSource, Unsubscribe>();
  #cleanup: Unsubscribe | undefined;
  #disposed = false;

  constructor(run: () => void | Unsubscribe) {
    this.#run = run;
    this.#execute();
  }

  #execute(): void {
    if (this.#disposed) return;
    this.#cleanup?.();
    this.#cleanup = undefined;
    const result = withTracking(this.#run);
    replaceDependencies(this.#dependencies, result.dependencies, () => this.#execute());
    this.#cleanup = typeof result.value === 'function' ? result.value : undefined;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const unsubscribe of this.#dependencies.values()) unsubscribe();
    this.#dependencies.clear();
    this.#cleanup?.();
    this.#cleanup = undefined;
  }
}

export interface TestSignalEngine extends BatchedSignalEngine {
  /** Coalesce all signal/computed/effect work performed by `run`. */
  batch<T>(run: () => T): T;
}

/** Create the lazy, batched alternate engine used for protocol conformance. */
export function createTestEngine(): TestSignalEngine {
  return {
    signal<T>(initialValue: T): WritableSignal<T> {
      return new TestSignal(initialValue);
    },
    computed<T>(compute: () => T): ReadonlySignal<T> {
      return new TestComputed(compute);
    },
    effect(run: () => void | Unsubscribe): Unsubscribe {
      const effect = new TestEffect(run);
      return () => effect.dispose();
    },
    batch<T>(run: () => T): T {
      batchDepth++;
      try {
        return run();
      } finally {
        batchDepth--;
        if (batchDepth === 0) flush();
      }
    },
  };
}
