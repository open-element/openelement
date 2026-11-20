/**
 * CEM INPUT migration (D-② phase 1) — generator acceptance and artifact pins.
 *
 * The generated-element branch is exercised end to end from a REAL fixture root
 * (a directory of `.tsx` modules, never `packages/ui/src/`), while the shipped
 * artifacts stay byte-identical:
 *
 * - a class-authored module still takes the untouched class branch;
 * - the fixture module really is emitted by the generated native element lane,
 *   and the projection's class name is that artifact's own named export;
 * - the fixture root never enters the shipped manifest, and the tracked
 *   manifest bytes are unchanged;
 * - the CEM projection still reproduces the tracked `custom-elements.json`
 *   byte-for-byte and stays class-only.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { formatJson } from '@openelement/element/build-utils';
import { compileGeneratedElementIfAdmitted } from '../../compiler/src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { buildCustomElementsManifest, validateCustomElementsManifest } from './generate-cem.ts';
import {
  buildManifest,
  buildManifestFromRoot,
  type GeneratedElementTagResolver,
} from './generate-ui-manifest.ts';
import { readGeneratedElementFacts } from './generated-element-facts.ts';

const UI_ROOT = new URL('../', import.meta.url);
const FIXTURES = join(import.meta.dirname, '__fixtures__', 'function-components');
const ADMITTED = join(FIXTURES, 'admitted');

const FIXTURE_TAGS: ReadonlyMap<string, string> = new Map([
  ['open-fn-card.tsx', 'open-fn-card'],
  ['open-fn-panel.tsx', 'open-fn-panel'],
  // Stand-in host fact for the intentionally refused fixture; scanning the
  // whole tree must surface the lane's coded refusal, not skip the file.
  ['open-fn-no-sidecar.tsx', 'open-fn-no-sidecar'],
]);

const fixtureSites: GeneratedElementTagResolver = (file) => FIXTURE_TAGS.get(file) ?? null;

const PUBLISHED_TAGS = [
  'open-button',
  'open-input',
  'open-theme-toggle',
  'open-code-block',
  'open-dialog',
  'open-dropdown',
] as const;

function readFixture(file: string): string {
  return readFileSync(join(ADMITTED, file), 'utf8');
}

test('declines class-authored modules and leaves the class branch byte-identical', () => {
  // The subject is an INLINE class-authored module, not a file under src/:
  // every shipped component migrated to the generated lane (open-button and
  // open-input were the last two), so the repository no longer contains a
  // class-authored component to point at. The class branch itself is still
  // live and still shared, and this is the module that proves it.
  const classSource = [
    "import { element, OpenElement } from '@openelement/element';",
    '',
    "@element('open-button', { root: 'shadow-open' })",
    'export class XLegacy extends OpenElement {',
    '  render(): unknown {',
    '    return <div>legacy</div>;',
    '  }',
    '}',
    '',
  ].join('\n');
  // The projection is not the class path: a class-authored module is declined,
  // so generator dispatch keeps it on the untouched class branch.
  expect(
    readGeneratedElementFacts({ file: 'open-button.tsx', source: classSource, tag: 'x' }),
  ).toEqual({
    kind: 'declined',
  });

  // A relocated class module produces the class-branch declaration shape
  // (the class branch is shared, not duplicated for fixtures).
  const tempRoot = mkdtempSync(join(tmpdir(), 'ui-manifest-class-'));
  try {
    writeFileSync(join(tempRoot, 'open-button.tsx'), classSource);
    const fixtureRootManifest = buildManifestFromRoot(pathToFileURL(`${tempRoot}/`));
    expect(fixtureRootManifest.declarations).toHaveLength(1);
    const [declaration] = fixtureRootManifest.declarations;
    expect(declaration.tagName).toEqual('open-button');
    // The class branch is what carries the superclass fact; the generated
    // branch deliberately has none (its class extends a non-public base).
    expect(declaration.superclassName).toEqual('OpenElement');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('the fixture module really emits the named class the projection uses', () => {
  const source = readFixture('open-fn-card.tsx');
  // Consumer form: the real lane entry emits the fixture module, and the
  // projection's identity is that emitted artifact's named export (the
  // projection reads the export table; it carries no copy of the naming rule).
  const compiled = compileGeneratedElementIfAdmitted(source, 'open-fn-card.tsx', {
    site: { tag: 'open-fn-card' },
  });
  expect(compiled).not.toBeNull();
  const code = compiled!.code;
  expect(code).toContain('export default __oeFnCardElement;');
  expect(code).toContain('export { __oeFnCardElement as FnCardElement };');
  expect(code).toContain('export const __oeElementTag = "open-fn-card";');

  const read = readGeneratedElementFacts({ file: 'open-fn-card.tsx', source, tag: 'open-fn-card' });
  if (read.kind !== 'admitted') {
    throw new Error(`expected admission, got '${read.kind}'`);
  }
  expect(read.facts.className).toEqual('FnCardElement');
  expect(read.facts.exportName).toEqual('FnCardElement');
});

test('the fixture root is not part of the shipped manifest (tracked bytes unchanged)', () => {
  const fixtureManifest = buildManifestFromRoot(pathToFileURL(`${ADMITTED}/`), {
    site: fixtureSites,
  });
  expect(fixtureManifest.declarations.map((declaration) => declaration.tagName).sort()).toEqual([
    'open-fn-card',
    'open-fn-panel',
  ]);
  // Fixture declarations are emitted-class declarations: no authored-class
  // superclass, no delivery policy (a fixture root supplies no policy row) and
  // no invented events (the fixture constructs a CustomEvent in a helper but
  // never dispatches it).
  for (const declaration of fixtureManifest.declarations) {
    expect(declaration.superclassName).toBeUndefined();
    expect(declaration.events).toBeUndefined();
    expect(declaration.openElement?.ssr).toBeUndefined();
    expect(declaration.openElement?.dsd).toBeUndefined();
    expect(declaration.openElement?.layer).toBeUndefined();
    expect(declaration.openElement?.hydrate).toBeUndefined();
    expect(declaration.openElement?.status).toBeUndefined();
    expect(declaration.openElement?.tailwind).toBeUndefined();
  }

  const shipped = buildManifest();
  expect(shipped.declarations.map((declaration) => declaration.tagName).sort()).toEqual(
    [...PUBLISHED_TAGS].sort(),
  );
  for (const tag of FIXTURE_TAGS.values()) {
    expect(shipped.declarations.map((declaration) => declaration.tagName)).not.toContain(tag);
  }
  // The tracked manifest is byte-identical to a fresh in-memory build.
  expect(formatJson(shipped)).toEqual(
    readFileSync(new URL('src/generated-manifest.json', UI_ROOT), 'utf8'),
  );
  // ... and the no-argument build (a scan with no host facts) now fails loud on
  // the generated component instead of silently projecting nothing for it.
  expect(() => buildManifestFromRoot(new URL('src/', UI_ROOT))).toThrow(
    /needs a host-supplied generated-element site fact/,
  );
});

test('the tracked CEM is unchanged and carries no public superclass for any component', () => {
  const projected = buildCustomElementsManifest();
  validateCustomElementsManifest(projected);
  expect(formatJson(projected)).toEqual(
    readFileSync(new URL('custom-elements.json', UI_ROOT), 'utf8'),
  );
  expect(projected.modules).toHaveLength(PUBLISHED_TAGS.length);
  for (const module of projected.modules) {
    expect(module.kind).toEqual('javascript-module');
    for (const declaration of module.declarations) {
      expect(declaration.kind).toEqual('class');
      expect(declaration.customElement).toEqual(true);
      // EVERY published component now rides the generated lane (open-button and
      // open-input were the last two class-authored modules), so none of them
      // has a truthful public superclass: the emitted class extends the
      // non-public OpenElementBase. The class branch still emits `OpenElement`
      // for a class-authored module — pinned by the "declines class-authored
      // modules" row above with a class-shaped source.
      expect(
        'superclass' in declaration,
        `${String(declaration.tagName)} must not name a public superclass`,
      ).toEqual(false);
    }
  }
});

test('a refused function module in a scanned root fails loudly with the compiler code', () => {
  // Scanning the whole fixture tree includes the module without the island
  // sidecar: the generator must throw the lane's coded refusal instead of
  // silently dropping that file from the manifest.
  expect(() =>
    buildManifestFromRoot(pathToFileURL(`${FIXTURES}/`), { site: fixtureSites }),
  ).toThrow(/OEIR_GENERATED_ELEMENT_MISSING_SITE_MARKER/);
});

test('a function module without a host site fact keeps the fail-loud skip', () => {
  // Phase 1 has no live tag source: the shipped scan supplies no site fact, so
  // a function-shaped module there is still refused, not silently dropped.
  expect(() => buildManifestFromRoot(pathToFileURL(`${ADMITTED}/`))).toThrow(
    /needs a host-supplied generated-element site fact/,
  );
});
