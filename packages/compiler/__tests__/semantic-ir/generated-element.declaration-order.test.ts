/**
 * ADR-0183 D-4 — a derived node may capture a setup local declared above it.
 *
 * Measured defect: the retained setup factory emitted every binding resource
 * (`signal`/`computed`) first and every setup local afterwards, regardless of
 * authored order. A component that resolves a shared helper once —
 * `const chrome = readingChromeStrings(props.locale);` followed by
 * `const label = computed(() => chrome.onThisPage);` — therefore emitted
 * `const label = ...` ABOVE `const chrome = ...`, i.e. a TDZ at runtime that no
 * diagnostic catches. Sharing ONE authored order is the only correct shape, and
 * it is what a site module with shared copy always writes.
 */
import { expect, test } from 'vitest';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';

const FILE = '/proj/src/islands/order-probe.tsx';
const SITE = { tag: 'x-order-probe' };

const SOURCE = `
import { computed } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import { readingChromeStrings } from './chrome-strings.ts';

export const openElement = defineIslandConfig({
  tag: 'x-order-probe',
  properties: { locale: { default: 'en' } },
});

function Probe(props: { locale: string }) {
  const chrome = readingChromeStrings(props.locale);
  const label = computed(() => chrome.onThisPage);
  return <p>{label.value}</p>;
}
export default Probe;
`;

test('ADR-0183 D-4: a setup local and a derived node keep the authored order', () => {
  const compiled = compileGeneratedElementIfAdmitted(SOURCE, FILE, { site: SITE });
  expect(compiled).not.toBeNull();
  const factory = compiled!.code.slice(compiled!.code.indexOf('function __oe_rootInstance'));
  const localIndex = factory.indexOf('const chrome =');
  const derivedIndex = factory.indexOf('const label = computed(');
  expect(localIndex).toBeGreaterThan(-1);
  expect(derivedIndex).toBeGreaterThan(-1);
  // The captured local must be declared FIRST: the reverse order is a TDZ.
  expect(localIndex).toBeLessThan(derivedIndex);
  // And the record carries both, so mount/claim resolve them.
  expect(factory).toMatch(/return \{[^}]*chrome[^}]*\}/);
  expect(factory).toMatch(/return \{[^}]*label[^}]*\}/);
});
