/**
 * CEM INPUT migration (D-② phase 1) — generated-element fact projection.
 *
 * These tests pin the projection that lets a REAL function-component module
 * reach the UI manifest without a second parser, a second sidecar reader, a
 * component whitelist or a duplicated emitter naming rule:
 *
 * - the class identity is the emitted module's own named export, read from the
 *   emitted artifact — never the author function name;
 * - attributes are the compiler lane's resolved descriptor rows (attribute
 *   channels only) with their effective defaults/reflection;
 * - slots/cssParts are NAMES from the lowered JSX model, with no synthesized
 *   descriptions;
 * - the description is the authored JSDoc summary read through the compiler's
 *   parse; an absent JSDoc stays absent;
 * - events are never invented from `on*` handlers or `CustomEvent` text;
 * - a module without the island sidecar is refused with the compiler's own
 *   coded diagnostic.
 *
 * Fixture sources are read as text from `./__fixtures__/function-components/`;
 * they are never scanned from `packages/ui/src/`, never shipped and never
 * type-checked by the ui package.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { GENERATED_ELEMENT_DIAGNOSTIC } from '../../compiler/src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { buildGeneratedElementDeclaration } from './generate-ui-manifest.ts';
import {
  formatGeneratedElementRefusals,
  readGeneratedElementFacts,
  type GeneratedElementFacts,
} from './generated-element-facts.ts';

const FIXTURES = join(import.meta.dirname, '__fixtures__', 'function-components');
const ADMITTED = join(FIXTURES, 'admitted');
const REFUSED = join(FIXTURES, 'refused');

function fixtureSource(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8');
}

function admittedFacts(file: string, tag: string): GeneratedElementFacts {
  const read = readGeneratedElementFacts({ file, source: fixtureSource(ADMITTED, file), tag });
  if (read.kind !== 'admitted') {
    const detail = read.kind === 'refused' ? formatGeneratedElementRefusals(read.diagnostics) : '';
    throw new Error(`expected '${file}' to be admitted, got '${read.kind}'\n${detail}`);
  }
  return read.facts;
}

test('derives the emitted class identity, not the author function name', () => {
  const facts = admittedFacts('open-fn-card.tsx', 'open-fn-card');
  // The author function is `FnCard`; the shipped constructor is `FnCardElement`
  // (the emitted module's own named export). The manifest names the emitted
  // class, not the author function and not a synthesized class.
  expect(facts.className).toEqual('FnCardElement');
  expect(facts.className).not.toEqual('FnCard');
  expect(facts.exportName).toEqual(facts.className);
  expect(facts.tag).toEqual('open-fn-card');
  expect(facts.module).toEqual('@openelement/ui/open-fn-card');

  const declaration = buildGeneratedElementDeclaration(facts);
  expect(declaration.className).toEqual('FnCardElement');
  expect(declaration.tagName).toEqual('open-fn-card');
  expect(declaration.openElement?.export).toEqual('FnCardElement');
  // The emitted class extends the non-public `OpenElementBase`: there is no
  // truthful public superclass, so none is claimed.
  expect('superclassName' in declaration).toEqual(false);
});

test('maps compiler descriptor rows to attributes (attribute channels only)', () => {
  const facts = admittedFacts('open-fn-panel.tsx', 'open-fn-panel');
  expect(facts.attributes).toEqual([
    // Attribute renamed in the sidecar: `label` is written as `data-label`.
    {
      name: 'data-label',
      type: 'string',
      default: 'Untitled',
      reflects: true,
      fieldName: 'label',
    },
    // Omitted default resolves to the shell's effective zero value.
    { name: 'count', type: 'number', default: '0' },
  ]);
  // `padding` declares `attribute: false` (property-only channel): it is not an
  // attribute and must not be invented as one.
  expect(facts.attributes.some((attribute) => attribute.name === 'padding')).toEqual(false);
});

test('derives slots and cssParts from the function model, names only', () => {
  const facts = admittedFacts('open-fn-card.tsx', 'open-fn-card');
  // Default slot first, then authored order.
  expect(facts.slots.map((slot) => slot.name)).toEqual(['', 'header', 'footer']);
  // Nested element parts are collected in authored order; `body` appears twice
  // (once standalone, once in a whitespace-separated `part` value) and is
  // deduplicated; `icon` comes from the same multi-name part attribute.
  expect(facts.cssParts.map((part) => part.name)).toEqual(['container', 'body', 'icon']);
  // No synthetic descriptions on the generated path.
  for (const slot of facts.slots) expect(Object.keys(slot)).toEqual(['name']);
  for (const part of facts.cssParts) expect(Object.keys(part)).toEqual(['name']);
});

test('reads the authored JSDoc description through the compiler parse', () => {
  // Only the first summary paragraph is projected; the blank-line-separated
  // second paragraph is not.
  expect(admittedFacts('open-fn-card.tsx', 'open-fn-card').description).toEqual(
    'A card that shows a label and projects its children.',
  );
  // No JSDoc on the component: the description stays absent instead of being
  // invented from the file header or tag name.
  const panel = admittedFacts('open-fn-panel.tsx', 'open-fn-panel');
  expect(panel.description).toEqual('');
  expect('description' in buildGeneratedElementDeclaration(panel)).toEqual(false);
});

test('does not invent events from handlers or CustomEvent text', () => {
  // `open-fn-card.tsx` authors an `onClick` handler and a module-level
  // `new CustomEvent('card-change', …)` helper.
  const facts = admittedFacts('open-fn-card.tsx', 'open-fn-card');
  expect('events' in facts).toEqual(false);
  const declaration = buildGeneratedElementDeclaration(facts);
  expect(declaration.events).toBeUndefined();
  expect('events' in declaration).toEqual(false);
});

test('publishes the compiled host root and the declared stylesheet specifiers', () => {
  const STYLED = join(FIXTURES, 'styled');
  const read = readGeneratedElementFacts({
    file: 'open-fn-styled.tsx',
    source: readFileSync(join(STYLED, 'open-fn-styled.tsx'), 'utf8'),
    tag: 'open-fn-styled',
  });
  if (read.kind !== 'admitted') {
    throw new Error(`expected admission, got '${read.kind}'`);
  }
  // The facts carry what a consuming build needs to register the island's
  // declaration without re-reading or re-compiling the package source.
  expect(read.facts.root).toEqual('shadow');
  expect(read.facts.styles).toEqual(['./open-fn-styled.css']);

  const declaration = buildGeneratedElementDeclaration(read.facts);
  expect(declaration.openElement?.root).toEqual('shadow');
  expect(declaration.openElement?.styles).toEqual(['./open-fn-styled.css']);
});

test('refuses a styles declaration with no static string specifier', () => {
  const source =
    "import { defineIslandConfig } from '@openelement/router';\n" +
    'export const openElement = defineIslandConfig({ styles: [suffix] });\n' +
    'function FnBad() {\n' +
    '  return <span>static</span>;\n' +
    '}\n' +
    'export default FnBad;\n';
  const read = readGeneratedElementFacts({ file: 'open-fn-bad.tsx', source, tag: 'open-fn-bad' });
  expect(read.kind).toEqual('refused');
  if (read.kind !== 'refused') return;
  expect(read.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    'UI_MANIFEST_STYLES_INVALID',
  );
});

test('refuses a module without the island sidecar (compiler diagnostic propagates)', () => {
  const read = readGeneratedElementFacts({
    file: 'open-fn-no-sidecar.tsx',
    source: fixtureSource(REFUSED, 'open-fn-no-sidecar.tsx'),
    tag: 'open-fn-no-sidecar',
  });
  if (read.kind !== 'refused') throw new Error(`expected a refusal, got '${read.kind}'`);
  expect(read.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    GENERATED_ELEMENT_DIAGNOSTIC.MISSING_SITE_MARKER,
  );
  const [diagnostic] = read.diagnostics;
  expect(diagnostic.file).toEqual('open-fn-no-sidecar.tsx');
  expect(diagnostic.line).toBeGreaterThan(0);
  expect(formatGeneratedElementRefusals(read.diagnostics)).toContain(
    GENERATED_ELEMENT_DIAGNOSTIC.MISSING_SITE_MARKER,
  );
});
