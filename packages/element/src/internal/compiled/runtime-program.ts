/**
 * Private normalization boundary between the canonical JSON wire artifact and
 * Element execution. The wire grammar is owned by program.ts; executors only
 * receive an immutable, nominal RuntimeProgramIR produced after validation and
 * a real JSON round trip. Runtime-only instructions cannot enter this IR.
 */

import { type PartProgramV1, validatePartProgram } from '../protocol/part-program.ts';

declare const runtimeProgramBrand: unique symbol;

export type RuntimeProgramIR = PartProgramV1 & {
  readonly [runtimeProgramBrand]: true;
};

function freezeDeep(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) freezeDeep(child, seen);
  Object.freeze(value);
}

/** Validate, serialize, re-validate, and freeze one canonical wire program. */
export function normalizePartProgram(raw: unknown): RuntimeProgramIR {
  validatePartProgram(raw);
  const serialized = JSON.stringify(raw);
  if (serialized === undefined) {
    throw new Error('[compiled-program] canonical Part Program is not JSON serializable');
  }
  const normalized: unknown = JSON.parse(serialized);
  validatePartProgram(normalized);
  freezeDeep(normalized);
  return normalized as RuntimeProgramIR;
}
