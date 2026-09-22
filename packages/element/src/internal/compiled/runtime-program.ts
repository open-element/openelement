/**
 * Private normalization boundary between the canonical JSON wire artifact and
 * Element execution. The wire grammar is owned by program.ts; executors only
 * receive an immutable, nominal RuntimeProgramIR produced after validation and
 * a real JSON round trip. Runtime-only instructions cannot enter this IR.
 */

import { type PartProgramV1, validatePartProgram } from '../protocol/part-program.ts';
// Single error dialect (#1386 item 3): serializability failures carry a code.
import { frameworkError, ProgramErrorCode } from '../protocol/errors.ts';

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

/**
 * Normalization is memoized by program object identity: a compiled module
 * evaluates its `__partProgram` literal once, so every connect of every
 * instance of that element reuses the one validated, frozen IR instead of
 * paying validate -> JSON round trip -> revalidate -> freeze per connect.
 */
const normalizedByProgram = new WeakMap<object, RuntimeProgramIR>();

/** Validate, serialize, re-validate, and freeze one canonical wire program. */
export function normalizePartProgram(raw: unknown): RuntimeProgramIR {
  if (typeof raw === 'object' && raw !== null) {
    const cached = normalizedByProgram.get(raw);
    if (cached !== undefined) return cached;
  }
  validatePartProgram(raw);
  const serialized = JSON.stringify(raw);
  if (serialized === undefined) {
    throw frameworkError(
      ProgramErrorCode.NOT_SERIALIZABLE,
      '[compiled-program] canonical Part Program is not JSON serializable',
      { phase: 'validation' },
    );
  }
  const normalized: unknown = JSON.parse(serialized);
  validatePartProgram(normalized);
  freezeDeep(normalized);
  const ir = normalized as RuntimeProgramIR;
  if (typeof raw === 'object' && raw !== null) normalizedByProgram.set(raw, ir);
  return ir;
}
