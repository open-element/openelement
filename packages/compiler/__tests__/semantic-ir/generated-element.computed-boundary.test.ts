/**
 * ADR-0183 D-4 — where component-authored `computed` stands today.
 *
 * The measured state after the props unification (D-5, commit 022654aae):
 * a `computed` in a generated component is **admitted by the frontend**
 * (`GENERATED_ELEMENT_IMPORT_CLASSIFIER` classifies it as a core factory and
 * the function frontend lowers the body as a `derived` expression), and props
 * are now a tracked channel, so a computed closed over `props` would track
 * correctly. What it still lacks is the **binding source**: the generated
 * element root refuses the module with `OEIR_GENERATED_ELEMENT_UNBOUND_BINDING`
 * because a computed (like a `signal`) is a host binding the root must resolve,
 * and the shell's `createBindings` remains allocation-only / fixture-only —
 * there is no production binding source yet.
 *
 * This file pins the boundary, so the next slice starts from a measured fact
 * instead of re-deriving it: the day a production binding source lands, this
 * test flips from "refused with this identity" to "emitted and tracked", and
 * the flip is the evidence.
 */
import { expect, test } from 'vitest';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { GENERATED_ELEMENT_DIAGNOSTIC } from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';

const FILE = '/proj/src/islands/computed-probe.tsx';
const SITE = { tag: 'x-computed-probe' };

const SOURCE =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "import { computed } from '@openelement/element';\n" +
  "export const openElement = defineIslandConfig({ properties: { count: { reflect: true, default: 0 } }, hydrate: 'idle' });\n" +
  'function Probe(props: { count: number }) {\n' +
  '  const doubled = computed(() => props.count * 2);\n' +
  '  return <p>{doubled.value}</p>;\n' +
  '}\n' +
  'export default Probe;\n';

test('ADR-0183 D-4: a component-authored computed is admitted, but the root still has no binding source', () => {
  let thrown: unknown;
  try {
    compileGeneratedElementIfAdmitted(SOURCE, FILE, { site: SITE });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CompiledElementError);
  const codes = (thrown as CompiledElementError).diagnostics.map((diagnostic) => diagnostic.code);
  // The refusal is the MISSING BINDING SOURCE, not a grammar refusal: the
  // computed itself parses and lowers, and its name reaches the binding set.
  expect(codes).toContain(GENERATED_ELEMENT_DIAGNOSTIC.UNBOUND_BINDING);
});
