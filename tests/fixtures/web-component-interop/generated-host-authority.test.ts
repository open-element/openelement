/**
 * M09-3 generated-host AUTHORITY test — Node only, no browser, no build.
 *
 * The generated host must be a real product-lane artifact, not fixture
 * hand-writing. This test therefore:
 *
 * - reads the REAL authored island (`app/islands/interop-generated-host.tsx`);
 * - derives the delivered tag with `transformIslandSource`, the same island
 *   path admission and `pathToTagName` the router's generated-element site
 *   resolver calls (one tag authority, not a basename guess);
 * - runs the REAL `compileGeneratedElementIfAdmitted` lane entry over that
 *   source and asserts facts on the compiled module text (descriptor root,
 *   default-export constructor, `__ssrHost` producer, no registration, the
 *   authored slot/part/event channels lowered by the leaf), not a regex over
 *   the built HTML;
 * - checks the fixture wiring (page/client/id/counter references) still mirrors
 *   the canonical corpus block.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { transformIslandSource } from '@openelement/element/build-utils';
import { compileGeneratedElementIfAdmitted } from '@openelement/compiler';
import { loadInteropCorpus } from './qualify.ts';

const fixtureRoot = new URL('./', import.meta.url);

/** The build's default islands directory (`packages/router/src/vite/internal/paths.ts`). */
const islandsDir = 'app/islands';
const islandFile = 'app/islands/interop-generated-host.tsx';

function readFixtureFile(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, fixtureRoot)), 'utf8');
}

test('the real generated-host island is admitted by the generated-element lane', async () => {
  const corpus = await loadInteropCorpus(fixtureRoot);
  const source = await readFixtureFile(islandFile);

  // Tag authority: identical call shape to the router site resolver (empty
  // source keeps the derivation, the returned code is intentionally ignored).
  const { islands } = transformIslandSource('', { islandsDir, filePath: islandFile });
  expect(islands.map((island) => island.tagName)).toEqual([corpus.generatedHost.tag]);

  const compiled = compileGeneratedElementIfAdmitted(source, islandFile, {
    site: { tag: corpus.generatedHost.tag },
  });
  expect(compiled).not.toBeNull();
  expect(compiled?.tag).toEqual(corpus.generatedHost.tag);
  expect(compiled?.component).toEqual('InteropGeneratedHost');

  const code = compiled!.code;
  // The real emitter product: the default export IS the constructor the island
  // client entry registers, and the descriptor carries the sidecar's shadow root.
  expect(code).toContain('createGeneratedElementClass');
  expect(code).toContain('export default');
  expect(code).toContain(`root: "shadow-open"`);
  expect(code).toContain(
    `export const __oeElementTag = ${JSON.stringify(corpus.generatedHost.tag)}`,
  );
  // Zero declared primitive properties: the slice invented no property table.
  expect(code).toContain('properties: []');
  // The shadow-host DSD producer exists (the single M11 call target) while the
  // module still performs no registration — that stays the client entry's job.
  expect(code).toContain('__ssrHost');
  expect(code).not.toContain('customElements.define');
  // The authored shadow channels were really lowered by the leaf: native slots,
  // the static part attribute, and the M09-2c intrinsic event channel (listener
  // installed and scope-owned; no DOM event attribute, no host dispatch API).
  expect(code).toContain('document.createElement("slot")');
  expect(code).toContain('setAttribute("part", "control")');
  expect(code).toContain('addEventListener("click"');
  expect(code).toContain('removeEventListener("click"');
  expect(code).not.toContain('setAttribute("onClick"');
  // Client-only boundary of this slice: the sidecar is authored with ssr:false
  // (entry-level DSD SSR for generated islands is M11 wiring).
  expect(source).toContain('ssr: false');
  // The authored handler writes the corpus-declared counter key.
  expect(source).toContain(corpus.generatedHost.hitsStateKey);
});

test('the fixture page/client wiring mirrors the corpus generated-host block', async () => {
  const corpus = await loadInteropCorpus(fixtureRoot);
  const generatedHost = corpus.generatedHost;
  const page = await readFixtureFile('app/components/page-interop-home.tsx');
  const client = await readFixtureFile('app/client/interop-client.ts');

  expect(page).toContain(`<${generatedHost.tag} id='${generatedHost.id}'`);
  expect(page).toContain(`id='${generatedHost.lightCaptionId}'`);
  expect(page).toContain(`slot='${generatedHost.captionSlotName}'`);
  for (const id of Object.values(generatedHost.ids)) {
    expect(page).toContain(`id='${id}'`);
  }

  // The fixture client is the one foreign-tag definer and pre-upgrade capturer:
  // its declared host tag, placement ids and counter key are corpus data.
  expect(client).toContain(generatedHost.tag);
  for (const id of Object.values(generatedHost.ids)) {
    expect(client).toContain(id);
  }
  expect(client).toContain(generatedHost.hitsStateKey);

  // The authored host control id/part are corpus facts the browser probe uses.
  const island = await readFixtureFile(islandFile);
  expect(island).toContain(`id='${generatedHost.controlId}'`);
  expect(island).toContain(`part='${generatedHost.controlPart}'`);
});
