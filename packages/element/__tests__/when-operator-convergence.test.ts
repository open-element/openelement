/**
 * `when` Region operator convergence guard (issue #1220, M3; widened by #1372).
 *
 * The `when` test is evaluated by the runtime/claim path and the server
 * serializer (packages/element/src/internal/compiled/runtime.ts and
 * .../server/index.ts), and the canonical Part Program validator plus the
 * server wire validator close the operator/literal space. Since #1372 both
 * evaluators route through the single `conditionHolds` module and both
 * validators through the single `conditionLiteralAllowed` predicate. This
 * guard pins that: no evaluation site may grow a private comparison, no
 * validator may admit an operator/literal pair the predicate rejects, and
 * the operator set stays closed to the seven admitted forms.
 */

import { assert, assertEquals, assertThrows } from '@std/assert';
import {
  type ConditionOperator,
  validatePartProgram,
} from '../src/internal/protocol/part-program.ts';
import { conditionHolds } from '../src/internal/compiled/condition-holds.ts';
import { testProgram } from './compiled-runtime/test-program.ts';

const REPO_ROOT = new URL('../../../', import.meta.url);

const EVALUATION_SITES = [
  'packages/element/src/internal/compiled/runtime.ts',
  'packages/element/src/internal/compiled/server/index.ts',
];

const ADMITTED_OPS = [
  'greater-than',
  'greater-or-equal',
  'less-than',
  'less-or-equal',
  'equals',
  'not-equals',
  'truthy',
] as const;

function whenProgram(op: string, value: number | string | boolean | null) {
  return testProgram({
    tag: 'oe-when-guard',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{
      k: 'when',
      index: 0,
      signal: 'count',
      test: {
        signal: 'count',
        op: op as ConditionOperator,
        value: value as number | string | boolean,
      },
      on: [{ k: 'text', value: 'on' }],
      off: [{ k: 'text', value: 'off' }],
    }],
  });
}

Deno.test('when operator: the validator admits every documented operator and rejects anything else', () => {
  // One shape the predicate allows per operator.
  const allowed: Array<[string, number | string | boolean]> = [
    ['greater-than', 0],
    ['greater-or-equal', 0],
    ['less-than', 10],
    ['less-or-equal', 10],
    ['equals', 'pending'],
    ['not-equals', false],
    ['truthy', true],
  ];
  for (const [op, value] of allowed) {
    validatePartProgram(whenProgram(op, value));
  }

  // Unknown operators stay closed.
  for (const op of ['contains', 'matches', '', '>', 'GREATHER-THAN']) {
    assertThrows(
      () => validatePartProgram(whenProgram(op, 0)),
      Error,
      'truthiness',
      `validator admitted operator ${JSON.stringify(op)}`,
    );
  }

  // Operator/literal mismatches stay closed: ordering needs a finite number,
  // equality admits number/string/boolean, truthy admits exactly true/false.
  const mismatched: Array<[string, number | string | boolean | null]> = [
    ['greater-than', '0'],
    ['greater-than', true],
    ['greater-than', Number.NaN],
    ['less-than', '10'],
    ['equals', null],
    ['truthy', 1],
    ['truthy', 'yes'],
  ];
  for (const [op, value] of mismatched) {
    assertThrows(
      () => validatePartProgram(whenProgram(op, value)),
      Error,
      'truthiness',
      `validator admitted ${op} with literal ${JSON.stringify(value)}`,
    );
  }
});

Deno.test('when operator: the canonical ConditionOperator declaration stays closed to the admitted set', async () => {
  const path = 'packages/element/src/internal/protocol/part-program.ts';
  const source = await Deno.readTextFile(new URL(path, REPO_ROOT));
  for (const op of ADMITTED_OPS) {
    assert(
      source.includes(`| '${op}'`),
      `${path}: ConditionOperator lost the '${op}' arm — widen every evaluator in the same change`,
    );
  }
  assert(
    source.includes('export function conditionLiteralAllowed'),
    `${path}: the shared operator/literal predicate moved — update the validators together`,
  );
});

Deno.test('when operator: evaluation sites route through conditionHolds, no private comparisons', async () => {
  for (const path of EVALUATION_SITES) {
    const source = await Deno.readTextFile(new URL(path, REPO_ROOT));
    assert(
      source.includes("import { conditionHolds } from './condition-holds.ts'") ||
        source.includes("import { conditionHolds } from '../condition-holds.ts'"),
      `${path}: when evaluation must import the canonical conditionHolds module`,
    );
    const privateComparisons = [
      ...source.matchAll(/Number\(value\)\s*([<>]=?|===?|!==?)\s*(part\.test\.)?value/g),
    ];
    assertEquals(
      privateComparisons.length,
      0,
      `${path}: when comparison drifted out of the shared module`,
    );
  }
});

Deno.test('when operator: conditionHolds semantics per operator (#1372)', () => {
  const holds = (op: string, value: number | string | boolean, v: unknown) =>
    conditionHolds({ signal: 'x', op: op as never, value }, v);

  // Ordering coerces with Number() (pre-#1372 behavior preserved).
  assertEquals(holds('greater-than', 5, 6), true);
  assertEquals(holds('greater-than', 5, '6'), true);
  assertEquals(holds('greater-than', 5, 5), false);
  assertEquals(holds('greater-or-equal', 5, 5), true);
  assertEquals(holds('greater-or-equal', 5, 4.9), false);
  assertEquals(holds('less-than', 5, '4'), true);
  assertEquals(holds('less-or-equal', 5, 5), true);
  assertEquals(holds('less-or-equal', 5, 5.1), false);

  // Equality is strict: no cross-type coercion.
  assertEquals(holds('equals', 'pending', 'pending'), true);
  assertEquals(holds('equals', 'pending', 'other'), false);
  assertEquals(holds('equals', 1, '1'), false);
  assertEquals(holds('equals', 1, 1), true);
  assertEquals(holds('not-equals', false, false), false);
  assertEquals(holds('not-equals', false, true), true);
  assertEquals(holds('not-equals', 'a', 0), true);

  // Truthiness compares Boolean(value) against the recorded expectation.
  assertEquals(holds('truthy', true, 'x'), true);
  assertEquals(holds('truthy', true, ''), false);
  assertEquals(holds('truthy', true, 0), false);
  assertEquals(holds('truthy', false, ''), true);
  assertEquals(holds('truthy', false, 'x'), false);
});
