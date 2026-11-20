/**
 * route-style-links.test.ts — the per-route document stylesheet fact for
 * light-root generated islands (GH #1800 adoption slice).
 *
 * The fact is derived from the ONE module walk's opt-in `recordGraph` data
 * (per-module static edges + compiler `referencedCustomElementTags`), so this
 * suite pins two contracts:
 *
 *   1. `walkModuleGraph({ recordGraph: true })` records edges and referenced
 *      tags from the SAME read/analysis the walk already performs, and the
 *      default result shape stays unchanged (no `graph` key);
 *   2. the route closure is route-scoped (no cross-page leakage), intersects
 *      the light styled-island tag set (aliases included), joins the Phase 2
 *      emitted URLs deterministically, skips the walk entirely when no light
 *      styled island exists, and surfaces an incomplete graph instead of
 *      silently under-linking.
 *
 * No Vite build runs here: a directory-backed resolver stands in for the
 * bundler, which is the same resolution contract the walker consumes.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { RouteEntry } from '../src/framework.ts';
import type { ModuleWalkResolver } from '../src/vite/internal/module-graph-walk.ts';
import { islandStyleEntryLinks } from '../src/vite/internal/ssg/route-style-links.ts';
import {
  ModuleWalkDiagnosticCode,
  walkModuleGraph,
} from '../src/vite/internal/module-graph-walk.ts';
import type { IslandStyleDeclaration } from '../src/vite/internal/island-style-declarations.ts';
import {
  buildRouteDocumentStyleLinks,
  deliveredIslandStyleTags,
  RouteStyleLinksDiagnosticCode,
  routeDocumentStyleLinks,
  setRouteDocumentStyleLinks,
  type RouteDocumentStyleLinks,
} from '../src/vite/internal/ssg/route-style-links.ts';

let root: string;

function write(relativePath: string, content: string): void {
  const full = join(root, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function fileResolver(): ModuleWalkResolver {
  return {
    resolve(specifier, importer) {
      if (!specifier.startsWith('.')) return Promise.resolve(null);
      const id = resolve(importer === undefined ? root : dirname(importer), specifier);
      if (!existsSync(id)) return Promise.resolve(null);
      return Promise.resolve({ id });
    },
  };
}

/** A page route entry; only the fields the fact reads are populated. */
function route(path: string, filePath: string): RouteEntry {
  return { path, filePath, type: 'page', varName: filePath } as RouteEntry;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'oe-route-style-links-'));
  // /a → a-page → shared card (gen-card-a)
  write(
    'app/routes/a.tsx',
    "import { APage } from '../components/a-page.tsx';\nexport default APage;\n",
  );
  write(
    'app/components/a-page.tsx',
    "export function APage() {\n  return <section><gen-card-a count='1'></gen-card-a></section>;\n}\n",
  );
  // /b → b-page → shared card (gen-card-b) — same graph shape, different island.
  write(
    'app/routes/b.tsx',
    "import { BPage } from '../components/b-page.tsx';\nexport default BPage;\n",
  );
  write(
    'app/components/b-page.tsx',
    'export function BPage() {\n  return <gen-card-b></gen-card-b>;\n}\n',
  );
  // /cycle → cycle-a ↔ cycle-b, both referencing one light island.
  write(
    'app/routes/cycle.tsx',
    "import { cycleA } from '../components/cycle-a.tsx';\nexport default cycleA;\n",
  );
  write(
    'app/components/cycle-a.tsx',
    "import { cycleB } from './cycle-b.tsx';\nexport function cycleA() {\n  return <gen-card-a></gen-card-a>;\n}\nexport const seen = cycleB;\n",
  );
  write(
    'app/components/cycle-b.tsx',
    "import { cycleA } from './cycle-a.tsx';\nexport function cycleB() {\n  return <div>{cycleA ? 1 : 0}</div>;\n}\n",
  );
  // /alias → references the delivered alias tag, not the primary tag.
  write(
    'app/routes/alias.tsx',
    'export default function AliasPage() {\n  return <gen-card-alias></gen-card-alias>;\n}\n',
  );
  // /plain → references no custom element at all.
  write(
    'app/routes/plain.tsx',
    'export default function PlainPage() {\n  return <main>plain</main>;\n}\n',
  );
  // /unresolved → a legitimate static import the resolver cannot resolve (the
  // module does not exist on disk). The walk records it as `unresolved`, NOT as
  // an unreadable source; the route still finds the island it references itself.
  write(
    'app/routes/unresolved.tsx',
    "import './missing-leaf.ts';\nexport default function UnresolvedPage() {\n  return <gen-card-b></gen-card-b>;\n}\n",
  );
  // /bare-unresolved → a bare specifier the resolver answers `null` for. Null is
  // NOT an external verdict, so this edge is unresolved too.
  write(
    'app/routes/bare-unresolved.tsx',
    "import 'optional-pkg';\nexport default function BareUnresolvedPage() {\n  return <gen-card-b></gen-card-b>;\n}\n",
  );
  // /external → a specifier the resolver answers with its explicit external
  // verdict; that stays a deliberate skip, never an unresolved edge.
  write(
    'app/routes/external.tsx',
    "import 'external-pkg';\nexport default function ExternalPage() {\n  return <gen-card-a></gen-card-a>;\n}\n",
  );
  // /chain → imports a module that pushes the walk over a tiny bound.
  write(
    'app/routes/chain.tsx',
    "import '../chain-child.tsx';\nexport default function ChainPage() {\n  return <div>chain</div>;\n}\n",
  );
  write(
    'app/chain-child.tsx',
    'export function ChainChild() {\n  return <gen-card-a></gen-card-a>;\n}\n',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const ROUTES = [
  route('/a', 'a.tsx'),
  route('/b', 'b.tsx'),
  route('/cycle', 'cycle.tsx'),
  route('/alias', 'alias.tsx'),
  route('/plain', 'plain.tsx'),
];

const LIGHT_TAGS = new Set(['gen-card-a', 'gen-card-b', 'gen-card-alias']);
const ISLAND_STYLE_URLS = new Map<string, readonly string[]>([
  ['gen-card-a', ['/client/assets/a-hash.css']],
  ['gen-card-b', ['/client/assets/b-hash.css']],
  ['gen-card-alias', ['/client/assets/alias-hash.css']],
]);

describe('walkModuleGraph recordGraph', () => {
  test('records edges and compiler referenced tags without a second walk', async () => {
    const seed = join(root, 'app/routes/a.tsx');
    const recorded = await walkModuleGraph(fileResolver(), [seed], { recordGraph: true });
    expect(recorded.graph).toBeDefined();
    const pageFile = join(root, 'app/components/a-page.tsx');
    // The seed's edge resolves to the page module; the page module references
    // the island tag — both facts come from the walk's own per-module analysis.
    expect(recorded.graph!.edges.get(seed)).toEqual([pageFile]);
    expect(recorded.graph!.referencedTags.get(pageFile)).toEqual(['gen-card-a']);

    expect(recorded.graph!.unresolvedEdges).toEqual([]);

    const plain = await walkModuleGraph(fileResolver(), [seed]);
    expect('graph' in plain).toBe(false);
  });
});

describe('buildRouteDocumentStyleLinks', () => {
  test('resolves the light styled islands per route closure, without cross-page leakage', async () => {
    const result = await buildRouteDocumentStyleLinks({
      root,
      routes: ROUTES,
      routesDir: 'app/routes',
      resolve: fileResolver(),
      lightIslandTags: LIGHT_TAGS,
      islandStyleUrls: ISLAND_STYLE_URLS,
    });
    expect(result.incomplete).toBe(false);
    expect(result.notes).toEqual([]);
    expect(result.links).toEqual({
      '/a': ['/client/assets/a-hash.css'],
      '/b': ['/client/assets/b-hash.css'],
      '/cycle': ['/client/assets/a-hash.css'],
      '/alias': ['/client/assets/alias-hash.css'],
    });
    // A route with no light island reference is absent, not an empty entry.
    expect('/plain' in result.links).toBe(false);
  });

  test('skips the walk entirely when no light styled island exists', async () => {
    let resolved = false;
    const result = await buildRouteDocumentStyleLinks({
      root,
      routes: ROUTES,
      routesDir: 'app/routes',
      resolve: {
        resolve() {
          resolved = true;
          return Promise.resolve(null);
        },
      },
      lightIslandTags: new Set(),
      islandStyleUrls: new Map(),
    });
    expect(resolved, 'the empty fast path must not walk').toBe(false);
    expect(result.links).toEqual({});
    expect(result.incomplete).toBe(false);
  });

  test('an unresolved static import is not unreadable, but makes the route fact incomplete', async () => {
    // A specifier the resolver cannot resolve never enters the walk's read set:
    // it is NOT an unreadable source. It still leaves the closure unknown, so
    // the route fact must fail closed instead of reading "no edge".
    const seed = join(root, 'app/routes/unresolved.tsx');
    const walk = await walkModuleGraph(fileResolver(), [seed], { recordGraph: true });
    expect(walk.skipped.unresolved).toBeGreaterThan(0);
    expect(walk.diagnostics, 'unresolved is not a read failure').toEqual([]);
    expect(walk.graph?.unresolvedEdges).toEqual([
      { importer: seed, specifier: './missing-leaf.ts' },
    ]);

    const result = await buildRouteDocumentStyleLinks({
      root,
      routes: [route('/unresolved', 'unresolved.tsx')],
      routesDir: 'app/routes',
      resolve: fileResolver(),
      lightIslandTags: LIGHT_TAGS,
      islandStyleUrls: ISLAND_STYLE_URLS,
    });
    expect(result.incomplete).toBe(true);
    expect(result.notes.map((note) => note.code)).toContain(
      RouteStyleLinksDiagnosticCode.ROUTE_STYLE_UNRESOLVED_IMPORT,
    );
    expect(result.notes.map((note) => note.code)).not.toContain(
      ModuleWalkDiagnosticCode.SOURCE_UNREADABLE,
    );
  });

  test('a bare specifier answered with null is unresolved, not external', async () => {
    // Only the resolver's explicit `external` verdict proves externality; a
    // null answer may still be a local/alias module that carries island tags.
    const seed = join(root, 'app/routes/bare-unresolved.tsx');
    const walk = await walkModuleGraph(fileResolver(), [seed], { recordGraph: true });
    expect(walk.skipped.external).toBe(0);
    expect(walk.skipped.unresolved).toBeGreaterThan(0);
    expect(walk.graph?.unresolvedEdges).toEqual([{ importer: seed, specifier: 'optional-pkg' }]);

    const result = await buildRouteDocumentStyleLinks({
      root,
      routes: [route('/bare-unresolved', 'bare-unresolved.tsx')],
      routesDir: 'app/routes',
      resolve: fileResolver(),
      lightIslandTags: LIGHT_TAGS,
      islandStyleUrls: ISLAND_STYLE_URLS,
    });
    expect(result.incomplete).toBe(true);
    expect(result.notes.map((note) => note.code)).toContain(
      RouteStyleLinksDiagnosticCode.ROUTE_STYLE_UNRESOLVED_IMPORT,
    );
  });

  test("a resolver's explicit external verdict stays a deliberate skip", async () => {
    const externalResolver: ModuleWalkResolver = {
      resolve(specifier, importer) {
        if (specifier === 'external-pkg') {
          return Promise.resolve({ id: 'external-pkg', external: true });
        }
        return fileResolver().resolve(specifier, importer);
      },
    };
    const seed = join(root, 'app/routes/external.tsx');
    const walk = await walkModuleGraph(externalResolver, [seed], { recordGraph: true });
    expect(walk.skipped.external).toBeGreaterThan(0);
    expect(walk.skipped.unresolved).toBe(0);
    expect(walk.graph?.unresolvedEdges).toEqual([]);

    const result = await buildRouteDocumentStyleLinks({
      root,
      routes: [route('/external', 'external.tsx')],
      routesDir: 'app/routes',
      resolve: externalResolver,
      lightIslandTags: LIGHT_TAGS,
      islandStyleUrls: ISLAND_STYLE_URLS,
    });
    expect(result.incomplete).toBe(false);
    expect(result.notes).toEqual([]);
    expect(result.links['/external']).toEqual(['/client/assets/a-hash.css']);
  });

  test('treats an unreadable route source as an incomplete closure, never a silent hole', async () => {
    const result = await buildRouteDocumentStyleLinks({
      root,
      routes: [route('/vanished', 'vanished.tsx')],
      routesDir: 'app/routes',
      resolve: fileResolver(),
      lightIslandTags: LIGHT_TAGS,
      islandStyleUrls: ISLAND_STYLE_URLS,
    });
    expect(result.incomplete).toBe(true);
    expect(result.notes.map((note) => note.code)).toContain(
      ModuleWalkDiagnosticCode.SOURCE_UNREADABLE,
    );
  });

  test('fails closed when a declared styled island has no joined stylesheet URL', async () => {
    // The helper owns the tag→URL join it is handed: an absent or empty entry is
    // an inconsistent input, never "nothing to seed".
    for (const islandStyleUrls of [
      new Map<string, readonly string[]>([['gen-card-b', ['/client/assets/b-hash.css']]]),
      new Map<string, readonly string[]>([['gen-card-a', []]]),
    ]) {
      const result = await buildRouteDocumentStyleLinks({
        root,
        routes: [route('/a', 'a.tsx')],
        routesDir: 'app/routes',
        resolve: fileResolver(),
        lightIslandTags: LIGHT_TAGS,
        islandStyleUrls,
      });
      expect(result.incomplete).toBe(true);
      expect(result.notes.map((note) => note.code)).toContain(
        RouteStyleLinksDiagnosticCode.ROUTE_STYLE_MISSING_ASSET_URLS,
      );
      expect(result.links['/a'], 'no partial link is fabricated').toBeUndefined();
    }
  });

  test('reports an incomplete closure instead of under-linking silently', async () => {
    const result = await buildRouteDocumentStyleLinks({
      root,
      routes: [route('/chain', 'chain.tsx')],
      routesDir: 'app/routes',
      resolve: fileResolver(),
      lightIslandTags: LIGHT_TAGS,
      islandStyleUrls: ISLAND_STYLE_URLS,
      maxModules: 2,
    });
    expect(result.incomplete).toBe(true);
    expect(result.notes.map((note) => note.code)).toContain(
      RouteStyleLinksDiagnosticCode.ROUTE_STYLE_WALK_TRUNCATED,
    );
  });

  test('deduplicates shared URLs and orders by referenced tag', async () => {
    const result = await buildRouteDocumentStyleLinks({
      root,
      routes: [route('/a', 'a.tsx')],
      routesDir: 'app/routes',
      resolve: fileResolver(),
      lightIslandTags: LIGHT_TAGS,
      islandStyleUrls: new Map([
        ['gen-card-a', ['/client/assets/shared.css']],
        ['gen-card-b', ['/client/assets/b-hash.css']],
      ]),
    });
    expect(result.links['/a']).toEqual(['/client/assets/shared.css']);
  });
});

describe('deliveredIslandStyleTags', () => {
  const declarations: IslandStyleDeclaration[] = [
    {
      tagName: 'light-primary',
      root: 'light',
      moduleId: '/abs/light.tsx',
      filePath: 'light.tsx',
      islandsDir: '/abs/islands',
      specifiers: ['./light.css'],
    },
    {
      tagName: 'shadow-primary',
      root: 'shadow',
      moduleId: '/abs/shadow.tsx',
      filePath: 'shadow.tsx',
      islandsDir: '/abs/islands',
      specifiers: ['./shadow.css'],
    },
  ];

  test('splits by root and includes one-to-many delivery aliases', () => {
    const tags = deliveredIslandStyleTags(declarations, {
      'light-primary': { tags: ['light-primary', 'light-primary-alt'] },
      'shadow-primary': { tagNames: ['shadow-primary', 'shadow-primary-alt'] },
    });
    expect([...tags.light].sort()).toEqual(['light-primary', 'light-primary-alt']);
    expect([...tags.shadow].sort()).toEqual(['shadow-primary', 'shadow-primary-alt']);
  });
});

describe('routeDocumentStyleLinks carrier', () => {
  test('is build-internal: keyed by the context object, empty by default', () => {
    const context = {};
    expect(routeDocumentStyleLinks(context)).toEqual({});
    const links: RouteDocumentStyleLinks = { '/a': ['/client/assets/a-hash.css'] };
    setRouteDocumentStyleLinks(context, links);
    expect(routeDocumentStyleLinks(context)).toBe(links);
    expect(routeDocumentStyleLinks({}), 'another build context sees no fact').toEqual({});
  });
});

describe('generated-entry DSD style link entries', () => {
  test('joins the emitted sheet and the shared utility sheet for a Tailwind-required tag', () => {
    const assets = new Map<string, readonly string[]>([
      ['open-theme-toggle', ['/client/open-theme-toggle.abc.css']],
      ['open-plain', ['/client/plain.abc.css']],
    ]);
    const shadowTags = new Set(['open-theme-toggle', 'open-plain']);
    const entries = islandStyleEntryLinks(
      assets,
      shadowTags,
      ['/client/component-shared.css'],
      new Set(['open-theme-toggle']),
    );
    expect(entries).toEqual([
      ['open-theme-toggle', ['/client/open-theme-toggle.abc.css', '/client/component-shared.css']],
      ['open-plain', ['/client/plain.abc.css']],
    ]);
  });

  test('filters to styled shadow tags and never adds an empty utility link', () => {
    const assets = new Map<string, readonly string[]>([
      ['open-light', ['/client/light.css']],
      ['open-shadow', ['/client/shadow.css']],
    ]);
    expect(
      islandStyleEntryLinks(
        assets,
        new Set(['open-shadow']),
        [],
        new Set(['open-shadow', 'open-light']),
      ),
    ).toEqual([['open-shadow', ['/client/shadow.css']]]);
  });
});
