/**
 * @openelement/router - SSG integration tests
 *
 * Tests the SSG post-processing pipeline under the #1471/S4b contract:
 *   1. islandChunkMapFromAssetManifest - client asset manifest -> tagName -> chunk URL
 *      (identity-driven; no output file name is ever parsed)
 *   2. injectCspMeta - add CSP meta tags to HTML
 *
 * The client script is NOT injected post-build: the document renderer embeds
 * the final script tags at render time from the asset manifest.
 *
 * openElement Architecture constraints verified:
 *   - S (Static): DSD content visible without JS
 *   - K+I (Knowledge + Isolated): Islands are the only JS
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { join } from 'node:path';
import { injectCspMeta, islandChunkMapFromAssetManifest } from '../src/vite/internal/ssg/index.ts';
import type { ClientAssetManifest } from '../src/vite/internal/protocol/client-assets.ts';

// ─── Test fixtures ─────────────────────────────────────────────

const FIXTURES_DIR = join(process.cwd(), 'packages/router/__test_fixtures__/ssg');

async function setupSsgFixtures() {
  const islandsDir = join(FIXTURES_DIR, 'dist', 'client', 'islands');
  await mkdir(islandsDir, { recursive: true });

  await writeFile(
    join(islandsDir, 'island-my-counter-abc123.js'),
    'const e="my-counter";customElements.define(e,MyCounter);',
  );
  await writeFile(
    join(islandsDir, 'island-theme-toggle-def456.js'),
    "const t='theme-toggle';customElements.define(t,Toggle);",
  );

  // Simulate SSG HTML output with DSD
  const htmlDir = join(FIXTURES_DIR, 'dist');
  await writeFile(
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
  await mkdir(aboutDir, { recursive: true });
  await writeFile(
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
    await rm(FIXTURES_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

const MANIFEST: ClientAssetManifest = {
  entry: '/client/islands/client.js',
  islands: {
    'my-counter': { file: '/client/islands/island-my-counter-abc123.js', strategy: 'idle' },
    'theme-toggle': { file: '/client/islands/island-theme-toggle-def456.js', strategy: 'load' },
  },
  shared: [],
};

// ─── Tests ─────────────────────────────────────────────────────

describe('SSG integration', () => {
  beforeAll(async () => {
    await setupSsgFixtures();
  });
  afterAll(async () => {
    await cleanupSsgFixtures();
  });

  test('islandChunkMapFromAssetManifest - maps every scanned island identity', () => {
    const chunkMap = islandChunkMapFromAssetManifest(MANIFEST, ['my-counter', 'theme-toggle']);
    expect(chunkMap).toEqual({
      'my-counter': '/client/islands/island-my-counter-abc123.js',
      'theme-toggle': '/client/islands/island-theme-toggle-def456.js',
    });
  });

  test('islandChunkMapFromAssetManifest - a chunk rename never moves the tag identity', () => {
    const renamed: ClientAssetManifest = {
      ...MANIFEST,
      islands: {
        'my-counter': { file: '/client/islands/shared-bundle-Qq11.js', strategy: 'idle' },
      },
    };
    expect(islandChunkMapFromAssetManifest(renamed, ['my-counter'])).toEqual({
      'my-counter': '/client/islands/shared-bundle-Qq11.js',
    });
  });

  test('injectCspMeta - adds <meta http-equiv="Content-Security-Policy"> to head', () => {
    injectCspMeta(join(FIXTURES_DIR, 'dist'), "default-src 'self'; script-src 'self'", false);

    const html = readFileSync(join(FIXTURES_DIR, 'dist', 'index.html'), 'utf8');
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'self'");
    const headEnd = html.indexOf('</head>');
    const metaIdx = html.indexOf('Content-Security-Policy');
    expect(metaIdx < headEnd).toEqual(true);
  });

  test('rendered HTML carries no post-build script surgery (S constraint)', () => {
    const html = readFileSync(join(FIXTURES_DIR, 'dist', 'index.html'), 'utf8');
    expect(html.includes('<script')).toEqual(false);
  });

  test('DSD content preserved (S constraint)', () => {
    const html = readFileSync(join(FIXTURES_DIR, 'dist', 'index.html'), 'utf8');

    expect(html).toContain('shadowroot="open"');
    expect(html).toContain('shadowrootmode="open"');
    expect(html).toContain('docs-home');
    expect(html).toContain('app-layout');
    expect(html).toContain('docs-sidebar');
  });
});
