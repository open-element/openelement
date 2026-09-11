/**
 * @openelement/router - ssg-postprocess.ts tests (Deno)
 *
 * Tests the SSG post-processing functions using temp directories.
 */
import { assert, assertEquals, assertExists, assertFalse, assertStringIncludes } from '@std/assert';
import {
  buildIslandChunkMap,
  buildSpeculationRulesJson,
  injectClientScript,
  injectCspMeta,
  injectSpeculationRules,
  injectViewTransitionMeta,
} from '../src/vite/internal/ssg/index.ts';

import { join } from '@std/path';

function makeTempDir(): string {
  return Deno.makeTempDirSync({ prefix: 'open-test-' });
}

function cleanup(dir: string) {
  try {
    Deno.removeSync(dir, { recursive: true });
  } catch { /* ignore */ }
}

// ─── buildIslandChunkMap ──────────────────────────────────────

Deno.test('buildIslandChunkMap returns empty map for non-existent dir', async () => {
  const result = await buildIslandChunkMap('/nonexistent/path', 'dist', ['counter-island']);
  assertEquals(Object.keys(result).length, 0);
});

Deno.test('buildIslandChunkMap returns empty map when no client dir', async () => {
  const tmp = makeTempDir();
  try {
    const outDir = join(tmp, 'dist');
    Deno.mkdirSync(outDir);
    // No client/ subdir
    const result = await buildIslandChunkMap(tmp, outDir, ['counter-island']);
    assertEquals(Object.keys(result).length, 0);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('buildIslandChunkMap returns empty map when no manifest', async () => {
  const tmp = makeTempDir();
  try {
    // Create islands/ dir with chunk files but no manifest
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    Deno.mkdirSync(islandsDir, { recursive: true });
    Deno.writeTextFileSync(join(islandsDir, 'island-counter-island-abc123.js'), '// counter');

    const result = await buildIslandChunkMap(tmp, 'dist', ['counter-island']);
    // Without manifest, returns empty (no fallback scan)
    assertEquals(Object.keys(result).length, 0);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('buildIslandChunkMap scans manifest.json for island chunks', async () => {
  const tmp = makeTempDir();
  try {
    const viteDir = join(tmp, 'dist', 'client', '.vite');
    Deno.mkdirSync(viteDir, { recursive: true });

    const manifest = {
      'src/islands/counter-island.ts': { file: 'islands/island-counter-island-abc123.js' },
      'src/islands/open-theme-toggle.ts': { file: 'islands/island-open-theme-toggle-def456.js' },
      '.openElement-client-entry.ts': { file: 'islands/client.js' },
    };
    Deno.writeTextFileSync(join(viteDir, 'manifest.json'), JSON.stringify(manifest));

    const result = await buildIslandChunkMap(
      tmp,
      'dist',
      ['counter-island', 'open-theme-toggle'],
    );

    assertExists(result['counter-island']);
    assertExists(result['open-theme-toggle']);
    assertStringIncludes(result['counter-island'], 'counter');
    assertStringIncludes(result['open-theme-toggle'], 'theme');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('buildIslandChunkMap respects basePath option', async () => {
  const tmp = makeTempDir();
  try {
    const viteDir = join(tmp, 'dist', 'client', '.vite');
    Deno.mkdirSync(viteDir, { recursive: true });
    const manifest = {
      'src/islands/counter-island.ts': { file: 'islands/island-counter-island-abc.js' },
    };
    Deno.writeTextFileSync(join(viteDir, 'manifest.json'), JSON.stringify(manifest));

    const result = await buildIslandChunkMap(tmp, 'dist', ['counter-island'], '/my-app/');
    assert(result['counter-island'].startsWith('/my-app/'));
  } finally {
    cleanup(tmp);
  }
});

Deno.test('buildIslandChunkMap handles malformed manifest.json', async () => {
  const tmp = makeTempDir();
  try {
    const viteDir = join(tmp, 'dist', 'client', '.vite');
    Deno.mkdirSync(viteDir, { recursive: true });
    Deno.writeTextFileSync(join(viteDir, 'manifest.json'), '{invalid json');

    const result = await buildIslandChunkMap(tmp, 'dist', ['counter-island']);
    // Malformed manifest returns empty map
    assertEquals(Object.keys(result).length, 0);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('buildIslandChunkMap skips manifest entries without file field', async () => {
  const tmp = makeTempDir();
  try {
    const viteDir = join(tmp, 'dist', 'client', '.vite');
    Deno.mkdirSync(viteDir, { recursive: true });
    const manifest = {
      'src/something.ts': { css: ['style.css'] },
      'src/islands/counter.ts': { file: 'islands/island-counter-abc123.js' },
    };
    Deno.writeTextFileSync(join(viteDir, 'manifest.json'), JSON.stringify(manifest));

    const result = await buildIslandChunkMap(tmp, 'dist', ['counter']);
    assertExists(result['counter']);
  } finally {
    cleanup(tmp);
  }
});

Deno.test(
  'buildIslandChunkMap: manifest entry.file with islands/ prefix has no double prefix',
  async () => {
    const tmp = makeTempDir();
    try {
      const viteDir = join(tmp, 'dist', 'client', '.vite');
      Deno.mkdirSync(viteDir, { recursive: true });

      const manifest = {
        'app/islands/my-counter.ts': { file: 'islands/island-my-counter-abc123.js' },
      };
      Deno.writeTextFileSync(join(viteDir, 'manifest.json'), JSON.stringify(manifest));

      const result = await buildIslandChunkMap(tmp, 'dist', ['my-counter']);

      assertExists(result['my-counter']);
      assertFalse(
        result['my-counter'].includes('islands/islands/'),
        'Path must NOT have double islands/ prefix, got: ' + result['my-counter'],
      );
      assertStringIncludes(
        result['my-counter'],
        'client/islands/island-my-counter-abc123.js',
        'Path should be client/islands/island-my-counter-abc123.js, got: ' + result['my-counter'],
      );
    } finally {
      cleanup(tmp);
    }
  },
);

// Regression: Rolldown/Vite content hashes are base64url and may contain
// `-`/`_` (real site/dist output: scroll-reveal-PciKqeu-.js,
// open-tabs-CcG-LXBP.js, flexsearch.bundle.module.min-BKwbD_Kx.js).
// The old filename regex ([A-Za-z0-9]+ hash, lazy tagName split) silently
// dropped these chunks.

Deno.test('buildIslandChunkMap matches base64url hashes with trailing dash via manifest name', async () => {
  const tmp = makeTempDir();
  try {
    const viteDir = join(tmp, 'dist', 'client', '.vite');
    Deno.mkdirSync(viteDir, { recursive: true });

    // Mirrors the real site/dist/client/.vite/manifest.json shape.
    const manifest = {
      'app/islands/scroll-reveal.tsx': {
        file: 'islands/scroll-reveal-PciKqeu-.js',
        name: 'scroll-reveal',
      },
      '../third-party component package/src/open-tabs.tsx': {
        file: 'islands/open-tabs-CcG-LXBP.js',
        name: 'open-tabs',
      },
      // Shared (non-island) chunks living in islands/ — must not be
      // matched and must not trigger the unmatched-chunk warning.
      '_src-CT3H-DGJ.js': { file: 'islands/src-CT3H-DGJ.js', name: 'src' },
      'flexsearch/dist/flexsearch.bundle.module.min.js': {
        file: 'islands/flexsearch.bundle.module.min-BKwbD_Kx.js',
        name: 'flexsearch.bundle.module.min',
      },
    };
    Deno.writeTextFileSync(join(viteDir, 'manifest.json'), JSON.stringify(manifest));

    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '));
    };
    let result: Record<string, string>;
    try {
      result = await buildIslandChunkMap(tmp, 'dist', ['scroll-reveal', 'open-tabs']);
    } finally {
      console.warn = origWarn;
    }

    assertEquals(
      result['scroll-reveal'],
      '/client/islands/scroll-reveal-PciKqeu-.js',
    );
    assertEquals(
      result['open-tabs'],
      '/client/islands/open-tabs-CcG-LXBP.js',
    );
    assertFalse('src' in result, 'Shared chunk must not be mapped as an island');
    assertEquals(
      warnings.filter((w) => w.includes('Unmatched island chunk')).length,
      0,
      'Shared chunks must not trigger the unmatched-chunk warning, got: ' + warnings.join(' | '),
    );
  } finally {
    cleanup(tmp);
  }
});

Deno.test('buildIslandChunkMap falls back to filename matching when manifest has no name field', async () => {
  const tmp = makeTempDir();
  try {
    const viteDir = join(tmp, 'dist', 'client', '.vite');
    Deno.mkdirSync(viteDir, { recursive: true });

    const manifest = {
      // manualChunks naming: island-<tag>-<hash>.js, hash contains `-`/`_`.
      'app/islands/scroll-reveal.ts': { file: 'islands/island-scroll-reveal-PciKqeu-.js' },
      'app/islands/open-tabs.ts': { file: 'islands/island-open-tabs-CcG-LXBP.js' },
      'app/islands/flex-search.ts': { file: 'islands/island-flex-search-BKwbD_Kx.js' },
    };
    Deno.writeTextFileSync(join(viteDir, 'manifest.json'), JSON.stringify(manifest));

    const result = await buildIslandChunkMap(
      tmp,
      'dist',
      ['scroll-reveal', 'open-tabs', 'flex-search'],
    );

    assertEquals(result['scroll-reveal'], '/client/islands/island-scroll-reveal-PciKqeu-.js');
    assertEquals(result['open-tabs'], '/client/islands/island-open-tabs-CcG-LXBP.js');
    assertEquals(result['flex-search'], '/client/islands/island-flex-search-BKwbD_Kx.js');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('buildIslandChunkMap warns on unmatched island chunks instead of dropping silently', async () => {
  const tmp = makeTempDir();
  try {
    const viteDir = join(tmp, 'dist', 'client', '.vite');
    Deno.mkdirSync(viteDir, { recursive: true });

    const manifest = {
      'app/islands/ghost-widget.ts': {
        file: 'islands/island-ghost-widget-AbCdEf12.js',
        name: 'island-ghost-widget',
      },
    };
    Deno.writeTextFileSync(join(viteDir, 'manifest.json'), JSON.stringify(manifest));

    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '));
    };
    let result: Record<string, string>;
    try {
      result = await buildIslandChunkMap(tmp, 'dist', ['counter-island']);
    } finally {
      console.warn = origWarn;
    }

    assertEquals(Object.keys(result).length, 0);
    assertExists(
      warnings.find((w) => w.includes('Unmatched island chunk') && w.includes('ghost-widget')),
      'Should warn about the unmatched island chunk, got: ' + warnings.join(' | '),
    );
    assertExists(
      warnings.find((w) => w.includes('No client chunk found') && w.includes('counter-island')),
      'Should warn about the island left without a chunk, got: ' + warnings.join(' | '),
    );
  } finally {
    cleanup(tmp);
  }
});

// ─── injectClientScript ──────────────────────────────────────

Deno.test('injectClientScript adds script tag to HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><body><p>Hello</p></body></html>');

    injectClientScript(tmp, '/client/islands/client.js');

    const content = Deno.readTextFileSync(htmlPath);
    assertStringIncludes(content, '/client/islands/client.js');
    assertStringIncludes(content, '<script type="module"');
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectClientScript does not duplicate existing injection', () => {
  const tmp = makeTempDir();
  try {
    const scriptTag = '<script type="module" src="/client/islands/client.js"></script>';
    const htmlPath = join(tmp, 'index.html');
    Deno.writeTextFileSync(
      htmlPath,
      `<html><head></head><body>${scriptTag}<p>Hello</p></body></html>`,
    );

    injectClientScript(tmp, '/client/islands/client.js');

    const content = Deno.readTextFileSync(htmlPath);
    const count = (content.match(/client\.js/g) || []).length;
    assertEquals(count <= 1, true);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('injectClientScript recurses into subdirectories', () => {
  const tmp = makeTempDir();
  try {
    Deno.mkdirSync(join(tmp, 'blog'));
    Deno.writeTextFileSync(join(tmp, 'index.html'), '<html><body></body></html>');
    Deno.writeTextFileSync(join(tmp, 'blog', 'post.html'), '<html><body></body></html>');

    injectClientScript(tmp, '/client.js');

    assertStringIncludes(Deno.readTextFileSync(join(tmp, 'index.html')), '/client.js');
    assertStringIncludes(Deno.readTextFileSync(join(tmp, 'blog', 'post.html')), '/client.js');
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

Deno.test('injectClientScript handles HTML without </body> tag', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'no-body.html');
    Deno.writeTextFileSync(htmlPath, '<html><head></head><p>No body close');

    injectClientScript(tmp, '/client.js');

    const content = Deno.readTextFileSync(htmlPath);
    assertStringIncludes(content, '/client.js');
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

Deno.test('injectCspMeta warns when nonce=true', () => {
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

Deno.test('injectClientScript skips non-HTML files', () => {
  const tmp = makeTempDir();
  try {
    const htmlPath = join(tmp, 'index.html');
    const jsPath = join(tmp, 'app.js');
    Deno.writeTextFileSync(htmlPath, '<html><body></body></html>');
    Deno.writeTextFileSync(jsPath, 'console.log("hi")');

    injectClientScript(tmp, '/client.js');

    const jsContent = Deno.readTextFileSync(jsPath);
    assertEquals(jsContent, 'console.log("hi")', 'JS files should not be modified');
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
    assertStringIncludes(
      Deno.readTextFileSync(join(tmp, 'guide', 'page.html')),
      'view-transition',
    );
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
    parsed.prerender.some((r: { source?: string; urls?: string[] }) =>
      r.source === 'list' && r.urls?.includes('/')
    ),
    'Home page should be a list rule with / in urls',
  );
  // Top-level page produces a document rule (where.href_matches)
  assert(
    parsed.prerender.some((r: { where?: { href_matches: string } }) =>
      r.where?.href_matches === '/about'
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
    Deno.writeTextFileSync(
      join(tmp, 'blog', 'post.html'),
      '<html><body></body></html>',
    );

    const rulesJson = JSON.stringify({ prefetch: [{ where: { href_matches: '/*' } }] }, null, 2);
    injectSpeculationRules(tmp, rulesJson);

    assertStringIncludes(Deno.readTextFileSync(join(tmp, 'index.html')), 'speculationrules');
    assertStringIncludes(
      Deno.readTextFileSync(join(tmp, 'blog', 'post.html')),
      'speculationrules',
    );
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
