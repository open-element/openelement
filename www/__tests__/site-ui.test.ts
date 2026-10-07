import { expect, test } from 'vitest';
import { compileElementProgram } from '@openelement/element/compiler';
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

test('open-layout is an explicitly hydrated compiled app-shell island', async () => {
  const url = new URL('../app/islands/open-layout.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  expect(source).toContain("defineIslandConfig({ hydrate: 'load', ssr: true })");
  expect(source).toContain("@element('open-layout')");
  expect(source).toContain('export default class OpenLayout extends OpenElement');
  const result = compileElementProgram(source, url.pathname, {
    staticSidecars: ISLAND_SIDECARS,
  });
  expect(result.program.tag).toEqual('open-layout');
  // Regions: header nav (desktop + mobile panel), sidebar rows (desktop +
  // mobile disclosure panel) and the four footer link columns.
  expect(result.program.regions.length).toEqual(8);
  // Injected shell props plus the derived chrome state as computed signal
  // properties (the list-Region grammar requires `.map()` over
  // `this.<property>`, so the derived sidebar rows / footer columns are
  // compiled computed fields rather than render locals or accessors).
  expect(result.program.metadata.properties.map((property) => property.name)).toEqual([
    'headerNav',
    'footerText',
    'siteName',
    'homeHref',
    'navItems',
    'currentPath',
    'locale',
    'locales',
    'home',
    'headerNavItems',
    'sidebarLabel',
    'sidebarToggle',
    'skipToMain',
    'menuOpen',
    'primaryNavLabel',
    'mobileNavLabel',
    'repositoryHref',
    'repositoryLabel',
    'switchLocaleHref',
    'switchLocaleLabel',
    'switchLocaleNote',
    'sidebarRows',
    'sidebarHidden',
    'footerTagline',
    'footerCopyright',
    'searchTriggerLabel',
    'searchDialogLabel',
    'searchInputLabel',
    'searchPlaceholder',
    'searchResultsLabel',
    'searchEmptyMessage',
    'footerProductLabel',
    'footerProductLinks',
    'footerResourcesLabel',
    'footerResourcesLinks',
    'footerCompanyLabel',
    'footerCompanyLinks',
    'footerLegalLabel',
    'footerLegalLinks',
  ]);
  expect(
    result.program.metadata.properties.find((property) => property.name === 'headerNav')?.attribute,
  ).toEqual('header-nav');
  // The header repository link is a literal default (module-scope identifiers
  // are not allowed there), so pin it to the shared constant the footer uses.
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
    // The island carries a same-module style sheet (ADR-0164 §4); the router
    // build activates the style asset protocol for islands, so this consumer
    // form must compile under the same activation.
    styleAssetProtocol: true,
  });
  expect(result.program.tag).toEqual('open-search');
  // The view is property-driven (C-5): the shell passes the page-locale chrome
  // copy as attributes (searchChromeStrings), while the empty/error message
  // and the hit list are compiled properties the controller writes; hits
  // render through one list Region with container-delegated click dismissal.
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
