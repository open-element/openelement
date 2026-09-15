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
import { SITE_BUDGET } from '../site-budget.ts';

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
  const oversizedIslands: string[] = [];
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    if (removedShowcaseChunks.some((prefix) => f.includes(prefix))) {
      emittedShowcase.push(f);
      continue;
    }
    const size = Deno.statSync(f).size;
    coreBytes += size;
    if (f.includes('island-') && size > SITE_BUDGET.islandKB * 1024) {
      oversizedIslands.push(`${f} (${(size / 1024).toFixed(1)}KB)`);
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
  // The one shared official-Site SLO (www/site-budget.ts) is enforced
  // here and by the build manifest; exceeding it fails instead of warning.
  assertEquals(
    oversizedIslands,
    [],
    `Islands exceed the ${SITE_BUDGET.islandKB}KB island budget: ${oversizedIslands.join(', ')}`,
  );
  assert(
    coreKB <= SITE_BUDGET.totalJsKB,
    `Client island JS total ${
      coreKB.toFixed(1)
    }KB exceeds the ${SITE_BUDGET.totalJsKB}KB Site budget`,
  );
});

Deno.test('build output: the light-mode probe fixture stays out of the public Site (#1148)', () => {
  assert(existsSync(DIST), `Build output is missing: ${DIST}`);

  // The probe moved to tests/fixtures/site-light-probe; a re-introduced Site
  // route must fail loudly in every locale artifact and index.
  for (const path of [join(DIST, 'probe-light'), join(DIST, 'zh', 'probe-light')]) {
    assertEquals(existsSync(path), false, `internal probe output must not ship: ${path}`);
  }

  // Route manifests: every emitted island manifest records its route.
  const manifestDir = join(DIST, 'island-manifests');
  if (existsSync(manifestDir)) {
    for (const entry of Deno.readDirSync(manifestDir)) {
      if (!entry.isFile || !entry.name.endsWith('.json')) continue;
      const manifest = JSON.parse(
        Deno.readTextFileSync(join(manifestDir, entry.name)),
      ) as { route?: string };
      assert(
        manifest.route !== '/probe-light' && manifest.route !== '/zh/probe-light',
        `route manifest ${entry.name} still contains the internal probe`,
      );
    }
  }

  const sitemap = Deno.readTextFileSync(join(DIST, 'sitemap.xml'));
  assert(!sitemap.includes('/probe-light'), 'sitemap must not list the internal probe');
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
