/**
 * selection.ts - Static signal-engine selection (internal seam, #723).
 *
 * One engine per application, chosen at startup before any signal is created
 * or any compiled program is activated; there is no per-update dispatch. When
 * selection never happens the default remains the built-in Preact adapter —
 * the only engine supported and verified in 1.0.0-alpha.1. The framework
 * intrinsics (framework.ts) and the host signals handed to the compiled
 * runtime all flow through this one engine.
 *
 * This seam is internal: it is not re-exported from the package root, and
 * selecting an arbitrary third-party engine is not a supported product
 * promise.
 *
 * @module ./selection.ts
 */

import { createPreactEngine } from './preact-engine.ts';
import { isSignalLike, type SignalEngine } from './types.ts';

/** Stable diagnostic codes for closed selection failures. */
export const SIGNAL_ENGINE_INVALID = 'OPEN_ELEMENT_SIGNAL_ENGINE_INVALID';
export const SIGNAL_ENGINE_LOCKED = 'OPEN_ELEMENT_SIGNAL_ENGINE_LOCKED';
export const SIGNAL_ENGINE_ACTIVATED = 'OPEN_ELEMENT_SIGNAL_ENGINE_ACTIVATED';

/** Structured diagnostic raised when engine selection fails closed. */
export class SignalEngineSelectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[signal-engine] ${message}`);
    this.name = 'SignalEngineSelectionError';
    this.code = code;
  }
}

let selected: SignalEngine | undefined;
let signalsCreated = false;
let programsActivated = false;

/** The statically selected engine (default: the Preact adapter). */
export function selectedSignalEngine(): SignalEngine {
  selected ??= createPreactEngine();
  return selected;
}

/** Record framework signal creation so a later engine switch fails closed. */
export function noteSignalCreated(): void {
  signalsCreated = true;
}

/** Record compiled program activation so a later engine switch fails closed. */
export function noteCompiledProgramActivated(): void {
  programsActivated = true;
}

function assertConformingEngine(engine: SignalEngine): void {
  const candidate = engine as Partial<SignalEngine> | null | undefined;
  if (
    candidate === null || candidate === undefined ||
    typeof candidate.signal !== 'function' ||
    typeof candidate.computed !== 'function' ||
    typeof candidate.effect !== 'function'
  ) {
    throw new SignalEngineSelectionError(
      SIGNAL_ENGINE_INVALID,
      'the selected engine must implement signal(), computed(), and effect()',
    );
  }
  if (!isSignalLike(candidate.signal(0))) {
    throw new SignalEngineSelectionError(
      SIGNAL_ENGINE_INVALID,
      'the selected engine signal() must return a branded protocol signal',
    );
  }
}

/**
 * Statically select the one signal engine for this application. This validates
 * the protocol seam; it does not promise third-party engine support.
 * Re-selecting the same engine instance is a no-op; switching fails closed
 * once signals were created or compiled programs activated.
 */
export function selectSignalEngine(engine: SignalEngine): void {
  assertConformingEngine(engine);
  if (engine === selected) return;
  if (programsActivated) {
    throw new SignalEngineSelectionError(
      SIGNAL_ENGINE_ACTIVATED,
      'cannot switch the signal engine after compiled programs activated',
    );
  }
  if (signalsCreated) {
    throw new SignalEngineSelectionError(
      SIGNAL_ENGINE_LOCKED,
      'cannot switch the signal engine after signals were created',
    );
  }
  selected = engine;
}
