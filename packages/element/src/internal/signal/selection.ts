/**
 * selection.ts - The signal-engine seam.
 *
 * @preact/signals-core (through the built-in adapter in preact-engine.ts) is
 * the only engine supported and verified in 1.0.0-alpha.1. This internal seam
 * returns that adapter instance so the framework intrinsics
 * (framework.ts) and the host signals handed to the compiled runtime share
 * one engine.
 *
 * There is deliberately no arbitrary engine switching here: multiple engines
 * are not a supported product promise, so the seam is a single lazily created
 * default rather than a validated, lockable selector. The protocol type
 * (SignalEngine) is still the replaceable boundary used by the adapter and by
 * tests, but it is not re-exported from the package root.
 *
 * @module ./selection.ts
 */

import { createPreactEngine } from './preact-engine.ts';
import type { SignalEngine } from './types.ts';

let selected: SignalEngine | undefined;

/** The framework signal engine: the built-in Preact adapter. */
export function selectedSignalEngine(): SignalEngine {
  selected ??= createPreactEngine();
  return selected;
}
