/**
 * framework.ts - Framework Layer
 *
 * Developer-friendly API wrapping the statically selected engine.
 * signal(), computed(), effect() - the primary API surface.
 *
 * @preact/signals-core is the built-in implementation and the only engine
 * supported in 1.0.0-alpha.1 (see selection.ts); Preact's own API is never
 * re-exported here.
 *
 * @module ./framework.ts
 */

import { noteSignalCreated, selectedSignalEngine } from './selection.ts';
import type { ReadonlySignal, Unsubscribe, WritableSignal } from './types.ts';

// ─── Engine (default: @preact/signals-core adapter) ─────────────
/** Create a writable signal through the selected signal engine. */
export function signal<T>(initialValue: T): WritableSignal<T> {
  const created = selectedSignalEngine().signal(initialValue);
  noteSignalCreated();
  return created;
}
/** Create a derived read-only signal recomputed from its dependencies. */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  const created = selectedSignalEngine().computed(fn);
  noteSignalCreated();
  return created;
}
/** Run a side effect that re-subscribes whenever its signal dependencies change. */
export function effect(fn: () => void | Unsubscribe): Unsubscribe {
  noteSignalCreated();
  return selectedSignalEngine().effect(fn);
}
