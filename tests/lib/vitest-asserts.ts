/**
 * vitest equivalents of @std/assert's throwing-assertion family that carries
 * semantic surface vitest cannot express in one call (B3 test migration).
 *
 * std's `assertThrows(fn, ErrorClass, msgIncludes)` checks instance AND
 * message-substring AND hands the caught error back. vitest's
 * `expect(fn).toThrow(new C(msg))` compares message by EQUALITY (verified
 * empirically 2026-10-02: a strict substring fails) and ignores the error
 * class entirely when given an instance — neither matches. Double
 * `expect(fn).toThrow(...)` calls would invoke `fn` twice, which is not
 * equivalent for non-idempotent closures.
 *
 * These helpers keep the exact std semantics in ONE invocation and return
 * the caught error, so migrated capture-sites (`const err = assertThrows(...)`)
 * keep their bindings:
 *
 *   const err = assertThrowsIncludes(() => compile(x), CompileError, 'bad op');
 *   const err = await assertRejectsIncludes(() => action(), RedirectError);
 *
 * A trailing std-style assertion message rides as the last parameter and is
 * reported by the underlying expects.
 *
 * NOTE (assertEquals → toEqual deltas, verified empirically in B3 review):
 * ±0 std-equal/vitest-not, {a:undefined}-vs-{} and same-shape-cross-class
 * std-not/vitest-equal. No migrated call site hits these (repo grep at
 * cutover); details in codemod-deno-test-to-vitest.ts's mapping header.
 */
import { expect } from 'vitest';

type ErrorCtor = abstract new (...args: never[]) => Error;

function expectThrown(
  thrown: unknown,
  errorClass?: ErrorCtor,
  msgIncludes?: string,
  message?: string,
): void {
  // std with no class accepts any thrown value (including non-Errors)
  if (errorClass !== undefined) {
    expect(thrown, message).toBeInstanceOf(errorClass);
  } else {
    expect(thrown === undefined, message ?? 'expected the call to throw').toBe(false);
  }
  if (msgIncludes !== undefined) {
    const actual = thrown instanceof Error ? thrown.message : String(thrown);
    expect(actual, message).toContain(msgIncludes);
  }
}

/**
 * std `assertThrows(fn, errorClass?, msgIncludes?, message?)` — runs `fn`
 * once, expects a throw matching the class and message-substring, and
 * returns the caught error.
 */
export function assertThrowsIncludes(
  fn: () => unknown,
  errorClass?: ErrorCtor,
  msgIncludes?: string,
  message?: string,
): Error {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expectThrown(thrown, errorClass, msgIncludes, message);
  return thrown as Error;
}

/**
 * std `assertRejects(fn, errorClass?, msgIncludes?, message?)` — awaits `fn`
 * once, expects a rejection matching the class and message-substring, and
 * returns the caught error.
 */
export async function assertRejectsIncludes(
  fn: () => unknown,
  errorClass?: ErrorCtor,
  msgIncludes?: string,
  message?: string,
): Promise<Error> {
  let thrown: unknown;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  expectThrown(thrown, errorClass, msgIncludes, message);
  return thrown as Error;
}
