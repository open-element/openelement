/**
 * Canonical when-Region condition evaluation (issue #1372, P6).
 *
 * The `when` test is evaluated by the fresh-DOM runtime, the claim path, and
 * the server serializer. Before #1372 every site carried its own
 * `Number(value) > part.test.value`; this module is the single source all
 * three executors import, so admitting new operators (>=, <, <=, ===, !==,
 * bare-signal truthiness) cannot drift between modes. The convergence guard
 * in `__tests__/when-operator-convergence.test.ts` pins the imports.
 *
 * Semantics:
 * - ordering operators coerce the signal value with `Number()` and compare
 *   against a finite numeric literal (the pre-#1372 behavior);
 * - `equals`/`not-equals` are strict (`===`/`!==`) against a number, string,
 *   or boolean literal — no coercion, so `1` never matches `"1"`;
 * - `truthy` compares `Boolean(value)` against the recorded expectation
 *   (`true` for `{this.prop && …}`, `false` for `{!this.prop && …}`).
 */

import type { ProgramCondition } from '../protocol/part-program.ts';
// Single error dialect (#1386 item 3): the evaluation fail-closed path carries a code.
import { frameworkError, ProgramErrorCode } from '../protocol/errors.ts';

/**
 * Wire validation guarantees ordering operators carry a numeric literal; a
 * program that reached evaluation without one fails closed here rather than
 * coercing a string/boolean into a threshold.
 */
function numericThreshold(test: ProgramCondition): number {
  if (typeof test.value !== 'number') {
    throw frameworkError(
      ProgramErrorCode.NON_NUMERIC_CONDITION,
      `when test operator ${test.op} requires a numeric literal`,
      { phase: 'validation' },
    );
  }
  return test.value;
}

export function conditionHolds(test: ProgramCondition, value: unknown): boolean {
  switch (test.op) {
    case 'greater-than':
      return Number(value) > numericThreshold(test);
    case 'greater-or-equal':
      return Number(value) >= numericThreshold(test);
    case 'less-than':
      return Number(value) < numericThreshold(test);
    case 'less-or-equal':
      return Number(value) <= numericThreshold(test);
    case 'equals':
      return value === test.value;
    case 'not-equals':
      return value !== test.value;
    case 'truthy':
      return Boolean(value) === test.value;
  }
}
