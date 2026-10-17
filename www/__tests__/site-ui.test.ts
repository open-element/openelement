import { expect, test } from 'vitest';
import { compileElementProgram } from '@openelement/compiler';
import { REPOSITORY_URL } from '../app/site-ui/open-layout-navigation.ts';
import { readFile } from 'node:fs/promises';

/**
 * The compiler admits no sidecar by default (#1468): compiling an island
 * module injects the host's island admission descriptor (the same one the
 * router build injects).
 */
const ISLAND_SIDECARS = [
  {
    moduleSpecifier: '@openelement/router',
    exportName: 'defineIslandConfig',
    kind: 'static-sidecar',
  },
] as const;

const siteModules = [
  ['open-standards-visual', '../app/site-ui/open-standards-visual.tsx'],
  ['open-page-rail', '../app/site-ui/open-page-rail.tsx'],
  ['open-reading-shell', '../app/site-ui/open-reading-shell.tsx'],
  ['open-article-view', '../app/site-ui/open-article-view.tsx'],
] as const;

for (const [tagName, path] of siteModules) {
  test(`site UI owns compiled ${tagName}`, async () => {
    const url = new URL(path, import.meta.url);
    const result = compileElementProgram(await readFile(url, 'utf8'), url.pathname);
    expect(result.program.tag).toEqual(tagName);
  });
}

test('app/layout.tsx is the compiled shell convention (no island declaration)', async () => {
  const url = new URL('../app/layout.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  // The convention module carries no island admission — a compiled light-root
  // component with no island declaration ships zero client JS. (The former
  // open-layout island, hydrate: 'none', retired with this migration.)
  expect(source).not.toContain('defineIslandConfig');
  expect(source).toContain("@element('app-layout')");
  expect(source).toContain('export default class Layout extends OpenElement');
  const result = compileElementProgram(source, url.pathname);
  expect(result.program.tag).toEqual('app-layout');
  // Blocks: header nav (desktop + mobile panel), sidebar rows (desktop +
  // mobile disclosure panel) and the four footer link columns.
  expect(result.program.blocks.length).toEqual(8);
  expect(
    result.program.metadata.properties.find((property) => property.name === 'repositoryHref')
      ?.default,
  ).toEqual(REPOSITORY_URL);
});

test('open-search keeps its view compiler-owned and its browser state external', async () => {
  const url = new URL('../app/islands/open-search.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  expect(source).toContain("defineIslandConfig({ hydrate: 'load', ssr: true })");
  expect(source).toContain("@element('open-search')");
  expect(source).toContain("from '../site-ui/open-search-controller.ts'");
  const result = compileElementProgram(source, url.pathname, {
    staticSidecars: ISLAND_SIDECARS,
  });
  expect(result.program.tag).toEqual('open-search');
  // The view is property-driven (C-5): the shell passes the page-locale chrome
  // copy as attributes (searchChromeStrings), while the empty/error message
  // and the hit list are compiled properties the controller writes; hits
  // render through one list Block with container-delegated click dismissal.
  expect(result.program.metadata.properties.map((property) => property.name)).toEqual([
    'locale',
    'triggerLabel',
    'dialogLabel',
    'inputLabel',
    'placeholder',
    'resultsLabel',
    'emptyMessage',
    'message',
    'hasHits',
    'searching',
    'hits',
    'hideSkeleton',
    'hideEmpty',
  ]);
  expect(result.program.parts.filter((part) => part.k === 'event').length).toEqual(4);
});
