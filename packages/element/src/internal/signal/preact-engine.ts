/**
 * Branded signal functions backed by @preact/signals-core.
 *
 * The framework exports these named adapters directly. @preact/signals-core is the single chartered runtime
 * dependency of @openelement/element (the packaged-artifact verification scans
 * the shipped surface runtime-free) and the only engine the package ships and
 * verifies.
 */

import {
  computed as preactComputed,
  effect as preactEffect,
  signal as preactSignal,
  untracked as preactUntracked,
} from '@preact/signals-core';
import type { ReadonlySignal, Unsubscribe, WritableSignal } from './types.ts';
import { SIGNAL_BRAND } from '@openelement/protocol/signal';

/** Create the branded writable signal exposed by Element. */
export function signal<T>(initialValue: T): WritableSignal<T> {
  const s = preactSignal(initialValue);
  return {
    [SIGNAL_BRAND]: true as const,
    get value(): T {
      return s.value;
    },
    set value(value: T) {
      s.value = value;
    },
    subscribe(fn: (value: T) => void): Unsubscribe {
      const dispose = preactEffect(() => fn(s.value));
      return () => dispose();
    },
  };
}

/** Create a branded derived signal. */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  const c = preactComputed(fn);
  return {
    [SIGNAL_BRAND]: true as const,
    get value(): T {
      return c.value;
    },
    subscribe(fn: (value: T) => void): Unsubscribe {
      const dispose = preactEffect(() => fn(c.value));
      return () => dispose();
    },
  };
}

/** Track an effect and return its disposer. */
export function effect(fn: () => void | Unsubscribe): Unsubscribe {
  const dispose = preactEffect(() => fn());
  return () => dispose();
}

/**
 * Run a branch/entry builder without adding its slot reads to the enclosing
 * write subscription. The generated condition refresh runs inside the test
 * signal's effect; the selected branch's own slots must still open their own
 * subscriptions, but their initial reads must not make the branch rebuild when
 * one of those slot signals changes independently. This is the engine's
 * dependency-tracking escape, kept inside the signal boundary.
 */
export function runUntracked<T>(fn: () => T): T {
  return preactUntracked(fn);
}
