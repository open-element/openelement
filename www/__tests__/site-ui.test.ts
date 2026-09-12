import { assertEquals, assertStringIncludes } from '@std/assert';
import { compileElementProgram } from '../../packages/adapter-vite/src/internal/compiler/semantic-core/compile.ts';

const siteModules = [
  ['open-lab-panel', '../app/site-ui/open-lab-panel.tsx'],
  ['open-lab-stage', '../app/site-ui/open-lab-stage.tsx'],
  ['open-standards-visual', '../app/site-ui/open-standards-visual.tsx'],
  ['open-page-hero', '../app/site-ui/open-page-hero.tsx'],
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
    "defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true })",
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
});

Deno.test('open-search keeps its view compiler-owned and its browser state external', async () => {
  const url = new URL('../app/islands/open-search.tsx', import.meta.url);
  const source = await Deno.readTextFile(url);
  assertStringIncludes(
    source,
    "defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true })",
  );
  assertStringIncludes(source, "@element('open-search')");
  assertStringIncludes(source, "from '../site-ui/open-search-controller.ts'");
  const result = compileElementProgram(source, url.pathname);
  assertEquals(result.program.tag, 'open-search');
  assertEquals(result.program.metadata.properties, []);
  assertEquals(result.program.parts.filter((part) => part.k === 'event').length, 3);
});
