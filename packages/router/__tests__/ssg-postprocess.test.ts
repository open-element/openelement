/**
 * @openelement/router - ssg-postprocess.ts tests
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { OpenElementError } from '@openelement/element';
import { ClientAssetErrorCode } from '../src/internal/error-codes.ts';
import {
  buildIslandPrefetchLinks,
  buildSpeculationRulesJson,
  extractLinkHrefs,
  injectCspMeta,
  injectIslandPrefetchRules,
  injectSpeculationRules,
  injectViewTransitionMeta,
  pageChunkMap,
  routeFromRelativePath,
} from '../src/vite/internal/ssg/index.ts';
import {
  islandChunkMapFromAssetManifest,
  postProcessClientIslandBuild,
} from '../src/vite/internal/ssg/build-postprocess.ts';
import { stableHash } from '../src/vite/internal/ssg/ssg-helpers.ts';
import type { ClientAssetManifest } from '../src/vite/internal/protocol/client-assets.ts';
import type { IslandDecl } from '../src/vite/internal/protocol/ssg.ts';

import { join } from 'node:path';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'open-test-'));
}

/** The per-page island manifest file writeIslandManifests emits for a route. */
async function pageManifestPath(outputDir: string, route: string): Promise<string> {
  // sha256 hex of the route, matching island-manifest.ts's stableHash naming.
  return join(outputDir, 'island-manifests', `page-${await stableHash(route)}.json`);
}

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}

// ─── islandChunkMapFromAssetManifest (identity-driven chunk resolution) ──

test('islandChunkMapFromAssetManifest maps delivery tags to manifest asset URLs', () => {
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
    styles: [],
  };
  const map = islandChunkMapFromAssetManifest(manifest, ['open-counter', 'open-theme-toggle']);
  expect(map).toEqual({
    'open-counter': '/client/islands/island-counter-Ab12.js',
    'open-theme-toggle': '/client/islands/island-open-theme-toggle-Cd34.js',
  });
});

test('islandChunkMapFromAssetManifest follows a chunk rename through the manifest, not the name', () => {
  // The file name carries no identity: after a rename/rehash the tag keeps
  // resolving through the manifest record (joined on module ids at build
  // time). The retired filename-prefix matcher would have dropped this.
  const renamed: ClientAssetManifest = {
    entry: '/client/islands/client.js',
    islands: {
      'open-counter': { file: '/client/islands/shared-bundle-Zz99.js', strategy: 'idle' },
    },
    shared: [],
    styles: [],
  };
  expect(islandChunkMapFromAssetManifest(renamed, ['open-counter'])['open-counter']).toEqual(
    '/client/islands/shared-bundle-Zz99.js',
  );
});

test('islandChunkMapFromAssetManifest fails closed on islands the manifest does not record', () => {
  // The former warn-and-continue shipped a partial chunk map: a page would
  // carry an island whose client script never loads. Now the join fails,
  // naming the island — whatever else the manifest does record.
  const error = assertThrowsIncludes(
    () =>
      islandChunkMapFromAssetManifest(
        {
          entry: '/client/islands/client.js',
          islands: { 'open-other': { file: '/client/islands/other.js', strategy: 'idle' } },
          shared: [],
          styles: [],
        },
        ['open-ghost'],
      ),
    OpenElementError,
  );
  expect(error.code).toEqual(ClientAssetErrorCode.ISLAND_UNMAPPED);
  expect(error.phase).toEqual('build');
  expect(
    error.message.includes('open-ghost') && error.message.includes('client asset manifest'),
    `error names the island and the manifest: ${error.message}`,
  ).toBeTruthy();
});

test('islandChunkMapFromAssetManifest fails closed for every island when no manifest shipped', () => {
  const error = assertThrowsIncludes(
    () => islandChunkMapFromAssetManifest(null, ['open-counter']),
    OpenElementError,
  );
  expect(error.code).toEqual(ClientAssetErrorCode.ISLAND_UNMAPPED);
  expect(
    error.message.includes('open-counter') && error.message.includes('no client asset manifest'),
    `error names the island and the missing manifest: ${error.message}`,
  ).toBeTruthy();
  // An island-free build owes no records: the empty list maps without
  // consulting the manifest at all.
  expect(islandChunkMapFromAssetManifest(null, [])).toEqual({});
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

test('postProcessClientIslandBuild writes per-page manifests with manifest-keyed chunks and leaves HTML untouched', async () => {
  const tmp = makeTempDir();
  try {
    const dist = join(tmp, 'dist');
    mkdirSync(join(dist, 'guide'), { recursive: true });
    writeFileSync(
      join(dist, 'index.html'),
      '<html><head></head><body><open-counter></open-counter></body></html>',
    );
    writeFileSync(
      join(dist, 'guide', 'page.html'),
      '<html><head></head><body><p>no islands here</p></body></html>',
    );

    const manifest: ClientAssetManifest = {
      entry: '/client/islands/client.js',
      islands: {
        'open-counter': { file: '/client/islands/island-counter-Ab12.js', strategy: 'idle' },
      },
      shared: [],
      styles: [],
    };
    await postProcessClientIslandBuild(ctxView(manifest, tmp));

    // The island identity resolves through the manifest, chunk URL intact.
    const homeManifest = JSON.parse(readFileSync(await pageManifestPath(dist, '/'), 'utf8')) as {
      route: string;
      islands: Array<{ tagName: string; chunkUrl: string; strategy: string }>;
    };
    expect(homeManifest.route).toEqual('/');
    const counter = homeManifest.islands.find((entry) => entry.tagName === 'open-counter');
    expect(counter).toEqual(expect.anything());
    expect(counter.chunkUrl).toEqual('/client/islands/island-counter-Ab12.js');
    expect(counter.strategy).toEqual('idle');

    // A page without islands gets a manifest with an empty island list.
    const guideManifest = JSON.parse(
      readFileSync(await pageManifestPath(dist, '/guide/page'), 'utf8'),
    ) as { islands: unknown[] };
    expect(guideManifest.islands).toEqual([]);

    // No script surgery: the rendered HTML is left byte-identical — script
    // tags were already embedded at document render time (#1471).
    expect(readFileSync(join(dist, 'index.html'), 'utf8')).toEqual(
      '<html><head></head><body><open-counter></open-counter></body></html>',
    );
    expect(
      !readFileSync(join(dist, 'index.html'), 'utf8').includes('<script'),
      'post-processing must not inject scripts into rendered HTML',
    ).toBeTruthy();
  } finally {
    cleanup(tmp);
  }
});

function dirExists(path: string): boolean {
  try {
    return statSync(path).isDirectory;
  } catch {
    return false;
  }
}

test('postProcessClientIslandBuild without a manifest fails closed and writes nothing', async () => {
  const tmp = makeTempDir();
  try {
    const dist = join(tmp, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(
      join(dist, 'index.html'),
      '<html><body><open-counter></open-counter></body></html>',
    );

    const error = await assertRejectsIncludes(
      () => postProcessClientIslandBuild(ctxView(null, tmp)),
      OpenElementError,
    );
    expect(error.code).toEqual(ClientAssetErrorCode.ISLAND_UNMAPPED);
    expect(
      error.message.includes('open-counter'),
      `error names the unrecorded island: ${error.message}`,
    ).toBeTruthy();
    // No partial manifest: the pass either writes the complete set or none
    // of it — here nothing was written at all.
    expect(dirExists(join(dist, 'island-manifests'))).toEqual(false);
    // The rendered HTML stays untouched either way.
    expect(readFileSync(join(dist, 'index.html'), 'utf8')).toEqual(
      '<html><body><open-counter></open-counter></body></html>',
    );
  } finally {
    cleanup(tmp);
  }
});

test('postProcessClientIslandBuild fails before writing when the manifest misses one island', async () => {
  // One island resolves, one does not: the failure must land BEFORE any
  // page manifest is generated, so the output tree never carries a partial
  // record that silently omits the unrecorded island.
  const tmp = makeTempDir();
  try {
    const dist = join(tmp, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(
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
      styles: [],
    };
    const error = await assertRejectsIncludes(
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
    expect(error.code).toEqual(ClientAssetErrorCode.ISLAND_UNMAPPED);
    expect(
      error.message.includes('open-theme'),
      `error names the island: ${error.message}`,
    ).toBeTruthy();
    expect(dirExists(join(dist, 'island-manifests'))).toEqual(false);
  } finally {
    cleanup(tmp);
  }
});

test('postProcessClientIslandBuild validates only the local metadata Phase 2 selected', async () => {
  // buildClient narrows ctx.phase1.islandTagNames to the reachable client
  // set but leaves islandMeta carrying every scanned island. An unselected
  // island's metadata — malformed or merely multi-tag — must be neither
  // validated nor delivered: re-admitting it would fail the fail-closed
  // chunk map for an island that ships nothing.
  const tmp = makeTempDir();
  try {
    const dist = join(tmp, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(
      join(dist, 'index.html'),
      '<html><body><open-counter></open-counter></body></html>',
    );
    const manifest: ClientAssetManifest = {
      entry: '/client/islands/client.js',
      islands: {
        'open-counter': { file: '/client/islands/island-counter-Ab12.js', strategy: 'idle' },
      },
      shared: [],
      styles: [],
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
    const pageManifest = JSON.parse(readFileSync(await pageManifestPath(dist, '/'), 'utf8')) as {
      islands: Array<{ tagName: string; chunkUrl: string; strategy: string; layer: string }>;
    };
    expect(pageManifest.islands).toEqual([
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

test('injectCspMeta adds CSP meta tag to HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    writeFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectCspMeta(tmp, "default-src 'self'");

    const content = readFileSync(htmlPath, 'utf8');
    expect(content).toContain('Content-Security-Policy');
    expect(content).toContain("default-src 'self'");
  } finally {
    cleanup(tmp);
  }
});

test('injectCspMeta uses Report-Only header in report-only mode', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    writeFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectCspMeta(tmp, "default-src 'self'", true);

    const content = readFileSync(htmlPath, 'utf8');
    expect(content).toContain('Content-Security-Policy-Report-Only');
    expect(content.includes('"Content-Security-Policy"')).toBeFalsy();
  } finally {
    cleanup(tmp);
  }
});

test('injectCspMeta escapes double quotes in policy', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    writeFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectCspMeta(tmp, `default-src 'self'; script-src "unsafe-inline"`);

    const content = readFileSync(htmlPath, 'utf8');
    expect(content).toContain('&quot;');
  } finally {
    cleanup(tmp);
  }
});

test('injectCspMeta does not duplicate on repeated calls', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    writeFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectCspMeta(tmp, "default-src 'self'");
    injectCspMeta(tmp, "default-src 'self'");

    const content = readFileSync(htmlPath, 'utf8');
    const count = (content.match(/Content-Security-Policy/g) || []).length;
    expect(count).toEqual(1);
  } finally {
    cleanup(tmp);
  }
});

test('injectCspMeta handles HTML without <head> tag', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'no-head.html');
    writeFileSync(htmlPath, '<html><body><p>No head</p></body></html>');

    injectCspMeta(tmp, "default-src 'self'");

    const content = readFileSync(htmlPath, 'utf8');
    expect(content).toContain('Content-Security-Policy');
  } finally {
    cleanup(tmp);
  }
});

test('injectCspMeta handles HTML starting with <!DOCTYPE>', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'doctype.html');
    writeFileSync(htmlPath, '<!DOCTYPE html><html><body></body></html>');

    injectCspMeta(tmp, "default-src 'self'");

    const content = readFileSync(htmlPath, 'utf8');
    expect(content).toContain('Content-Security-Policy');
  } finally {
    cleanup(tmp);
  }
});

test('injectCspMeta warns when nonce=true (SSG rejects nonce — behavior unchanged)', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'nonce.html');
    writeFileSync(htmlPath, '<html><head></head><body></body></html>');

    const origWarn = console.warn;
    let warnMsg = '';
    console.warn = (...args: unknown[]) => {
      warnMsg = args.join(' ');
    };

    injectCspMeta(tmp, "default-src 'self'", false, true);

    console.warn = origWarn;
    expect(warnMsg, 'Should warn about nonce not supported').toContain('nonce');
    // The rejection is real: no nonce attribute may reach the static output.
    expect(
      readFileSync(htmlPath, 'utf8').includes('nonce='),
      'SSG output must not carry a nonce attribute',
    ).toBeFalsy();
  } finally {
    cleanup(tmp);
  }
});

test('injectCspMeta skips non-HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    const txtPath = join(tmp, 'readme.txt');
    writeFileSync(htmlPath, '<html><head></head><body></body></html>');
    writeFileSync(txtPath, 'Not HTML');

    injectCspMeta(tmp, "default-src 'self'");

    const txtContent = readFileSync(txtPath, 'utf8');
    expect(txtContent, 'Non-HTML files should not be modified').toEqual('Not HTML');
  } finally {
    cleanup(tmp);
  }
});

// ─── injectViewTransitionMeta ─────────────────────────────────

test('injectViewTransitionMeta adds meta tag to HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    writeFileSync(htmlPath, '<html><head></head><body><p>Hello</p></body></html>');

    injectViewTransitionMeta(tmp);

    const content = readFileSync(htmlPath, 'utf8');
    expect(content).toContain('view-transition');
    expect(content).toContain('same-origin');
  } finally {
    cleanup(tmp);
  }
});

test('injectViewTransitionMeta does not duplicate on repeated calls', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    writeFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectViewTransitionMeta(tmp);
    injectViewTransitionMeta(tmp);

    const content = readFileSync(htmlPath, 'utf8');
    const count = (content.match(/view-transition/g) || []).length;
    expect(count).toEqual(1);
  } finally {
    cleanup(tmp);
  }
});

test('injectViewTransitionMeta recurses into subdirectories', () => {
  const tmp = makeTempDir();
  try {
    mkdirSync(join(tmp, 'guide'));
    writeFileSync(join(tmp, 'index.html'), '<html><head></head><body></body></html>');
    writeFileSync(join(tmp, 'guide', 'page.html'), '<html><head></head><body></body></html>');

    injectViewTransitionMeta(tmp);

    expect(readFileSync(join(tmp, 'index.html'), 'utf8')).toContain('view-transition');
    expect(readFileSync(join(tmp, 'guide', 'page.html'), 'utf8')).toContain('view-transition');
  } finally {
    cleanup(tmp);
  }
});

test('injectViewTransitionMeta skips non-HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    const txtPath = join(tmp, 'readme.txt');
    writeFileSync(htmlPath, '<html><head></head><body></body></html>');
    writeFileSync(txtPath, 'Not HTML');

    injectViewTransitionMeta(tmp);

    const txtContent = readFileSync(txtPath, 'utf8');
    expect(txtContent).toEqual('Not HTML');
  } finally {
    cleanup(tmp);
  }
});

test('injectViewTransitionMeta handles HTML without <head> tag', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'no-head.html');
    writeFileSync(htmlPath, '<html><body><p>No head</p></body></html>');

    injectViewTransitionMeta(tmp);

    const content = readFileSync(htmlPath, 'utf8');
    expect(content).toContain('view-transition');
  } finally {
    cleanup(tmp);
  }
});

test('injectViewTransitionMeta still injects when body text mentions view-transition', () => {
  // Regression: changelog page content contains "view-transition" as text,
  // which previously caused the injection to be skipped.
  // Fix: check for '<meta name="view-transition"' instead of 'view-transition'.
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'changelog.html');
    writeFileSync(
      htmlPath,
      '<html><head></head><body><p>We added view-transition support in v0.9.2</p></body></html>',
    );

    injectViewTransitionMeta(tmp);

    const content = readFileSync(htmlPath, 'utf8');
    // Should have the meta tag injected (not skipped because of body text)
    const matchCount = (content.match(/<meta name="view-transition"/g) || []).length;
    expect(matchCount).toEqual(1);
  } finally {
    cleanup(tmp);
  }
});

// ─── buildSpeculationRulesJson ────────────────────────────────

test('buildSpeculationRulesJson returns empty string for no options and no routes', () => {
  const result = buildSpeculationRulesJson({});
  expect(result).toEqual('');
});

test('buildSpeculationRulesJson generates heuristic prerender rules from routes', () => {
  const result = buildSpeculationRulesJson({}, [
    { path: '/', type: 'page' },
    { path: '/about', type: 'page' },
    { path: '/api/data', type: 'api' },
    { path: '/blog/:slug', type: 'page' },
  ]);

  const parsed = JSON.parse(result);
  // Heuristic mode generates prerender rules (not prefetch)
  expect(parsed.prerender).toEqual(expect.anything());
  // Home page is a list rule (source + urls, no where)
  expect(
    parsed.prerender.some(
      (r: { source?: string; urls?: string[] }) => r.source === 'list' && r.urls?.includes('/'),
    ),
    'Home page should be a list rule with / in urls',
  ).toBeTruthy();
  // Top-level page produces a document rule (where.href_matches)
  expect(
    parsed.prerender.some(
      (r: { where?: { href_matches: string } }) => r.where?.href_matches === '/about',
    ),
    'Top-level page should produce an /about document rule',
  ).toBeTruthy();
  // API routes are excluded from the document rules
  expect(
    parsed.prerender.some((r: { where?: { not?: unknown } }) => r.where?.not != null),
    'API routes should be excluded via where.not',
  ).toBeTruthy();
  // Dynamic routes (with :) should be excluded
  expect(result.includes('/blog/:slug')).toBeFalsy();
});

test('buildSpeculationRulesJson generates user-provided prerender rules', () => {
  const result = buildSpeculationRulesJson({
    prerender: ['/guide/*'],
  });

  const parsed = JSON.parse(result);
  expect(parsed.prerender).toEqual(expect.anything());
  expect(parsed.prerender[0].where.href_matches).toEqual('/guide/*');
});

test('buildSpeculationRulesJson escapes raw-text terminators in config patterns', () => {
  // The JSON is inlined into a <script type="speculationrules"> raw-text
  // element; a config/plugin pattern containing </script> must not terminate
  // it. Angle brackets in patterns are emitted as unicode escapes, which
  // are legal inside JSON strings, so the parsed value is unchanged.
  const payload = '/x</script><script>alert(1)</script>';
  const result = buildSpeculationRulesJson({ prerender: [payload] });

  expect(result.includes('</script>')).toEqual(false);
  expect(result.includes('<')).toEqual(false);
  const parsed = JSON.parse(result);
  expect(parsed.prerender[0].where.href_matches).toEqual(payload);
});

test('buildSpeculationRulesJson generates user-provided prefetch rules', () => {
  const result = buildSpeculationRulesJson({
    prefetch: ['/about', '/blog/*'],
  });

  const parsed = JSON.parse(result);
  expect(parsed.prefetch).toEqual(expect.anything());
  expect(parsed.prefetch.length).toEqual(2);
});

test('buildSpeculationRulesJson applies exclusion to user rules', () => {
  const result = buildSpeculationRulesJson({
    prerender: ['/guide/*'],
    exclude: ['/api/*'],
  });

  const parsed = JSON.parse(result);
  expect(parsed.prerender[0].where.not).toEqual(expect.anything());
});

test('buildSpeculationRulesJson sets eagerness when not moderate', () => {
  const result = buildSpeculationRulesJson({
    prerender: ['/guide/*'],
    eagerness: 'immediate',
  });

  const parsed = JSON.parse(result);
  expect(parsed.prerender[0].eagerness).toEqual('immediate');
});

test('buildSpeculationRulesJson omits eagerness when moderate (default)', () => {
  const result = buildSpeculationRulesJson({
    prerender: ['/guide/*'],
    eagerness: 'moderate',
  });

  const parsed = JSON.parse(result);
  expect(parsed.prerender[0].eagerness).toEqual(undefined);
});

test('buildSpeculationRulesJson excludes API routes in heuristic mode', () => {
  const result = buildSpeculationRulesJson({}, [
    { path: '/', type: 'page' },
    { path: '/api/data', type: 'api' },
  ]);

  const parsed = JSON.parse(result);
  // Heuristic mode generates prerender, not prefetch
  expect(parsed.prerender).toEqual(expect.anything());
  // Only one static page (/) -> no exclusions needed
  expect(parsed.prerender.length).toEqual(1);
});

test('buildSpeculationRulesJson returns empty string when no static pages', () => {
  const result = buildSpeculationRulesJson({}, [
    { path: '/api/data', type: 'api' },
    { path: '/blog/:slug', type: 'page' },
  ]);

  expect(result).toEqual('');
});

// #798: a nested page must prefetch both the page itself and its sub-paths —
// '/blog/post/*' alone never matches '/blog/post'.
test('buildSpeculationRulesJson nested pages prefetch the page itself and sub-paths (#798)', () => {
  const result = buildSpeculationRulesJson({}, [
    { path: '/', type: 'page' },
    { path: '/blog/post', type: 'page' },
  ]);

  const parsed = JSON.parse(result);
  expect(parsed.prefetch).toEqual(expect.anything());
  const matches = parsed.prefetch.map(
    (r: { where?: { href_matches: string } }) => r.where?.href_matches,
  );
  expect(matches.includes('/blog/post'), 'prefetch should match the page itself').toBeTruthy();
  expect(matches.includes('/blog/post/*'), 'prefetch should match sub-paths').toBeTruthy();
});

// ─── injectSpeculationRules ───────────────────────────────────

test('injectSpeculationRules adds script tag to HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    writeFileSync(htmlPath, '<html><head></head><body></body></html>');

    const rulesJson = JSON.stringify(
      { prefetch: [{ where: { href_matches: '/about/*' } }] },
      null,
      2,
    );
    injectSpeculationRules(tmp, rulesJson);

    const content = readFileSync(htmlPath, 'utf8');
    expect(content).toContain('speculationrules');
    expect(content).toContain('/about/*');
  } finally {
    cleanup(tmp);
  }
});

test('injectSpeculationRules does nothing with empty rules', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    writeFileSync(htmlPath, '<html><head></head><body></body></html>');

    injectSpeculationRules(tmp, '');

    const content = readFileSync(htmlPath, 'utf8');
    expect(content.includes('speculationrules')).toBeFalsy();
  } finally {
    cleanup(tmp);
  }
});

test('injectSpeculationRules does not duplicate on repeated calls', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    writeFileSync(htmlPath, '<html><head></head><body></body></html>');

    const rulesJson = JSON.stringify({ prefetch: [{ where: { href_matches: '/' } }] }, null, 2);
    injectSpeculationRules(tmp, rulesJson);
    injectSpeculationRules(tmp, rulesJson);

    const content = readFileSync(htmlPath, 'utf8');
    const count = (content.match(/speculationrules/g) || []).length;
    expect(count).toEqual(1);
  } finally {
    cleanup(tmp);
  }
});

test('injectSpeculationRules recurses into subdirectories', () => {
  const tmp = makeTempDir();
  try {
    mkdirSync(join(tmp, 'blog'));
    writeFileSync(join(tmp, 'index.html'), '<html><body></body></html>');
    writeFileSync(join(tmp, 'blog', 'post.html'), '<html><body></body></html>');

    const rulesJson = JSON.stringify({ prefetch: [{ where: { href_matches: '/*' } }] }, null, 2);
    injectSpeculationRules(tmp, rulesJson);

    expect(readFileSync(join(tmp, 'index.html'), 'utf8')).toContain('speculationrules');
    expect(readFileSync(join(tmp, 'blog', 'post.html'), 'utf8')).toContain('speculationrules');
  } finally {
    cleanup(tmp);
  }
});

test('injectSpeculationRules still injects when body text mentions speculationrules', () => {
  // Regression: changelog page content contains "speculationrules" as text,
  // which previously caused the injection to be skipped.
  // Fix: check for '<script type="speculationrules"' instead of 'speculationrules'.
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'changelog.html');
    writeFileSync(
      htmlPath,
      '<html><head></head><body><p>We added speculationrules support in v0.9.2</p></body></html>',
    );

    const rulesJson = JSON.stringify({ prefetch: [{ where: { href_matches: '/*' } }] }, null, 2);
    injectSpeculationRules(tmp, rulesJson);

    const content = readFileSync(htmlPath, 'utf8');
    // Should have the script tag injected (not skipped because of body text)
    const matchCount = (content.match(/<script type="speculationrules"/g) || []).length;
    expect(matchCount).toEqual(1);
  } finally {
    cleanup(tmp);
  }
});

// ─── Per-page island-chunk prefetch (#1561) ─────────────────────────────

test('buildIslandPrefetchLinks returns empty for an empty chunk set', () => {
  expect(buildIslandPrefetchLinks([])).toEqual('');
});

test('buildIslandPrefetchLinks emits resource prefetch link tags', () => {
  const html = buildIslandPrefetchLinks(['/client/islands/a-1.js', '/client/islands/b-2.js']);
  expect(html).toContain(
    '<link rel="prefetch" as="fetch" href="/client/islands/a-1.js" data-open-island-prefetch>',
  );
  expect(html).toContain(
    '<link rel="prefetch" as="fetch" href="/client/islands/b-2.js" data-open-island-prefetch>',
  );
  expect(html).not.toContain('speculationrules');
});

test('extractLinkHrefs reads anchors and skips comments, script and style blocks', () => {
  const html = `
<!-- <a href="/in-comment"> -->
<script>const html = '<a href="/in-script">';</script>
<style>a { content: '<a href="/in-style">' }</style>
<a href="/first">one</a>
<a href='/second'>two</a>
<a data-x=1 href=/third>three</a>
<a name="no-href">four</a>
`;
  expect(extractLinkHrefs(html)).toEqual(['/first', '/second', '/third']);
});

test('routeFromRelativePath is the single output-path → route derivation', () => {
  expect(routeFromRelativePath('index.html')).toEqual('/');
  expect(routeFromRelativePath('about.html')).toEqual('/about');
  expect(routeFromRelativePath(join('guide', 'intro', 'index.html'))).toEqual('/guide/intro');
});

test('pageChunkMap dedupes and sorts each route’s chunk URLs', () => {
  const map = pageChunkMap([
    {
      route: '/a',
      islands: [
        { tagName: 'x-b', chunkUrl: '/c/b.js', strategy: 'idle', layer: 'dsd-static' },
        { tagName: 'x-a', chunkUrl: '/c/shared.js', strategy: 'idle', layer: 'dsd-static' },
        { tagName: 'x-c', chunkUrl: '/c/b.js', strategy: 'idle', layer: 'pure-island' },
      ],
      builtAt: '1970-01-01T00:00:00.000Z',
    },
  ]);
  expect(map.get('/a')).toEqual(['/c/b.js', '/c/shared.js']);
});

test('injectIslandPrefetchRules writes each page the chunks of the pages it links to', () => {
  const tmp = makeTempDir();
  try {
    mkdirSync(tmp, { recursive: true });
    mkdirSync(join(tmp, 'about'), { recursive: true });
    mkdirSync(join(tmp, 'blog'), { recursive: true });
    writeFileSync(
      join(tmp, 'index.html'),
      '<html><head><title>home</title></head><body>' +
        '<a href="/about">about</a><a href="/blog/x">post</a>' +
        '<a href="https://elsewhere.example/nope">external</a><a href="#top">anchor</a>' +
        '</body></html>',
    );
    writeFileSync(
      join(tmp, 'about', 'index.html'),
      '<html><head></head><body><p>no links</p></body></html>',
    );
    writeFileSync(
      join(tmp, 'blog', 'x.html'),
      '<html><head></head><body><a href="/">home</a><a href="/about/">about</a></body></html>',
    );

    // The chunk facts come from the island manifests (pageChunkMap form) —
    // the consumer shape the build lane feeds the injector.
    const pageChunks = pageChunkMap([
      {
        route: '/',
        islands: [
          {
            tagName: 'open-home',
            chunkUrl: '/client/islands/home-Zz9.js',
            strategy: 'idle',
            layer: 'dsd-static',
          },
        ],
        builtAt: '1970-01-01T00:00:00.000Z',
      },
      {
        route: '/about',
        islands: [
          {
            tagName: 'open-counter',
            chunkUrl: '/client/islands/counter-Ab12.js',
            strategy: 'idle',
            layer: 'dsd-static',
          },
        ],
        builtAt: '1970-01-01T00:00:00.000Z',
      },
      {
        route: '/blog/x',
        islands: [
          {
            tagName: 'open-badge',
            chunkUrl: '/client/islands/badge-Cd34.js',
            strategy: 'idle',
            layer: 'pure-island',
          },
          {
            tagName: 'open-badge-2',
            chunkUrl: '/client/islands/badge-Cd34.js',
            strategy: 'idle',
            layer: 'pure-island',
          },
        ],
        builtAt: '1970-01-01T00:00:00.000Z',
      },
    ]);
    injectIslandPrefetchRules(tmp, pageChunks);

    const index = readFileSync(join(tmp, 'index.html'), 'utf8');
    // /about + /blog/x chunks; external and anchor links contribute nothing;
    // the page's own chunk (home-Zz9) is never listed. Resource prefetch
    // link tags, not speculationrules (Speculation Rules targets documents).
    expect(index).toContain(
      '<link rel="prefetch" as="fetch" href="/client/islands/badge-Cd34.js" data-open-island-prefetch>',
    );
    expect(index).toContain(
      '<link rel="prefetch" as="fetch" href="/client/islands/counter-Ab12.js" data-open-island-prefetch>',
    );
    expect(index).not.toContain('home-Zz9');
    expect((index.match(/data-open-island-prefetch/g) || []).length).toEqual(2);
    expect(index.indexOf('rel="prefetch"')).toBeGreaterThan(index.indexOf('<head>'));

    // A page without outbound links ships no prefetch links.
    const about = readFileSync(join(tmp, 'about', 'index.html'), 'utf8');
    expect(about.includes('rel="prefetch"')).toEqual(false);

    // Trailing-slash links resolve to the same route; the home page's own
    // chunk is excluded from /blog/x's list (it links to / only).
    const blogX = readFileSync(join(tmp, 'blog', 'x.html'), 'utf8');
    expect(blogX).toContain(
      '<link rel="prefetch" as="fetch" href="/client/islands/counter-Ab12.js" data-open-island-prefetch>',
    );
    expect(blogX).toContain(
      '<link rel="prefetch" as="fetch" href="/client/islands/home-Zz9.js" data-open-island-prefetch>',
    );
    expect(blogX).not.toContain('badge-Cd34');
  } finally {
    cleanup(tmp);
  }
});

test('injectIslandPrefetchRules is idempotent and leaves other lanes’ tags alone', () => {
  const tmp = makeTempDir();
  try {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      join(tmp, 'index.html'),
      '<html><head></head><body><a href="/about">about</a></body></html>',
    );
    // The global speculation lane's tag is a different script — it must not
    // block (or be blocked by) this lane.
    writeFileSync(
      join(tmp, 'about.html'),
      '<html><head><script type="speculationrules">{"prefetch":[]}</script></head>' +
        '<body><a href="/">home</a></body></html>',
    );
    const pageChunks = pageChunkMap([
      {
        route: '/',
        islands: [
          {
            tagName: 'open-home',
            chunkUrl: '/client/islands/home-Zz9.js',
            strategy: 'idle',
            layer: 'dsd-static',
          },
        ],
        builtAt: '1970-01-01T00:00:00.000Z',
      },
      {
        route: '/about',
        islands: [
          {
            tagName: 'open-counter',
            chunkUrl: '/client/islands/counter-Ab12.js',
            strategy: 'idle',
            layer: 'dsd-static',
          },
        ],
        builtAt: '1970-01-01T00:00:00.000Z',
      },
    ]);

    injectIslandPrefetchRules(tmp, pageChunks);
    injectIslandPrefetchRules(tmp, pageChunks);

    const index = readFileSync(join(tmp, 'index.html'), 'utf8');
    expect((index.match(/data-open-island-prefetch/g) || []).length).toEqual(1);
    // The global lane's tag survives untouched; the about page gains its own
    // prefetch link (not a second speculationrules script — resource prefetch
    // uses link tags, not the Speculation Rules document API).
    const about = readFileSync(join(tmp, 'about.html'), 'utf8');
    expect((about.match(/<script type="speculationrules"/g) || []).length).toEqual(1);
    expect(about.includes('data-open-island-prefetch')).toEqual(true);
  } finally {
    cleanup(tmp);
  }
});
