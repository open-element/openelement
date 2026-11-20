/**
 * CEM INPUT migration (D-② phase 1) — the fixture reaches a schema-valid CEM
 * class declaration.
 *
 * The artifact-level acceptance: a real function-component fixture module is
 * projected into the internal package manifest, written through the unchanged
 * CEM writer (`generate-cem.ts`), and validated against the official
 * `custom-elements-manifest` 2.1.0 schema IN MEMORY. The declaration must be a
 * `kind: 'class'` custom element describing the emitted constructor, with the
 * attributes/slots/cssParts preserved:
 *
 * - `name` is the emitted module's named export (`FnCardElement`), never the
 *   author function (`FnCard`);
 * - `superclass` is absent: the emitted class extends the non-public
 *   `OpenElementBase`, so no fabricated `OpenElement` fallback may appear;
 * - `events` is absent: the function lane has no authored custom-event surface;
 * - a function-source declaration without a `className` still fails the
 *   writer's fail-closed guard — the generated path is not an exception.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { buildCustomElementsManifest, validateCustomElementsManifest } from './generate-cem.ts';
import type { UiManifest } from './generate-cem.ts';
import { buildManifestFromRoot, type GeneratedElementTagResolver } from './generate-ui-manifest.ts';

const ADMITTED = join(import.meta.dirname, '__fixtures__', 'function-components', 'admitted');

const FIXTURE_TAGS: ReadonlyMap<string, string> = new Map([
  ['open-fn-card.tsx', 'open-fn-card'],
  ['open-fn-panel.tsx', 'open-fn-panel'],
]);
const fixtureSites: GeneratedElementTagResolver = (file) => FIXTURE_TAGS.get(file) ?? null;

/**
 * The fixture package `exports` map: the generated fixture modules live under
 * `src/` as published components would, so the CEM module path resolves the
 * same way the shipped map does.
 */
const FIXTURE_EXPORTS = {
  './open-fn-card': './src/open-fn-card.tsx',
  './open-fn-panel': './src/open-fn-panel.tsx',
};

function fixtureManifest(): UiManifest {
  return buildManifestFromRoot(pathToFileURL(`${ADMITTED}/`), { site: fixtureSites });
}

test('fixture manifest becomes a schema-valid CEM class declaration with metadata', () => {
  const manifest = fixtureManifest();
  const cem = buildCustomElementsManifest({ manifest, exportsMap: FIXTURE_EXPORTS });
  validateCustomElementsManifest(cem);

  expect(cem.schemaVersion).toEqual('2.1.0');
  expect(cem.modules.map((module) => module.path).sort()).toEqual([
    'src/open-fn-card.tsx',
    'src/open-fn-panel.tsx',
  ]);
  const moduleAt = (path: string) => {
    const found = cem.modules.find((module) => module.path === path);
    if (found === undefined) throw new Error(`no CEM module for '${path}'`);
    return found;
  };

  const cardModule = moduleAt('src/open-fn-card.tsx');
  expect(cardModule.kind).toEqual('javascript-module');
  expect(cardModule.declarations).toHaveLength(1);
  const card = cardModule.declarations[0]!;
  expect(card.kind).toEqual('class');
  expect(card.customElement).toEqual(true);
  expect(card.name).toEqual('FnCardElement');
  expect(card.tagName).toEqual('open-fn-card');
  // The emitted constructor identity, not the author function name.
  expect(card.name).not.toEqual('FnCard');
  // No fabricated public superclass for an emitted class.
  expect('superclass' in card).toEqual(false);
  expect(card.description).toEqual('A card that shows a label and projects its children.');
  expect(card.attributes).toEqual([
    { name: 'label', type: { text: 'string' }, default: 'Untitled' },
  ]);
  expect(card.slots).toEqual([{ name: '' }, { name: 'header' }, { name: 'footer' }]);
  expect(card.cssParts).toEqual([{ name: 'container' }, { name: 'body' }, { name: 'icon' }]);
  // No invented events (the fixture authors an `onClick` handler and a
  // `CustomEvent` helper; neither is an event declaration).
  expect('events' in card).toEqual(false);
  // Names only: no synthetic slot/part descriptions on the generated path.
  for (const slot of card.slots ?? []) expect(Object.keys(slot)).toEqual(['name']);
  for (const part of card.cssParts ?? []) expect(Object.keys(part)).toEqual(['name']);

  const panel = moduleAt('src/open-fn-panel.tsx').declarations[0]!;
  expect(panel.kind).toEqual('class');
  expect(panel.name).toEqual('FnPanelElement');
  expect(panel.tagName).toEqual('open-fn-panel');
  expect('superclass' in panel).toEqual(false);
  // The sidecar's declared/effective attribute channels, including the
  // property renamed to `data-label`; the `attribute: false` row is not an
  // attribute.
  expect(panel.attributes).toEqual([
    { name: 'data-label', type: { text: 'string' }, default: 'Untitled' },
    { name: 'count', type: { text: 'number' }, default: '0' },
  ]);
  expect(panel.slots).toEqual([{ name: '' }]);
  expect(panel.cssParts).toEqual([{ name: 'panel' }]);
});

test('a declaration without className is refused by the writer guard, not accepted', () => {
  const manifest: UiManifest = {
    schemaVersion: '1.0.0',
    packageName: '@openelement/ui',
    version: '0.0.0-fixture',
    declarations: [
      // A raw function-source declaration: no emitted class identity.
      {
        tagName: 'open-fn-card',
        openElement: { module: '@openelement/ui/open-fn-card' },
      },
    ],
  };
  expect(() => buildCustomElementsManifest({ manifest, exportsMap: FIXTURE_EXPORTS })).toThrow(
    /has no className/,
  );
});

test('the writer does not fabricate a superclass for an emitted-class declaration', () => {
  const manifest: UiManifest = {
    schemaVersion: '1.0.0',
    packageName: '@openelement/ui',
    version: '0.0.0-fixture',
    declarations: [
      // Emitted-class declaration: it names its class but has no truthful
      // public superclass (the emitted parent is not a public export).
      {
        tagName: 'open-fn-card',
        className: 'FnCardElement',
        openElement: { module: '@openelement/ui/open-fn-card' },
      },
      // A declaration that DOES carry a superclass keeps it (the six tracked
      // class declarations take this branch; their bytes are unchanged).
      {
        tagName: 'open-fixture-class',
        className: 'OpenFixtureClass',
        superclassName: 'OpenElement',
        openElement: { module: '@openelement/ui/open-fn-card' },
      },
    ],
  };
  const cem = buildCustomElementsManifest({ manifest, exportsMap: FIXTURE_EXPORTS });
  validateCustomElementsManifest(cem);
  const [emitted, authored] = cem.modules.map((module) => module.declarations[0]!);
  expect('superclass' in emitted!).toEqual(false);
  expect(authored!.superclass).toEqual({ name: 'OpenElement', package: '@openelement/element' });
});
