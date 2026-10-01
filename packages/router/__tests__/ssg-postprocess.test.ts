/**
 * @openelement/router - ssg-postprocess.ts tests (Deno)
 *
 * Tests the SSG post-processing functions using temp directories.
 *
 * The #1471/S4b contract: client scripts are NOT post-processed here — the
 * document renderer embeds the final script tags at render time from the
 * client asset manifest (ADR-0160 rule d). What remains in postprocess.ts
 * is the meta/speculation injection; the island chunk↔tag trade now runs
 * only through the manifest (build-postprocess.ts) and fails closed: an
 * admitted island without a manifest record fails the build instead of
 * shipping a partial page manifest, and only the metadata Phase 2 selected
 * is validated or delivered.
 */
import {
  assert,
  assertEquals,
  assertExists,
  assertFalse,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from '@std/assert';
import { OpenElementError } from '@openelement/element';
import { ClientAssetErrorCode } from '../src/internal/error-codes.ts';
import {
  buildSpeculationRulesJson,
  injectCspMeta,
  injectSpeculationRules,
  injectViewTransitionMeta,
} from '../src/vite/internal/ssg/index.ts';
import {
  islandChunkMapFromAssetManifest,
  postProcessClientIslandBuild,
} from '../src/vite/internal/ssg/build-postprocess.ts';
import { stableHash } from '../src/vite/internal/ssg/ssg-helpers.ts';
import type { ClientAssetManifest } from '../src/vite/internal/protocol/client-assets.ts';
import type { IslandDecl } from '../src/vite/internal/protocol/ssg.ts';

import { join } from '@std/path';

function makeTempDir(): string {
  return Deno.makeTempDirSync({ prefix: 'open-test-' });
}

/** The per-page island manifest file writeIslandManifests emits for a route. */
async function pageManifestPath(outputDir: string, route: string): Promise<string> {
  // sha256 hex of the route, matching island-manifest.ts's stableHash naming.
  return join(outputDir, 'island-manifests', `page-${await stableHash(route)}.json`);
}

function cleanup(dir: string) {
  try {
    Deno.removeSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}

// ─── islandChunkMapFromAssetManifest (identity-driven chunk resolution) ──

Deno.test('islandChunkMapFromAssetManifest maps delivery tags to manifest asset URLs', () => {
  const manifest: ClientAssetManifest = {
    entry: '/client/islands/client.js',
    islands: {
      'open-counter': { file: '/client/islands/island-counter-Ab12.js', strategy: 'idle' },
      'open-theme-toggle': {
        file: '/client/islands/island-open-theme-toggle-Cd34.js',
        strategy: 'load',
        preload: true,
      },
    },
    shared: [],
  };
  const map = islandChunkMapFromAssetManifest(manifest, ['open-counter', 'open-theme-toggle']);
  assertEquals(map, {
    'open-counter': '/client/islands/island-counter-Ab12.js',
    'open-theme-toggle': '/client/islands/island-open-theme-toggle-Cd34.js',
  });
});

Deno.test('islandChunkMapFromAssetManifest follows a chunk rename through the manifest, not the name', () => {
  // The file name carries no identity: after a rename/rehash the tag keeps
  // resolving through the manifest record (joined on module ids at build
  // time). The retired filename-prefix matcher would have dropped this.
  const renamed: ClientAssetManifest = {
    entry: '/client/islands/client.js',
    islands: {
      'open-counter': { file: '/client/islands/shared-bundle-Zz99.js', strategy: 'idle' },
    },
    shared: [],
  };
  assertEquals(
    islandChunkMapFromAssetManifest(renamed, ['open-counter'])['open-counter'],
    '/client/islands/shared-bundle-Zz99.js',
  );
});

Deno.test('islandChunkMapFromAssetManifest fails closed on islands the manifest does not record', () => {
  // The former warn-and-continue shipped a partial chunk map: a page would
  // carry an island whose client script never loads. Now the join fails,
  // naming the island — whatever else the manifest does record.
  const error = assertThrows(
    () =>
      islandChunkMapFromAssetManifest(
        {
          entry: '/client/islands/client.js',
          islands: { 'open-other': { file: '/client/islands/other.js', strategy: 'idle' } },
          shared: [],
        },
        ['open-ghost'],
      ),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.ISLAND_UNMAPPED);
  assertEquals(error.phase, 'build');
  assert(
    error.message.includes('open-ghost') && error.message.includes('client asset manifest'),
    `error names the island and the manifest: ${error.message}`,
  );
});

Deno.test('islandChunkMapFromAssetManifest fails closed for every island when no manifest shipped', () => {
  const error = assertThrows(
    () => islandChunkMapFromAssetManifest(null, ['open-counter']),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.ISLAND_UNMAPPED);
  assert(
    error.message.includes('open-counter') && error.message.includes('no client asset manifest'),
    `error names the island and the missing manifest: ${error.message}`,
  );
  // An island-free build owes no records: the empty list maps without
  // consulting the manifest at all.
  assertEquals(islandChunkMapFromAssetManifest(null, []), {});
});

// ─── postProcessClientIslandBuild (manifest-driven, no HTML surgery) ────

/** Minimal BuildContextView for the island-manifest pass. */
function ctxView(manifest: ClientAssetManifest | null, root: string) {
  return {
    phase3: { root, outDir: 'dist', base: '/', upgradeStrategy: 'idle' as const },
    phase1: {
      islandTagNames: ['open-counter'],
      islandFiles: ['counter.ts'],
      packageIslandDecls: [],
      compilerBehaviorDecls: [],
      islandMeta: {},
    },
    clientAssetManifest: manifest,
  };
}

Deno.test('postProcessClientIslandBuild writes per-page manifests with manifest-keyed chunks and leaves HTML untouched', async () => {
  const tmp = makeTempDir();
  try {
    const dist = join(tmp, 'dist');
    Deno.mkdirSync(join(dist, 'guide'), { recursive: true });
    Deno.writeTextFileSync(
      join(dist, 'index.html'),
      '<html><head></head><body><open-counter></open-counter></body></html>',
    );
    Deno.writeTextFileSync(
      join(dist, 'guide', 'page.html'),
      '<html><head></head><body><p>no islands here</p></body></html>',
    );

    const manifest: ClientAssetManifest = {
      entry: '/client/islands/client.js',
      islands: {
        'open-counter': { file: '/client/islands/island-counter-Ab12.js', strategy: 'idle' },
      },
      shared: [],
    };
    await postProcessClientIslandBuild(ctxView(manifest, tmp));

    // The island identity resolves through the manifest, chunk URL intact.
    const homeManifest = JSON.parse(Deno.readTextFileSync(await pageManifestPath(dist, '/'))) as {
      route: string;
      islands: Array<{ tagName: string; chunkUrl: string; strategy: string }>;
    };
    assertEquals(homeManifest.route, '/');
    const counter = homeManifest.islands.find((entry) => entry.tagName === 'open-counter');
    assertExists(counter);
    assertEquals(counter.chunkUrl, '/client/islands/island-counter-Ab12.js');
    assertEquals(counter.strategy, 'idle');

    // A page without islands gets a manifest with an empty island list.
    const guideManifest = JSON.parse(
      Deno.readTextFileSync(await pageManifestPath(dist, '/guide/page')),
    ) as { islands: unknown[] };
    assertEquals(guideManifest.islands, []);

    // No script surgery: the rendered HTML is left byte-identical — script
    // tags were already embedded at document render time (#1471).
    assertEquals(
      Deno.readTextFileSync(join(dist, 'index.html')),
      '<html><head></head><body><open-counter></open-counter></body></html>',
    );
    assert(
      !Deno.readTextFileSync(join(dist, 'index.html')).includes('<script'),
      'post-processing must not inject scripts into rendered HTML',
    );
  } finally {
    cleanup(tmp);
  }
});

function dirExists(path: string): boolean {
  try {
    return Deno.statSync(path).isDirectory;
  } catch {
    return false;
  }
}

Deno.test('postProcessClientIslandBuild without a manifest fails closed and writes nothing', async () => {
  const tmp = makeTempDir();
  try {
    const dist = join(tmp, 'dist');
    Deno.mkdirSync(dist, { recursive: true });
    Deno.writeTextFileSync(
      join(dist, 'index.html'),
      '<html><body><open-counter></open-counter></body></html>',
    );

    const error = await assertRejects(
      () => postProcessClientIslandBuild(ctxView(null, tmp)),
      OpenElementError,
    );
    assertEquals(error.code, ClientAssetErrorCode.ISLAND_UNMAPPED);
    assert(
      error.message.includes('open-counter'),
      `error names the unrecorded island: ${error.message}`,
    );
    // No partial manifest: the pass either writes the complete set or none
    // of it — here nothing was written at all.
    assertEquals(dirExists(join(dist, 'island-manifests')), false);
    // The rendered HTML stays untouched either way.
    assertEquals(
      Deno.readTextFileSync(join(dist, 'index.html')),
      '<html><body><open-counter></open-counter></body></html>',
    );
  } finally {
    cleanup(tmp);
  }
});

Deno.test('postProcessClientIslandBuild fails before writing when the manifest misses one island', async () => {
  // One island resolves, one does not: the failure must land BEFORE any
  // page manifest is generated, so the output tree never carries a partial
  // record that silently omits the unrecorded island.
  const tmp = makeTempDir();
  try {
    const dist = join(tmp, 'dist');
    Deno.mkdirSync(dist, { recursive: true });
    Deno.writeTextFileSync(
      join(dist, 'index.html'),
      '<html><body><open-counter></open-counter></body></html>',
    );
    const partial: ClientAssetManifest = {
      entry: '/client/islands/client.js',
      // open-counter is recorded; the second admitted island is not.
      islands: {
        'open-counter': { file: '/client/islands/island-counter-Ab12.js', strategy: 'idle' },
      },
      shared: [],
    };
    const error = await assertRejects(
      () =>
        postProcessClientIslandBuild({
          phase3: { root: tmp, outDir: 'dist', base: '/', upgradeStrategy: 'idle' as const },
          phase1: {
            islandTagNames: ['open-counter', 'open-theme'],
            islandFiles: ['counter.ts', 'theme.ts'],
            packageIslandDecls: [],
            compilerBehaviorDecls: [],
            islandMeta: {},
          },
          clientAssetManifest: partial,
        }),
      OpenElementError,
    );
    assertEquals(error.code, ClientAssetErrorCode.ISLAND_UNMAPPED);
    assert(error.message.includes('open-theme'), `error names the island: ${error.message}`);
    assertEquals(dirExists(join(dist, 'island-manifests')), false);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('postProcessClientIslandBuild validates only the local metadata Phase 2 selected', async () => {
  // buildClient narrows ctx.phase1.islandTagNames to the reachable client
  // set but leaves islandMeta carrying every scanned island. An unselected
  // island's metadata — malformed or merely multi-tag — must be neither
  // validated nor delivered: re-admitting it would fail the fail-closed
  // chunk map for an island that ships nothing.
  const tmp = makeTempDir();
  try {
    const dist = join(tmp, 'dist');
    Deno.mkdirSync(dist, { recursive: true });
    Deno.writeTextFileSync(
      join(dist, 'index.html'),
      '<html><body><open-counter></open-counter></body></html>',
    );
    const manifest: ClientAssetManifest = {
      entry: '/client/islands/client.js',
      islands: {
        'open-counter': { file: '/client/islands/island-counter-Ab12.js', strategy: 'idle' },
      },
      shared: [],
    };
    await postProcessClientIslandBuild({
      phase3: { root: tmp, outDir: 'dist', base: '/', upgradeStrategy: 'idle' as const },
      phase1: {
        // Selected: only open-counter.
        islandTagNames: ['open-counter'],
        islandFiles: ['counter.ts'],
        packageIslandDecls: [],
        compilerBehaviorDecls: [],
        // The delivery fields (tags/tagNames) ride this record untyped —
        // the pipeline reads them through the same DeliveryIslandMeta cast
        // expandLocalIslandMeta applies.
        islandMeta: {
          // Unselected and malformed (empty tags list): never validated.
          'open-broken': { tags: [] },
          // Unselected multi-tag island: its delivered aliases never enter
          // the chunk-map request.
          'open-dormant': { tags: ['open-dormant', 'open-dormant-panel'] },
        } as unknown as Record<string, Partial<IslandDecl>>,
      },
      clientAssetManifest: manifest,
    });
    const pageManifest = JSON.parse(Deno.readTextFileSync(await pageManifestPath(dist, '/'))) as {
      islands: Array<{ tagName: string; chunkUrl: string; strategy: string; layer: string }>;
    };
    assertEquals(pageManifest.islands, [
      {
        tagName: 'open-counter',
        chunkUrl: '/client/islands/island-counter-Ab12.js',
        strategy: 'idle',
        layer: 'dsd-interactive',
      },
    ]);
  } finally {
    cleanup(tmp);
  }
});

// ─── injectCspMeta ──────────────────────────────────────────

Deno.test('injectCspMeta adds CSP meta tag to HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectCspMeta(tmp, "default-src 'self'");

    const content = Deno.readTextFileSync(htmlPath);
    assertStringIncludes(content, 'Content-Security-Policy');
    assertStringIncludes(content, "default-src 'self'");
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectCspMeta uses Report-Only header in report-only mode', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectCspMeta(tmp, "default-src 'self'", true);

    const content = Deno.readTextFileSync(htmlPath);
    assertStringIncludes(content, 'Content-Security-Policy-Report-Only');
    assertFalse(content.includes('"Content-Security-Policy"'));
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectCspMeta escapes double quotes in policy', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectCspMeta(tmp, `default-src 'self'; script-src "unsafe-inline"`);

    const content = Deno.readTextFileSync(htmlPath);
    assertStringIncludes(content, '&quot;');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectCspMeta does not duplicate on repeated calls', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectCspMeta(tmp, "default-src 'self'");
    injectCspMeta(tmp, "default-src 'self'");

    const content = Deno.readTextFileSync(htmlPath);
    const count = (content.match(/Content-Security-Policy/g) || []).length;
    assertEquals(count, 1);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectCspMeta handles HTML without <head> tag', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'no-head.html');
    Deno.writeTextFileSync(htmlPath, '<html><body><p>No head</p></body></html>');

    injectCspMeta(tmp, "default-src 'self'");

    const content = Deno.readTextFileSync(htmlPath);
    assertStringIncludes(content, 'Content-Security-Policy');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectCspMeta handles HTML starting with <!DOCTYPE>', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'doctype.html');
    Deno.writeTextFileSync(htmlPath, '<!DOCTYPE html><html><body></body></html>');

    injectCspMeta(tmp, "default-src 'self'");

    const content = Deno.readTextFileSync(htmlPath);
    assertStringIncludes(content, 'Content-Security-Policy');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectCspMeta warns when nonce=true (SSG rejects nonce — behavior unchanged)', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'nonce.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body></body></html>');

    const origWarn = console.warn;
    let warnMsg = '';
    console.warn = (...args: unknown[]) => {
      warnMsg = args.join(' ');
    };

    injectCspMeta(tmp, "default-src 'self'", false, true);

    console.warn = origWarn;
    assertStringIncludes(warnMsg, 'nonce', 'Should warn about nonce not supported');
    // The rejection is real: no nonce attribute may reach the static output.
    assertFalse(
      Deno.readTextFileSync(htmlPath).includes('nonce='),
      'SSG output must not carry a nonce attribute',
    );
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectCspMeta skips non-HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    const txtPath = join(tmp, 'readme.txt');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body></body></html>');
    Deno.writeTextFileSync(txtPath, 'Not HTML');

    injectCspMeta(tmp, "default-src 'self'");

    const txtContent = Deno.readTextFileSync(txtPath);
    assertEquals(txtContent, 'Not HTML', 'Non-HTML files should not be modified');
  } finally {
    cleanup(tmp);
  }
});

// ─── injectViewTransitionMeta ─────────────────────────────────

Deno.test('injectViewTransitionMeta adds meta tag to HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body><p>Hello</p></body></html>');

    injectViewTransitionMeta(tmp);

    const content = Deno.readTextFileSync(htmlPath);
    assertStringIncludes(content, 'view-transition');
    assertStringIncludes(content, 'same-origin');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectViewTransitionMeta does not duplicate on repeated calls', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectViewTransitionMeta(tmp);
    injectViewTransitionMeta(tmp);

    const content = Deno.readTextFileSync(htmlPath);
    const count = (content.match(/view-transition/g) || []).length;
    assertEquals(count, 1);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectViewTransitionMeta recurses into subdirectories', () => {
  const tmp = makeTempDir();
  try {
    Deno.mkdirSync(join(tmp, 'guide'));
    Deno.writeTextFileSync(join(tmp, 'index.html'), '<html><head></head><body></body></html>');
    Deno.writeTextFileSync(
      join(tmp, 'guide', 'page.html'),
      '<html><head></head><body></body></html>',
    );

    injectViewTransitionMeta(tmp);

    assertStringIncludes(Deno.readTextFileSync(join(tmp, 'index.html')), 'view-transition');
    assertStringIncludes(Deno.readTextFileSync(join(tmp, 'guide', 'page.html')), 'view-transition');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectViewTransitionMeta skips non-HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    const txtPath = join(tmp, 'readme.txt');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body></body></html>');
    Deno.writeTextFileSync(txtPath, 'Not HTML');

    injectViewTransitionMeta(tmp);

    const txtContent = Deno.readTextFileSync(txtPath);
    assertEquals(txtContent, 'Not HTML');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectViewTransitionMeta handles HTML without <head> tag', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'no-head.html');
    Deno.writeTextFileSync(htmlPath, '<html><body><p>No head</p></body></html>');

    injectViewTransitionMeta(tmp);

    const content = Deno.readTextFileSync(htmlPath);
    assertStringIncludes(content, 'view-transition');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectViewTransitionMeta still injects when body text mentions view-transition', () => {
  // Regression: changelog page content contains "view-transition" as text,
  // which previously caused the injection to be skipped.
  // Fix: check for '<meta name="view-transition"' instead of 'view-transition'.
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'changelog.html');
    Deno.writeTextFileSync(
      htmlPath,
      '<html><head></head><body><p>We added view-transition support in v0.9.2</p></body></html>',
    );

    injectViewTransitionMeta(tmp);

    const content = Deno.readTextFileSync(htmlPath);
    // Should have the meta tag injected (not skipped because of body text)
    const matchCount = (content.match(/<meta name="view-transition"/g) || []).length;
    assertEquals(matchCount, 1);
  } finally {
    cleanup(tmp);
  }
});

// ─── buildSpeculationRulesJson ────────────────────────────────

Deno.test('buildSpeculationRulesJson returns empty string for no options and no routes', () => {
  const result = buildSpeculationRulesJson({});
  assertEquals(result, '');
});

Deno.test('buildSpeculationRulesJson generates heuristic prerender rules from routes', () => {
  const result = buildSpeculationRulesJson({}, [
    { path: '/', type: 'page' },
    { path: '/about', type: 'page' },
    { path: '/api/data', type: 'api' },
    { path: '/blog/:slug', type: 'page' },
  ]);

  const parsed = JSON.parse(result);
  // Heuristic mode generates prerender rules (not prefetch)
  assertExists(parsed.prerender);
  // Home page is a list rule (source + urls, no where)
  assert(
    parsed.prerender.some(
      (r: { source?: string; urls?: string[] }) => r.source === 'list' && r.urls?.includes('/'),
    ),
    'Home page should be a list rule with / in urls',
  );
  // Top-level page produces a document rule (where.href_matches)
  assert(
    parsed.prerender.some(
      (r: { where?: { href_matches: string } }) => r.where?.href_matches === '/about',
    ),
    'Top-level page should produce an /about document rule',
  );
  // API routes are excluded from the document rules
  assert(
    parsed.prerender.some((r: { where?: { not?: unknown } }) => r.where?.not != null),
    'API routes should be excluded via where.not',
  );
  // Dynamic routes (with :) should be excluded
  assertFalse(result.includes('/blog/:slug'));
});

Deno.test('buildSpeculationRulesJson generates user-provided prerender rules', () => {
  const result = buildSpeculationRulesJson({
    prerender: ['/guide/*'],
  });

  const parsed = JSON.parse(result);
  assertExists(parsed.prerender);
  assertEquals(parsed.prerender[0].where.href_matches, '/guide/*');
});

Deno.test('buildSpeculationRulesJson escapes raw-text terminators in config patterns', () => {
  // The JSON is inlined into a <script type="speculationrules"> raw-text
  // element; a config/plugin pattern containing </script> must not terminate
  // it. Angle brackets in patterns are emitted as unicode escapes, which
  // are legal inside JSON strings, so the parsed value is unchanged.
  const payload = '/x</script><script>alert(1)</script>';
  const result = buildSpeculationRulesJson({ prerender: [payload] });

  assertEquals(result.includes('</script>'), false);
  assertEquals(result.includes('<'), false);
  const parsed = JSON.parse(result);
  assertEquals(parsed.prerender[0].where.href_matches, payload);
});

Deno.test('buildSpeculationRulesJson generates user-provided prefetch rules', () => {
  const result = buildSpeculationRulesJson({
    prefetch: ['/about', '/blog/*'],
  });

  const parsed = JSON.parse(result);
  assertExists(parsed.prefetch);
  assertEquals(parsed.prefetch.length, 2);
});

Deno.test('buildSpeculationRulesJson applies exclusion to user rules', () => {
  const result = buildSpeculationRulesJson({
    prerender: ['/guide/*'],
    exclude: ['/api/*'],
  });

  const parsed = JSON.parse(result);
  assertExists(parsed.prerender[0].where.not);
});

Deno.test('buildSpeculationRulesJson sets eagerness when not moderate', () => {
  const result = buildSpeculationRulesJson({
    prerender: ['/guide/*'],
    eagerness: 'immediate',
  });

  const parsed = JSON.parse(result);
  assertEquals(parsed.prerender[0].eagerness, 'immediate');
});

Deno.test('buildSpeculationRulesJson omits eagerness when moderate (default)', () => {
  const result = buildSpeculationRulesJson({
    prerender: ['/guide/*'],
    eagerness: 'moderate',
  });

  const parsed = JSON.parse(result);
  assertEquals(parsed.prerender[0].eagerness, undefined);
});

Deno.test('buildSpeculationRulesJson excludes API routes in heuristic mode', () => {
  const result = buildSpeculationRulesJson({}, [
    { path: '/', type: 'page' },
    { path: '/api/data', type: 'api' },
  ]);

  const parsed = JSON.parse(result);
  // Heuristic mode generates prerender, not prefetch
  assertExists(parsed.prerender);
  // Only one static page (/) -> no exclusions needed
  assertEquals(parsed.prerender.length, 1);
});

Deno.test('buildSpeculationRulesJson returns empty string when no static pages', () => {
  const result = buildSpeculationRulesJson({}, [
    { path: '/api/data', type: 'api' },
    { path: '/blog/:slug', type: 'page' },
  ]);

  assertEquals(result, '');
});

// #798: a nested page must prefetch both the page itself and its sub-paths —
// '/blog/post/*' alone never matches '/blog/post'.
Deno.test('buildSpeculationRulesJson nested pages prefetch the page itself and sub-paths (#798)', () => {
  const result = buildSpeculationRulesJson({}, [
    { path: '/', type: 'page' },
    { path: '/blog/post', type: 'page' },
  ]);

  const parsed = JSON.parse(result);
  assertExists(parsed.prefetch);
  const matches = parsed.prefetch.map(
    (r: { where?: { href_matches: string } }) => r.where?.href_matches,
  );
  assert(matches.includes('/blog/post'), 'prefetch should match the page itself');
  assert(matches.includes('/blog/post/*'), 'prefetch should match sub-paths');
});

// ─── injectSpeculationRules ───────────────────────────────────

Deno.test('injectSpeculationRules adds script tag to HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body></body></html>');

    const rulesJson = JSON.stringify(
      { prefetch: [{ where: { href_matches: '/about/*' } }] },
      null,
      2,
    );
    injectSpeculationRules(tmp, rulesJson);

    const content = Deno.readTextFileSync(htmlPath);
    assertStringIncludes(content, 'speculationrules');
    assertStringIncludes(content, '/about/*');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectSpeculationRules does nothing with empty rules', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectSpeculationRules(tmp, '');

    const content = Deno.readTextFileSync(htmlPath);
    assertFalse(content.includes('speculationrules'));
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectSpeculationRules does not duplicate on repeated calls', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body></body></html>');

    const rulesJson = JSON.stringify({ prefetch: [{ where: { href_matches: '/' } }] }, null, 2);
    injectSpeculationRules(tmp, rulesJson);
    injectSpeculationRules(tmp, rulesJson);

    const content = Deno.readTextFileSync(htmlPath);
    const count = (content.match(/speculationrules/g) || []).length;
    assertEquals(count, 1);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectSpeculationRules recurses into subdirectories', () => {
  const tmp = makeTempDir();
  try {
    Deno.mkdirSync(join(tmp, 'blog'));
    Deno.writeTextFileSync(join(tmp, 'index.html'), '<html><body></body></html>');
    Deno.writeTextFileSync(join(tmp, 'blog', 'post.html'), '<html><body></body></html>');

    const rulesJson = JSON.stringify({ prefetch: [{ where: { href_matches: '/*' } }] }, null, 2);
    injectSpeculationRules(tmp, rulesJson);

    assertStringIncludes(Deno.readTextFileSync(join(tmp, 'index.html')), 'speculationrules');
    assertStringIncludes(Deno.readTextFileSync(join(tmp, 'blog', 'post.html')), 'speculationrules');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectSpeculationRules still injects when body text mentions speculationrules', () => {
  // Regression: changelog page content contains "speculationrules" as text,
  // which previously caused the injection to be skipped.
  // Fix: check for '<script type="speculationrules"' instead of 'speculationrules'.
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'changelog.html');
    Deno.writeTextFileSync(
      htmlPath,
      '<html><head></head><body><p>We added speculationrules support in v0.9.2</p></body></html>',
    );

    const rulesJson = JSON.stringify({ prefetch: [{ where: { href_matches: '/*' } }] }, null, 2);
    injectSpeculationRules(tmp, rulesJson);

    const content = Deno.readTextFileSync(htmlPath);
    // Should have the script tag injected (not skipped because of body text)
    const matchCount = (content.match(/<script type="speculationrules"/g) || []).length;
    assertEquals(matchCount, 1);
  } finally {
    cleanup(tmp);
  }
});
