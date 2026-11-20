import { expect, test } from 'vitest';
import { compileElementProgram, compileGeneratedElementIfAdmitted } from '@openelement/compiler';
import { REPOSITORY_URL } from '../app/site-ui/open-layout-navigation.ts';
import { readFile } from 'node:fs/promises';

/**
 * The emitted descriptor's `properties` rows, read off the generated module.
 *
 * The generated lane publishes no runtime metadata object the way a compiled
 * class's Part Program does, so the emitted descriptor literal IS the row
 * table contract. Parsing it here pins the rows without restating them.
 */
function descriptorRows(code: string): Array<{
  name: string;
  attribute: string | null;
  type: string;
  reflect: boolean;
}> {
  const rows: Array<{ name: string; attribute: string | null; type: string; reflect: boolean }> =
    [];
  const pattern =
    /\{ name: ("(?:[^"\\]|\\.)*"), attribute: (null|"(?:[^"\\]|\\.)*"), type: ("(?:[^"\\]|\\.)*"), reflect: (true|false)/g;
  for (const match of code.matchAll(pattern)) {
    rows.push({
      name: JSON.parse(match[1]!) as string,
      attribute: match[2] === 'null' ? null : (JSON.parse(match[2]!) as string),
      type: JSON.parse(match[3]!) as string,
      reflect: match[4] === 'true',
    });
  }
  return rows;
}

const siteModules = [
  ['open-standards-visual', '../app/site-ui/open-standards-visual.tsx'],
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

test('open-page-rail keeps its view compiler-owned on the generated lane', async () => {
  const url = new URL('../app/islands/open-page-rail.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  const result = compileGeneratedElementIfAdmitted(source, url.pathname, {
    site: { tag: 'open-page-rail' },
  });
  expect(result, 'open-page-rail must be admitted by the generated-element lane').not.toBeNull();
  expect(String(result?.diagnostics ?? '')).not.toContain('OEC');
  // The scrollspy controller stays a site-UI collaborator, event-time only.
  expect(source).toContain("from '../site-ui/open-page-rail-controller.ts'");
});

test('open-search keeps its view compiler-owned and its browser state external', async () => {
  const url = new URL('../app/islands/open-search.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  expect(source).toContain("root: 'light'");
  expect(source).toContain('ssr: true');
  expect(source).toContain("from '../site-ui/open-search-controller.ts'");
  // The generated lane, not the class lane: the module must be admitted by the
  // generated-element transform and must not declare an @element class.
  expect(source).not.toContain('extends OpenElement');
  const result = compileGeneratedElementIfAdmitted(source, url.pathname, {
    site: { tag: 'open-search' },
  });
  expect(result, 'open-search must be admitted by the generated-element lane').not.toBeNull();
  expect(result!.component).toEqual('OpenSearch');
  // Presentational rows only. The class lane's two `computed` rows
  // (`hideSkeleton` / `hideEmpty`) are GONE from the table: the generated lane
  // has no authoring `computed`, so each derivation inlines at its `hidden`
  // sink (16b-migration-note R1/R1b) and both stay reactive there.
  expect(result!.code).toContain('toggleAttribute("hidden", Boolean((props . hasHits');
  expect(result!.code).toContain('toggleAttribute("hidden", Boolean((!  props . searching');
  // The row table the shell seeds from the host attributes. `hits` is the
  // property-only JSON-seed row (ADR-0182 D-18c); the other twelve carry an
  // attribute channel except the two controller-written booleans.
  const rows = descriptorRows(result!.code);
  expect(rows.map((row) => row.name)).toEqual([
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
  ]);
  expect(rows.find((row) => row.name === 'locale')).toMatchObject({
    attribute: 'locale',
    reflect: true,
  });
  for (const row of rows.filter((candidate) => candidate.name === 'hits')) {
    expect(row.attribute).toBeNull();
    expect(row.type).toBe('array');
  }
  // Four authored event bindings — trigger open, backdrop dismiss, input
  // search, results-click dismiss — emitted once per path (mount + claim).
  expect(result!.code.match(/addEventListener\("click"/g)?.length).toBe(6);
  expect(result!.code.match(/addEventListener\("input"/g)?.length).toBe(2);
});

test('open-page-rail keeps its view compiler-owned and its browser state external', async () => {
  const url = new URL('../app/islands/open-page-rail.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  expect(source).toContain("root: 'light'");
  expect(source).toContain('ssr: true');
  expect(source).toContain("from '../site-ui/open-page-rail-controller.ts'");
  // The generated lane, not the class lane: the module must be admitted by the
  // generated-element transform and must not declare an @element class. The
  // component body lives HERE rather than in a re-exported site-ui module: the
  // lane structurally declines a module whose default export is a re-export or
  // an imported identifier, and a declined module never sets `generatedLane`.
  expect(source).not.toContain('extends OpenElement');
  const result = compileGeneratedElementIfAdmitted(source, url.pathname, {
    site: { tag: 'open-page-rail' },
  });
  expect(result, 'open-page-rail must be admitted by the generated-element lane').not.toBeNull();
  expect(result!.component).toEqual('OpenPageRail');
  // The class lane's two `computed` rows (`onThisPage` / `overview`) are GONE
  // from the table: the generated lane has no authoring `computed`, so each
  // derivation is a component-local const arrow read at its sink
  // (16b-migration-note R1/R1b) and stays reactive there.
  const rows = descriptorRows(result!.code);
  expect(rows.map((row) => row.name)).toEqual(['items', 'locale']);
  // `items` is the property-only JSON-seed row (ADR-0182 D-18c): a rendered
  // outline has no attribute spelling, so the seed is its only host wire.
  // `locale` keeps its kebab attribute channel and its English fallback.
  for (const row of rows.filter((candidate) => candidate.name === 'items')) {
    expect(row.attribute).toBeNull();
    expect(row.type).toBe('array');
  }
  expect(rows.find((row) => row.name === 'locale')).toMatchObject({
    attribute: 'locale',
    type: 'string',
  });
});
