/**
 * @openelement/router - build-manifest.ts tests
 *
 * Tests build manifest scanning and formatting using temp directories.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { printBuildManifest, scanClientBuild, scanSSGOutput } from '../src/vite/build-manifest.ts';

import { join } from 'node:path';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'open-test-'));
}

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}

// ─── scanClientBuild ─────────────────────────────────

test('scanClientBuild returns empty when no client dir', () => {
  const result = scanClientBuild('/nonexistent');
  expect(result.islands.length).toEqual(0);
  expect(result.clientEntry).toEqual(null);
  expect(result.totalJsBytes).toEqual(0);
});

test('scanClientBuild finds island chunks', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    mkdirSync(islandsDir, { recursive: true });

    writeFileSync(
      join(islandsDir, 'island-counter-abc123.js'),
      '// counter chunk 1024 bytes'.padEnd(1024, ' '),
    );
    writeFileSync(
      join(islandsDir, 'island-theme-def456.js'),
      '// theme chunk 512 bytes'.padEnd(512, ' '),
    );
    writeFileSync(join(islandsDir, 'client.js'), '// client entry'.padEnd(100, ' '));

    const result = scanClientBuild(tmp);

    expect(result.islands.length >= 2).toEqual(true);
    expect(result.islands.find((i) => i.name === 'island-counter-abc123.js')).toEqual(
      expect.anything(),
    );
    expect(result.islands.find((i) => i.name === 'island-theme-def456.js')).toEqual(
      expect.anything(),
    );
    expect(result.clientEntry).toEqual(expect.anything());
    expect(result.clientEntry!.name).toEqual('client.js');
    expect(result.totalJsBytes > 1500).toBeTruthy();
  } finally {
    cleanup(tmp);
  }
});

test('scanClientBuild skips non-js files', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    mkdirSync(islandsDir, { recursive: true });

    writeFileSync(join(islandsDir, 'island-counter-a1b2.js'), '// js file');
    writeFileSync(join(islandsDir, 'counter.css'), '.css { }');
    writeFileSync(join(islandsDir, 'README.md'), '# readme');

    const result = scanClientBuild(tmp);
    expect(result.islands.length).toEqual(1);
  } finally {
    cleanup(tmp);
  }
});

// ─── scanSSGOutput ──────────────────────────────────

test('scanSSGOutput returns empty when no dist', () => {
  const result = scanSSGOutput('/nonexistent');
  expect(result.length).toEqual(0);
});

test('scanSSGOutput finds HTML files recursively', () => {
  const tmp = makeTempDir();
  try {
    const distDir = join(tmp, 'dist');
    mkdirSync(distDir, { recursive: true });
    mkdirSync(join(distDir, 'blog'));
    writeFileSync(join(distDir, 'index.html'), '<html></html>');
    writeFileSync(join(distDir, 'about.html'), '<html></html>');
    writeFileSync(join(distDir, 'blog', 'post.html'), '<html></html>');
    writeFileSync(join(distDir, 'style.css'), '{}');

    const result = scanSSGOutput(tmp);

    expect(result.length).toEqual(3);
    expect(result.find((f) => f.name === 'index.html')).toEqual(expect.anything());
    expect(result.find((f) => f.name === 'about.html')).toEqual(expect.anything());
    expect(result.find((f) => f.path.includes('post.html'))).toEqual(expect.anything());
  } finally {
    cleanup(tmp);
  }
});

// ─── printBuildManifest ───────────────────────

test('printBuildManifest: Phase 2 (no islands, no HTML)', () => {
  const tmp = makeTempDir();
  try {
    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    expect(manifest.phase).toEqual(2);
    expect(manifest.islands.length).toEqual(0);
    expect(manifest.clientEntry).toEqual(null);
    expect(manifest.htmlPages.length).toEqual(0);
    expect(manifest.totalJsBytes).toEqual(0);
    expect(manifest.headExtrasSize).toEqual(0);
  } finally {
    cleanup(tmp);
  }
});

test('printBuildManifest: Phase 3 with HTML pages', () => {
  const tmp = makeTempDir();
  try {
    const distDir = join(tmp, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<html>hi</html>');
    writeFileSync(join(distDir, 'about.html'), '<html>about</html>');

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 3 });
    expect(manifest.phase).toEqual(3);
    expect(manifest.htmlPages.length).toEqual(2);
    expect(manifest.htmlPages.find((p) => p.name === 'index.html')).toEqual(expect.anything());
    expect(manifest.htmlPages.find((p) => p.name === 'about.html')).toEqual(expect.anything());
    expect(manifest.totalHtmlBytes > 0).toEqual(true);
  } finally {
    cleanup(tmp);
  }
});

test('printBuildManifest: headExtras non-zero', () => {
  const tmp = makeTempDir();
  try {
    const manifest = printBuildManifest({
      root: tmp,
      outDir: 'dist',
      phase: 2,
      headExtras: '<meta name="theme-color" content="#000">',
    });
    expect(manifest.headExtrasSize > 0).toEqual(true);
  } finally {
    cleanup(tmp);
  }
});

test('printBuildManifest: island budget warning', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    mkdirSync(islandsDir, { recursive: true });
    writeFileSync(join(islandsDir, 'island-big-a1b2.js'), 'x'.repeat(51 * 1024));

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    expect(
      manifest.warnings.find((w) => w.includes('exceeds') && w.includes('island-big')),
    ).toEqual(expect.anything());
  } finally {
    cleanup(tmp);
  }
});

test('printBuildManifest: total JS budget warning', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    mkdirSync(islandsDir, { recursive: true });
    writeFileSync(join(islandsDir, 'chunk1.js'), 'x'.repeat(150 * 1024));
    writeFileSync(join(islandsDir, 'chunk2.js'), 'x'.repeat(60 * 1024));

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    expect(manifest.warnings.find((w) => w.includes('Total JS'))).toEqual(expect.anything());
  } finally {
    cleanup(tmp);
  }
});

test('printBuildManifest: custom budget suppresses expected large reader chunks', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    mkdirSync(islandsDir, { recursive: true });
    writeFileSync(join(islandsDir, 'pdf-reader.js'), 'x'.repeat(309 * 1024));
    writeFileSync(join(islandsDir, 'reader-shell.js'), 'x'.repeat(40 * 1024));

    const manifest = printBuildManifest({
      root: tmp,
      outDir: 'dist',
      phase: 2,
      budget: { islandKB: 350, totalJsKB: 450 },
    });
    expect(manifest.warnings).toEqual([]);
  } finally {
    cleanup(tmp);
  }
});

test('printBuildManifest: HTML page budget warning', () => {
  const tmp = makeTempDir();
  try {
    const distDir = join(tmp, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'huge.html'), '<html>' + 'x'.repeat(201 * 1024) + '</html>');

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 3 });
    expect(
      manifest.warnings.find(
        (w) => w.includes('huge.html') && w.includes('advisory') && w.includes('HTML budget'),
      ),
    ).toEqual(expect.anything());
  } finally {
    cleanup(tmp);
  }
});

test('printBuildManifest: no warnings when within budget', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    mkdirSync(islandsDir, { recursive: true });
    writeFileSync(join(islandsDir, 'small.js'), 'x'.repeat(1024));

    const distDir = join(tmp, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<html>small</html>');

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 3 });
    expect(manifest.warnings.length).toEqual(0);
  } finally {
    cleanup(tmp);
  }
});

test('printBuildManifest: returns correct timestamp format', () => {
  const tmp = makeTempDir();
  try {
    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    expect(manifest.timestamp).toEqual(expect.anything());
    expect(typeof manifest.timestamp).toEqual('string');
    expect(manifest.timestamp).toContain('T');
  } finally {
    cleanup(tmp);
  }
});

// ─── Additional branch coverage ──────────────────────────

test('printBuildManifest: Phase 2 with islands and client entry', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    mkdirSync(islandsDir, { recursive: true });
    writeFileSync(join(islandsDir, 'island-counter-abc.js'), 'x'.repeat(2048));
    writeFileSync(join(islandsDir, 'client.js'), '// entry'.padEnd(256, ' '));

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    expect(manifest.islands.length).toEqual(1);
    expect(manifest.clientEntry).toEqual(expect.anything());
    expect(manifest.phase).toEqual(2);
    // Phase 2 should not scan HTML pages
    expect(manifest.htmlPages.length).toEqual(0);
  } finally {
    cleanup(tmp);
  }
});

test('scanClientBuild: shared chunks counted in totalJsBytes', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    mkdirSync(islandsDir, { recursive: true });
    writeFileSync(join(islandsDir, 'island-counter-a1b2.js'), 'x'.repeat(1024));
    writeFileSync(join(islandsDir, 'client.js'), '// entry'.padEnd(100, ' '));
    // A shared chunk (not an island prefix, not client.js)
    writeFileSync(join(islandsDir, 'vendor-abc.js'), 'x'.repeat(2048));

    const result = scanClientBuild(tmp);
    expect(result.islands.length).toEqual(1);
    expect(result.clientEntry).toEqual(expect.anything());
    // Total should include both islands + client.js + shared chunk
    expect(result.totalJsBytes > 3000).toBeTruthy();
  } finally {
    cleanup(tmp);
  }
});

test('printBuildManifest: many HTML pages (>15) triggers "... more" display', () => {
  const tmp = makeTempDir();
  try {
    const distDir = join(tmp, 'dist');
    mkdirSync(distDir, { recursive: true });
    // Create 20 HTML files to exceed maxShow (15)
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(distDir, `page-${i}.html`), `<html>Page ${i}</html>`);
    }

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 3 });
    expect(manifest.htmlPages.length).toEqual(20);
    expect(manifest.totalHtmlBytes > 0).toEqual(true);
  } finally {
    cleanup(tmp);
  }
});

test('formatSize: large file displays in MB range', () => {
  const tmp = makeTempDir();
  try {
    const islandsDir = join(tmp, 'dist', 'client', 'islands');
    mkdirSync(islandsDir, { recursive: true });
    // 2MB file to trigger MB display format
    writeFileSync(join(islandsDir, 'island-huge-a1b2.js'), 'x'.repeat(2 * 1024 * 1024));

    const manifest = printBuildManifest({ root: tmp, outDir: 'dist', phase: 2 });
    expect(manifest.islands.length).toEqual(1);
    // sizeKB should contain "MB"
    expect(manifest.islands[0].sizeKB.includes('MB')).toBeTruthy();
  } finally {
    cleanup(tmp);
  }
});

test('scanClientBuild: non-existent islands directory', () => {
  const tmp = makeTempDir();
  try {
    // Create dist/client but no islands/ subdirectory
    const clientDir = join(tmp, 'dist', 'client');
    mkdirSync(clientDir, { recursive: true });

    const result = scanClientBuild(tmp);
    expect(result.islands.length).toEqual(0);
    expect(result.clientEntry).toEqual(null);
    expect(result.totalJsBytes).toEqual(0);
  } finally {
    cleanup(tmp);
  }
});
