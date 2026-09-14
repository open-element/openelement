/**
 * index.ts - Reactive signals powered by @preact/signals-core.
 *
 * @preact/signals-core (via the built-in preact-engine adapter) is the only
 * engine supported and verified in 1.0.0-alpha.1. Preact's own API is not
 * Element public API, and this internal barrel is not re-exported from the
 * package root; the root exposes only the protocol types and the
 * signal()/computed()/effect() framework functions.
 *
 * Architecture:
 *   Engine layer    -> @preact/signals-core adapter (preact-engine.ts)
 *   Framework layer -> User-friendly API: signal(), computed(), effect()
 *
 * @module ./index.ts
 */

// ─── Public types ───────────────────────────────────────────────
export type {
  ReadonlySignal,
  Signal,
  SignalEngine,
  SignalLike,
  Unsubscribe,
  WritableSignal,
} from '../protocol/signal.ts';
export { isSignalLike, unwrapSignalLike } from './types.ts';

// Internal static engine-selection seam (#723). One engine per application,
// selected before signals exist; also not re-exported from the package root.
export {
  selectedSignalEngine,
  selectSignalEngine,
  SIGNAL_ENGINE_ACTIVATED,
  SIGNAL_ENGINE_INVALID,
  SIGNAL_ENGINE_LOCKED,
  SignalEngineSelectionError,
} from './selection.ts';

// ─── Framework layer ────────────────────────────────────────────
export { computed, effect, signal } from './framework.ts';
