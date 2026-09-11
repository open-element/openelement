/**
 * @openelement/router - build-manifest.ts tests (Deno)
 *
 * Tests build manifest scanning and formatting using temp directories.
 */
import { assert, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { printBuildManifest, scanClientBuild, scanSSGOutput } from '../src/vite/build-manifest.ts';

import { join } from '@std/path';

function makeTempDir(): string {
  return Deno.makeTempDirSync({ prefix: 'open-test-' });
}

function cleanup(dir: string) {
  try {
    Deno.removeSync(dir, { recursive: true });
  } catch { /* ignore */ }
}

// ─── scanClientBuild ─────────────────────────────────

Deno.test('scanClientBuild returns empty when no client dir', () => {
  const result = scanClientBuild('/nonexistent');
  assertEquals(result.islands.length, 0);
  assertEquals(result.clientEntry, null);
  assertEquals(result.totalJsBytes, 0);
});

Deno.test('scanClientBuild finds island chunks', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    Deno.mkdirSync(islandsDir, { recursive: true });

    Deno.writeTextFileSync(
      join(islandsDir, 'island-counter-abc123.js'),
      '// counter chunk 1024 bytes'.padEnd(1024, ' '),
    );
    Deno.writeTextFileSync(
      join(islandsDir, 'island-theme-def456.js'),
      '// theme chunk 512 bytes'.padEnd(512, ' '),
    );
    Deno.writeTextFileSync(join(islandsDir, 'client.js'), '// client entry'.padEnd(100, ' '));

    const result = scanClientBuild(tmp);

    assertEquals(result.islands.length >= 2, true);
    assertExists(result.islands.find((i) => i.name === 'island-counter-abc123.js'));
    assertExists(result.islands.find((i) => i.name === 'island-theme-def456.js'));
    assertExists(result.clientEntry);
    assertEquals(result.clientEntry!.name, 'client.js');
    assert(result.totalJsBytes > 1500);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('scanClientBuild skips non-js files', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    Deno.mkdirSync(islandsDir, { recursive: true });

    Deno.writeTextFileSync(join(islandsDir, 'island-counter-a1b2.js'), '// js file');
    Deno.writeTextFileSync(join(islandsDir, 'counter.css'), '.css { }');
    Deno.writeTextFileSync(join(islandsDir, 'README.md'), '# readme');

    const result = scanClientBuild(tmp);
    assertEquals(result.islands.length, 1);
  } finally {
    cleanup(tmp);
  }
});

// ─── scanSSGOutput ──────────────────────────────────

Deno.test('scanSSGOutput returns empty when no dist', () => {
  const result = scanSSGOutput('/nonexistent');
  assertEquals(result.length, 0);
});

Deno.test('scanSSGOutput finds HTML files recursively', () => {
  const tmp = makeTempDir();
  try {
    const distDir = join(tmp, 'dist');
    Deno.mkdirSync(distDir, { recursive: true });
    Deno.mkdirSync(join(distDir, 'blog'));
    Deno.writeTextFileSync(join(distDir, 'index.html'), '<html></html>');
    Deno.writeTextFileSync(join(distDir, 'about.html'), '<html></html>');
    Deno.writeTextFileSync(join(distDir, 'blog', 'post.html'), '<html></html>');
    Deno.writeTextFileSync(join(distDir, 'style.css'), '{}');

    const result = scanSSGOutput(tmp);

    assertEquals(result.length, 3);
    assertExists(result.find((f) => f.name === 'index.html'));
    assertExists(result.find((f) => f.name === 'about.html'));
    assertExists(result.find((f) => f.path.includes('post.html')));
  } finally {
    cleanup(tmp);
  }
});

// ─── printBuildManifest ───────────────────────

Deno.test('printBuildManifest: Phase 2 (no islands, no HTML)', () => {
  const tmp = makeTempDir();
  try {
    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    assertEquals(manifest.phase, 2);
    assertEquals(manifest.islands.length, 0);
    assertEquals(manifest.clientEntry, null);
    assertEquals(manifest.htmlPages.length, 0);
    assertEquals(manifest.totalJsBytes, 0);
    assertEquals(manifest.headExtrasSize, 0);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('printBuildManifest: Phase 3 with HTML pages', () => {
  const tmp = makeTempDir();
  try {
    const distDir = join(tmp, 'dist');
    Deno.mkdirSync(distDir, { recursive: true });
    Deno.writeTextFileSync(join(distDir, 'index.html'), '<html>hi</html>');
    Deno.writeTextFileSync(join(distDir, 'about.html'), '<html>about</html>');

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 3 });
    assertEquals(manifest.phase, 3);
    assertEquals(manifest.htmlPages.length, 2);
    assertExists(manifest.htmlPages.find((p) => p.name === 'index.html'));
    assertExists(manifest.htmlPages.find((p) => p.name === 'about.html'));
    assertEquals(manifest.totalHtmlBytes > 0, true);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('printBuildManifest: headExtras non-zero', () => {
  const tmp = makeTempDir();
  try {
    const manifest = printBuildManifest({
      root: tmp,
      outDir: 'dist',
      phase: 2,
      headExtras: '<meta name="theme-color" content="#000">',
    });
    assertEquals(manifest.headExtrasSize > 0, true);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('printBuildManifest: island budget warning', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    Deno.mkdirSync(islandsDir, { recursive: true });
    Deno.writeTextFileSync(
      join(islandsDir, 'island-big-a1b2.js'),
      'x'.repeat(51 * 1024),
    );

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    assertExists(manifest.warnings.find((w) => w.includes('exceeds') && w.includes('island-big')));
  } finally {
    cleanup(tmp);
  }
});

Deno.test('printBuildManifest: total JS budget warning', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    Deno.mkdirSync(islandsDir, { recursive: true });
    Deno.writeTextFileSync(join(islandsDir, 'chunk1.js'), 'x'.repeat(150 * 1024));
    Deno.writeTextFileSync(join(islandsDir, 'chunk2.js'), 'x'.repeat(60 * 1024));

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    assertExists(manifest.warnings.find((w) => w.includes('Total JS')));
  } finally {
    cleanup(tmp);
  }
});

Deno.test('printBuildManifest: custom budget suppresses expected large reader chunks', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    Deno.mkdirSync(islandsDir, { recursive: true });
    Deno.writeTextFileSync(join(islandsDir, 'pdf-reader.js'), 'x'.repeat(309 * 1024));
    Deno.writeTextFileSync(join(islandsDir, 'reader-shell.js'), 'x'.repeat(40 * 1024));

    const manifest = printBuildManifest({
      root: tmp,
      outDir: 'dist',
      phase: 2,
      budget: { islandKB: 350, totalJsKB: 450 },
    });
    assertEquals(manifest.warnings, []);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('printBuildManifest: HTML page budget warning', () => {
  const tmp = makeTempDir();
  try {
    const distDir = join(tmp, 'dist');
    Deno.mkdirSync(distDir, { recursive: true });
    Deno.writeTextFileSync(
      join(distDir, 'huge.html'),
      '<html>' + 'x'.repeat(201 * 1024) + '</html>',
    );

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 3 });
    assertExists(
      manifest.warnings.find((w) =>
        w.includes('huge.html') && w.includes('advisory') && w.includes('HTML budget')
      ),
    );
  } finally {
    cleanup(tmp);
  }
});

Deno.test('printBuildManifest: no warnings when within budget', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    Deno.mkdirSync(islandsDir, { recursive: true });
    Deno.writeTextFileSync(join(islandsDir, 'small.js'), 'x'.repeat(1024));

    const distDir = join(tmp, 'dist');
    Deno.mkdirSync(distDir, { recursive: true });
    Deno.writeTextFileSync(join(distDir, 'index.html'), '<html>small</html>');

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 3 });
    assertEquals(manifest.warnings.length, 0);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('printBuildManifest: returns correct timestamp format', () => {
  const tmp = makeTempDir();
  try {
    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    assertExists(manifest.timestamp);
    assertEquals(typeof manifest.timestamp, 'string');
    assertStringIncludes(manifest.timestamp, 'T');
  } finally {
    cleanup(tmp);
  }
});

// ─── Additional branch coverage ──────────────────────────

Deno.test('printBuildManifest: Phase 2 with islands and client entry', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    Deno.mkdirSync(islandsDir, { recursive: true });
    Deno.writeTextFileSync(join(islandsDir, 'island-counter-abc.js'), 'x'.repeat(2048));
    Deno.writeTextFileSync(join(islandsDir, 'client.js'), '// entry'.padEnd(256, ' '));

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    assertEquals(manifest.islands.length, 1);
    assertExists(manifest.clientEntry);
    assertEquals(manifest.phase, 2);
    // Phase 2 should not scan HTML pages
    assertEquals(manifest.htmlPages.length, 0);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('scanClientBuild: shared chunks counted in totalJsBytes', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    Deno.mkdirSync(islandsDir, { recursive: true });
    Deno.writeTextFileSync(join(islandsDir, 'island-counter-a1b2.js'), 'x'.repeat(1024));
    Deno.writeTextFileSync(join(islandsDir, 'client.js'), '// entry'.padEnd(100, ' '));
    // A shared chunk (not an island prefix, not client.js)
    Deno.writeTextFileSync(join(islandsDir, 'vendor-abc.js'), 'x'.repeat(2048));

    const result = scanClientBuild(tmp);
    assertEquals(result.islands.length, 1);
    assertExists(result.clientEntry);
    // Total should include both islands + client.js + shared chunk
    assert(result.totalJsBytes > 3000);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('printBuildManifest: many HTML pages (>15) triggers "... more" display', () => {
  const tmp = makeTempDir();
  try {
    const distDir = join(tmp, 'dist');
    Deno.mkdirSync(distDir, { recursive: true });
    // Create 20 HTML files to exceed maxShow (15)
    for (let i = 0; i < 20; i++) {
      Deno.writeTextFileSync(join(distDir, `page-${i}.html`), `<html>Page ${i}</html>`);
    }

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 3 });
    assertEquals(manifest.htmlPages.length, 20);
    assertEquals(manifest.totalHtmlBytes > 0, true);
  } finally {
    cleanup(tmp);
  }
});

Deno.test('formatSize: large file displays in MB range', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    Deno.mkdirSync(islandsDir, { recursive: true });
    // 2MB file to trigger MB display format
    Deno.writeTextFileSync(
      join(islandsDir, 'island-huge-a1b2.js'),
      'x'.repeat(2 * 1024 * 1024),
    );

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    assertEquals(manifest.islands.length, 1);
    // sizeKB should contain "MB"
    assert(manifest.islands[0].sizeKB.includes('MB'));
  } finally {
    cleanup(tmp);
  }
});

Deno.test('scanClientBuild: non-existent islands directory', () => {
  const tmp = makeTempDir();
  try {
    // Create dist/client but no islands/ subdirectory
    const clientDir = join(tmp, 'dist', 'client');
    Deno.mkdirSync(clientDir, { recursive: true });

    const result = scanClientBuild(tmp);
    assertEquals(result.islands.length, 0);
    assertEquals(result.clientEntry, null);
    assertEquals(result.totalJsBytes, 0);
  } finally {
    cleanup(tmp);
  }
});
