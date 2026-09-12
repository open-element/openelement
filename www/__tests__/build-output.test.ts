/**
 * Build output assertions — runs against www/dist after a production build.
 * These tests validate that build artifacts meet security and size constraints.
 *
 * Run: deno test www/__tests__/build-output.test.ts --allow-read
 * (must run after `deno task build`)
 */
import { assert, assertEquals } from '@std/assert';
import { existsSync } from '@std/fs';
import { walkSync } from '@std/fs/walk';
import { join } from '@std/path';

const DIST = join(import.meta.dirname ?? '.', '..', 'dist');

Deno.test('build output: no Hono virtual entry in public assets', () => {
  assert(existsSync(DIST), `Build output is missing: ${DIST}`);
  const assetsDir = join(DIST, 'assets');
  assert(existsSync(assetsDir), `Build assets directory is missing: ${assetsDir}`);

  const files = [...Deno.readDirSync(assetsDir)].map((entry) => entry.name);
  const honoEntry = files.find((f) => f.startsWith('_virtual_less-hono-entry'));
  assertEquals(
    honoEntry,
    undefined,
    `Hono virtual entry should not be in dist/assets/: ${honoEntry}`,
  );
});

Deno.test('build output: client island JS stays within core budget and ships no showcase chunks', () => {
  assert(existsSync(DIST), `Build output is missing: ${DIST}`);
  const clientDir = join(DIST, 'client');
  assert(existsSync(clientDir), `Client output directory is missing: ${clientDir}`);

  // Showcase islands were removed from the site; the production build must not
  // emit any of these chunks. Keep the historical prefixes as a regression
  // guard so a re-introduced showcase island fails loudly.
  const removedShowcaseChunks = [
    'island-media-chrome-showcase',
    'island-react-showcase',
    'island-shoelace-showcase',
    'island-reactive-showcase',
    'island-scroll-reveal',
  ];
  const files = [...walkSync(clientDir, { includeDirs: false })].map((entry) => entry.path);
  let coreBytes = 0;
  const emittedShowcase: string[] = [];
  for (const f of files) {
    if (f.endsWith('.js')) {
      if (removedShowcaseChunks.some((prefix) => f.includes(prefix))) {
        emittedShowcase.push(f);
      } else {
        coreBytes += Deno.statSync(f).size;
      }
    }
  }
  const coreKB = coreBytes / 1024;
  assertEquals(
    emittedShowcase,
    [],
    `Removed showcase islands must not be emitted by the production build: ${
      emittedShowcase.join(', ')
    }`,
  );
  assert(
    coreKB < 700,
    `Core client island JS total ${coreKB.toFixed(1)}KB exceeds 700KB limit`,
  );
});

Deno.test('build output: zh pages keep in-content links inside the zh tree (#1031)', () => {
  assert(existsSync(DIST), `Build output is missing: ${DIST}`);
  const zhDir = join(DIST, 'zh');
  assert(existsSync(zhDir), `zh build output is missing: ${zhDir}`);

  // Scope: the pages whose in-content links are authored in route components —
  // the blog index, the docs index, and every guide page. Blog post *bodies*
  // come from locale-shared markdown and are intentionally out of scope.
  const targets = [join(zhDir, 'blog', 'index.html'), join(zhDir, 'docs', 'index.html')];
  const guideDir = join(zhDir, 'guide');
  if (existsSync(guideDir)) {
    for (const entry of walkSync(guideDir, { includeDirs: false, exts: ['.html'] })) {
      targets.push(entry.path);
    }
  }

  // Matches absolute-path hrefs on anchor tags: <a ... href="/path" ...>
  const anchorRe = /<a\b[^>]*?\bhref="(\/[^"]*)"[^>]*>/g;
  const failures: string[] = [];
  for (const file of targets) {
    assert(existsSync(file), `Expected zh page is missing: ${file}`);
    const html = Deno.readTextFileSync(file);
    for (const match of html.matchAll(anchorRe)) {
      const [tag, href] = match;
      // Layout chrome links carry data-nav and are localized client-side by
      // open-layout (#816); only in-content links are asserted here.
      if (tag.includes('data-nav')) continue;
      if (href === '/zh' || href.startsWith('/zh/')) continue;
      failures.push(`${file}: ${href}`);
    }
  }
  assertEquals(
    failures,
    [],
    `zh pages must not contain unprefixed internal links:\n${failures.join('\n')}`,
  );
});
