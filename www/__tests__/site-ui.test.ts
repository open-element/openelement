import { assertEquals, assertStringIncludes } from '@std/assert';
import { compileElementProgram } from '@openelement/element/compiler';
import { REPOSITORY_URL } from '../app/site-ui/open-layout-navigation.ts';

const siteModules = [
  ['open-standards-visual', '../app/site-ui/open-standards-visual.tsx'],
  ['open-page-rail', '../app/site-ui/open-page-rail.tsx'],
  ['open-reading-shell', '../app/site-ui/open-reading-shell.tsx'],
  ['open-article-view', '../app/site-ui/open-article-view.tsx'],
] as const;

for (const [tagName, path] of siteModules) {
  Deno.test(`site UI owns compiled ${tagName}`, async () => {
    const url = new URL(path, import.meta.url);
    const result = compileElementProgram(await Deno.readTextFile(url), url.pathname);
    assertEquals(result.program.tag, tagName);
  });
}

Deno.test('open-layout is an explicitly hydrated compiled app-shell island', async () => {
  const url = new URL('../app/islands/open-layout.tsx', import.meta.url);
  const source = await Deno.readTextFile(url);
  assertStringIncludes(
    source,
    "defineIslandConfig({ hydrate: 'load', ssr: true })",
  );
  assertStringIncludes(source, "@element('open-layout')");
  assertStringIncludes(source, 'export default class OpenLayout extends OpenElement');
  const result = compileElementProgram(source, url.pathname);
  assertEquals(result.program.tag, 'open-layout');
  // Regions: header nav (desktop + mobile panel), sidebar rows (desktop +
  // mobile disclosure panel) and the four footer link columns.
  assertEquals(result.program.regions.length, 8);
  // Injected shell props plus the derived chrome state as computed signal
  // properties (the list-Region grammar requires `.map()` over
  // `this.<property>`, so the derived sidebar rows / footer columns are
  // compiled computed fields rather than render locals or accessors).
  assertEquals(
    result.program.metadata.properties.map((property) => property.name),
    [
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
      'footerProductLabel',
      'footerProductLinks',
      'footerResourcesLabel',
      'footerResourcesLinks',
      'footerCompanyLabel',
      'footerCompanyLinks',
      'footerLegalLabel',
      'footerLegalLinks',
    ],
  );
  assertEquals(
    result.program.metadata.properties.find((property) => property.name === 'headerNav')?.attribute,
    'header-nav',
  );
  // The header repository link is a literal default (module-scope identifiers
  // are not allowed there), so pin it to the shared constant the footer uses.
  assertEquals(
    result.program.metadata.properties.find((property) => property.name === 'repositoryHref')
      ?.default,
    REPOSITORY_URL,
  );
});

Deno.test('open-search keeps its view compiler-owned and its browser state external', async () => {
  const url = new URL('../app/islands/open-search.tsx', import.meta.url);
  const source = await Deno.readTextFile(url);
  assertStringIncludes(
    source,
    "defineIslandConfig({ hydrate: 'load', ssr: true })",
  );
  assertStringIncludes(source, "@element('open-search')");
  assertStringIncludes(source, "from '../site-ui/open-search-controller.ts'");
  const result = compileElementProgram(source, url.pathname);
  assertEquals(result.program.tag, 'open-search');
  // The view is property-driven (C-5): chrome copy (bilingual, English SSR
  // defaults pinned by e2e), the empty/error message and the hit list are
  // compiled properties the controller writes; hits render through one list
  // Region with container-delegated click dismissal.
  assertEquals(
    result.program.metadata.properties.map((property) => property.name),
    [
      'triggerLabel',
      'dialogLabel',
      'inputLabel',
      'placeholder',
      'resultsLabel',
      'message',
      'hasHits',
      'hits',
    ],
  );
  assertEquals(result.program.parts.filter((part) => part.k === 'event').length, 4);
});
