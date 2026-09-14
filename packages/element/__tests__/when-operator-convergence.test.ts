/**
 * `when` Region operator convergence guard (issue #1220, M3).
 *
 * The `when` comparison is evaluated by the runtime/claim path and the server
 * serializer (packages/element/src/internal/compiled/runtime.ts and
 * .../server/index.ts), and the canonical Part Program validator closes the
 * operator space to 'greater-than', so the evaluators cannot diverge today.
 * This guard pins that: the validator must keep rejecting every other
 * operator, and the evaluation sites must keep implementing exactly
 * `Number(value) > part.test.value`. If a future operator is ever admitted,
 * this test forces the sites to be updated together instead of silently
 * drifting.
 */

import { assert, assertEquals, assertThrows } from '@std/assert';
import { validatePartProgram } from '../src/internal/protocol/part-program.ts';
import { testProgram } from './compiled-runtime/test-program.ts';

const REPO_ROOT = new URL('../../../', import.meta.url);

const EVALUATION_SITES = [
  'packages/element/src/internal/compiled/runtime.ts',
  'packages/element/src/internal/compiled/server/index.ts',
];

function whenProgram() {
  return testProgram({
    tag: 'oe-when-guard',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{
      k: 'when',
      index: 0,
      signal: 'count',
      test: { signal: 'count', op: 'greater-than', value: 0 },
      on: [{ k: 'text', value: 'on' }],
      off: [{ k: 'text', value: 'off' }],
    }],
  });
}

Deno.test('when operator: the validator accepts greater-than and rejects any other operator', () => {
  validatePartProgram(whenProgram());

  const widened = structuredClone(whenProgram()) as {
    parts: Array<{ test: { op: string } }>;
  };
  for (const op of ['less-than', 'equals', 'greater-or-equal', 'not-equals']) {
    widened.parts[0].test.op = op;
    assertThrows(
      () => validatePartProgram(widened),
      Error,
      'greater-than',
      `validator admitted operator ${op}`,
    );
  }
});

Deno.test('when operator: the canonical ConditionOperator declaration is closed to greater-than', async () => {
  const path = 'packages/element/src/internal/protocol/part-program.ts';
  const source = await Deno.readTextFile(new URL(path, REPO_ROOT));
  assert(
    source.includes("export type ConditionOperator = 'greater-than';"),
    `${path}: ConditionOperator widened — update every whenIsActive site in the same change`,
  );
});

Deno.test('when operator: evaluation sites implement exactly Number(value) > part.test.value', async () => {
  for (const path of EVALUATION_SITES) {
    const source = await Deno.readTextFile(new URL(path, REPO_ROOT));
    const comparisons = [
      ...source.matchAll(/Number\(value\)\s*([<>]=?|===?|!==?)\s*part\.test\.value/g),
    ];
    assertEquals(
      comparisons.map((match) => match[1]),
      ['>'],
      `${path}: when comparison drifted from the validator-closed greater-than semantics`,
    );
  }
});
