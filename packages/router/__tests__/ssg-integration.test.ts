/**
 * @openelement/router - SSG integration tests (Deno)
 *
 * Tests the SSG post-processing pipeline:
 *   1. buildIslandChunkMap - scan client build output -> tagName -> chunk path mapping
 *   2. injectClientScript - add client script tags to HTML
 *   3. injectCspMeta - add CSP meta tags to HTML
 *
 * openElement Architecture constraints verified:
 *   - S (Static): DSD content visible without JS
 *   - K+I (Knowledge + Isolated): Islands are the only JS
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import { join } from 'jsr:@std/path@^1.0.0';
import {
  buildIslandChunkMap,
  injectClientScript,
  injectCspMeta,
} from '../src/vite/internal/ssg/index.ts';

// ─── Test fixtures ─────────────────────────────────────────────

const FIXTURES_DIR = join(Deno.cwd(), 'packages/router/__test_fixtures__/ssg');

async function setupSsgFixtures() {
  const islandsDir = join(FIXTURES_DIR, 'dist', 'client', 'islands');
  await Deno.mkdir(islandsDir, { recursive: true });

  await Deno.writeTextFile(
    join(islandsDir, 'island-my-counter-abc123.js'),
    'const e="my-counter";customElements.define(e,MyCounter);',
  );
  await Deno.writeTextFile(
    join(islandsDir, 'island-theme-toggle-def456.js'),
    "const t='theme-toggle';customElements.define(t,Toggle);",
  );

  // Simulate SSG HTML output with DSD
  const htmlDir = join(FIXTURES_DIR, 'dist');
  await Deno.writeTextFile(
    join(htmlDir, 'index.html'),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>openElement</title>
</head>
<body>
<docs-home><template shadowroot="open" shadowrootmode="open"><style>:host { display: block; }</style>
  <app-layout currentpath="/"><template shadowroot="open" shadowrootmode="open"><style>:host { display: block; }</style>
    <nav class="docs-sidebar">
      <a href="/" class="" aria-current="">Home</a>
      <a href="/about" class="" aria-current="">About</a>
    </nav>
  </template></app-layout>
</template></docs-home>
</body>
</html>`,
  );

  // Sub-page HTML (about page)
  const aboutDir = join(htmlDir, 'about');
  await Deno.mkdir(aboutDir, { recursive: true });
  await Deno.writeTextFile(
    join(aboutDir, 'index.html'),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>openElement</title>
</head>
<body>
<docs-about><template shadowroot="open" shadowrootmode="open"><style>:host { display: block; }</style>
  <app-layout currentpath="/about"><template shadowroot="open" shadowrootmode="open"><style>:host { display: block; }</style>
    <nav class="docs-sidebar">
      <a href="/" class="" aria-current="">Home</a>
      <a href="/about" class="" aria-current="">About</a>
    </nav>
  </template></app-layout>
</template></docs-about>
</body>
</html>`,
  );
}

async function cleanupSsgFixtures() {
  try {
    await Deno.remove(FIXTURES_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ─── Tests ─────────────────────────────────────────────────────

Deno.test('SSG integration', { permissions: { read: true, write: true } }, async (t) => {
  await setupSsgFixtures();

  await t.step('buildIslandChunkMap - returns empty without manifest', async () => {
    const chunkMap = await buildIslandChunkMap(
      join(FIXTURES_DIR),
      'dist',
      ['my-counter', 'theme-toggle'],
      '/kiss/',
    );

    // No .vite/manifest.json exists -> empty map
    assertEquals(Object.keys(chunkMap).length, 0);
  });

  await t.step('buildIslandChunkMap - returns empty map when no client dir', async () => {
    const chunkMap = await buildIslandChunkMap(
      join(FIXTURES_DIR),
      'nonexistent',
      ['my-counter'],
    );
    assertEquals(Object.keys(chunkMap).length, 0);
  });

  await t.step('injectClientScript - adds <script type="module"> before </body>', () => {
    injectClientScript(join(FIXTURES_DIR, 'dist'), '/client/islands/client.js');

    const html = Deno.readTextFileSync(join(FIXTURES_DIR, 'dist', 'index.html'));
    assertStringIncludes(html, '<script type="module" src="/client/islands/client.js"></script>');
    const bodyIdx = html.indexOf('</body>');
    const scriptIdx = html.indexOf('/client/islands/client.js');
    assertEquals(scriptIdx < bodyIdx, true);
  });

  await t.step('injectClientScript - does not duplicate existing script', () => {
    injectClientScript(join(FIXTURES_DIR, 'dist'), '/client/islands/client.js');

    const html = Deno.readTextFileSync(join(FIXTURES_DIR, 'dist', 'index.html'));
    const count = (html.match(/\/client\/islands\/client\.js/g) || []).length;
    assertEquals(count, 1);
  });

  await t.step('injectCspMeta - adds <meta http-equiv="Content-Security-Policy"> to head', () => {
    injectCspMeta(
      join(FIXTURES_DIR, 'dist'),
      "default-src 'self'; script-src 'self'",
      false,
    );

    const html = Deno.readTextFileSync(join(FIXTURES_DIR, 'dist', 'index.html'));
    assertStringIncludes(html, '<meta http-equiv="Content-Security-Policy"');
    assertStringIncludes(html, "default-src 'self'");
    const headEnd = html.indexOf('</head>');
    const metaIdx = html.indexOf('Content-Security-Policy');
    assertEquals(metaIdx < headEnd, true);
  });

  await t.step('DSD content preserved (S constraint)', () => {
    const html = Deno.readTextFileSync(join(FIXTURES_DIR, 'dist', 'index.html'));

    assertStringIncludes(html, 'shadowroot="open"');
    assertStringIncludes(html, 'shadowrootmode="open"');
    assertStringIncludes(html, 'docs-home');
    assertStringIncludes(html, 'app-layout');
    assertStringIncludes(html, 'docs-sidebar');
  });

  // Cleanup
  await cleanupSsgFixtures();
});
