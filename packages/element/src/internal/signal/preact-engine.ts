/**
 * SignalEngine backed by @preact/signals-core.
 *
 * This IS the default engine: framework.ts wires it up via createPreactEngine()
 * at module load. @preact/signals-core is the single chartered runtime
 * dependency of @openelement/element (pinned by the repository's Deno-API
 * boundary gate) and the
 * only engine supported and verified in 1.0.0-alpha.1. The SignalEngine
 * protocol is an internal seam that keeps call sites implementation-agnostic;
 * it is not a promise of third-party engine support.
 */

import {
  batch as preactBatch,
  computed as preactComputed,
  effect as preactEffect,
  signal as preactSignal,
} from '@preact/signals-core';
import type { BatchedSignalEngine } from './types.ts';
import { SIGNAL_BRAND } from '../protocol/signal.ts';

export function createPreactEngine(): BatchedSignalEngine {
  return {
    signal<T>(initialValue: T) {
      const s = preactSignal(initialValue);
      return {
        [SIGNAL_BRAND]: true as const,
        get value(): T {
          return s.value;
        },
        set value(value: T) {
          s.value = value;
        },
        subscribe(fn: (value: T) => void): () => void {
          const dispose = preactEffect(() => fn(s.value));
          return () => dispose();
        },
      };
    },

    computed<T>(fn: () => T) {
      const c = preactComputed(fn);
      return {
        [SIGNAL_BRAND]: true as const,
        get value(): T {
          return c.value;
        },
        subscribe(fn: (value: T) => void): () => void {
          const dispose = preactEffect(() => fn(c.value));
          return () => dispose();
        },
      };
    },

    effect(fn: () => void | (() => void)): () => void {
      let cleanup: (() => void) | void;
      const dispose = preactEffect(() => {
        cleanup?.();
        cleanup = fn();
      });
      return () => {
        cleanup?.();
        dispose();
      };
    },

    batch<T>(run: () => T): T {
      return preactBatch(run);
    },
  };
}
