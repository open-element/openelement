/**
 * Build output assertions — runs against www/dist after a production build.
 * These tests validate that build artifacts meet security and size constraints.
 *
 * Run: pnpm --dir www run test (the vitest www project)
 * (must run after `pnpm run site:build`)
 */
import { expect, test } from 'vitest';

import { join } from 'node:path';
import { SITE_BUDGET } from '../site-budget.ts';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const DIST = join(import.meta.dirname ?? '.', '..', 'dist');

test('build output: no Hono virtual entry in public assets', () => {
  expect(existsSync(DIST), `Build output is missing: ${DIST}`).toBeTruthy();
  const assetsDir = join(DIST, 'assets');
  expect(existsSync(assetsDir), `Build assets directory is missing: ${assetsDir}`).toBeTruthy();

  const files = [...readdirSync(assetsDir, { withFileTypes: true })].map((entry) => entry.name);
  const honoEntry = files.find((f) => f.startsWith('_virtual_less-hono-entry'));
  expect(honoEntry, `Hono virtual entry should not be in dist/assets/: ${honoEntry}`).toEqual(
    undefined,
  );
});

test('build output: client island JS stays within core budget and ships no showcase chunks', () => {
  expect(existsSync(DIST), `Build output is missing: ${DIST}`).toBeTruthy();
  const clientDir = join(DIST, 'client');
  expect(existsSync(clientDir), `Client output directory is missing: ${clientDir}`).toBeTruthy();

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
  const files = readdirSync(clientDir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => `${entry.parentPath}/${entry.name}`);
  let coreBytes = 0;
  const emittedShowcase: string[] = [];
  const oversizedIslands: string[] = [];
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    if (removedShowcaseChunks.some((prefix) => f.includes(prefix))) {
      emittedShowcase.push(f);
      continue;
    }
    const size = statSync(f).size;
    coreBytes += size;
    if (f.includes('island-') && size > SITE_BUDGET.islandKB * 1024) {
      oversizedIslands.push(`${f} (${(size / 1024).toFixed(1)}KB)`);
    }
  }
  const coreKB = coreBytes / 1024;
  expect(
    emittedShowcase,
    `Removed showcase islands must not be emitted by the production build: ${emittedShowcase.join(
      ', ',
    )}`,
  ).toEqual([]);
  // The one shared official-Site SLO (www/site-budget.ts) is enforced
  // here and by the build manifest; exceeding it fails instead of warning.
  expect(
    oversizedIslands,
    `Islands exceed the ${SITE_BUDGET.islandKB}KB island budget: ${oversizedIslands.join(', ')}`,
  ).toEqual([]);
  expect(
    coreKB <= SITE_BUDGET.totalJsKB,
    `Client island JS total ${coreKB.toFixed(
      1,
    )}KB exceeds the ${SITE_BUDGET.totalJsKB}KB Site budget`,
  ).toBeTruthy();
});

test('build output: the light-mode probe fixture stays out of the public Site (#1148)', () => {
  expect(existsSync(DIST), `Build output is missing: ${DIST}`).toBeTruthy();

  // The probe moved to tests/fixtures/site-light-probe; a re-introduced Site
  // route must fail loudly in every locale artifact and index.
  for (const path of [join(DIST, 'probe-light'), join(DIST, 'zh', 'probe-light')]) {
    expect(existsSync(path), `internal probe output must not ship: ${path}`).toEqual(false);
  }

  // Route manifests: every emitted island manifest records its route.
  const manifestDir = join(DIST, 'island-manifests');
  if (existsSync(manifestDir)) {
    for (const entry of readdirSync(manifestDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const manifest = JSON.parse(readFileSync(join(manifestDir, entry.name), 'utf8')) as {
        route?: string;
      };
      expect(
        manifest.route !== '/probe-light' && manifest.route !== '/zh/probe-light',
        `route manifest ${entry.name} still contains the internal probe`,
      ).toBeTruthy();
    }
  }

  const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
  expect(
    !sitemap.includes('/probe-light'),
    'sitemap must not list the internal probe',
  ).toBeTruthy();
});

test('build output: zh pages keep in-content links inside the zh tree (#1031)', () => {
  expect(existsSync(DIST), `Build output is missing: ${DIST}`).toBeTruthy();
  const zhDir = join(DIST, 'zh');
  expect(existsSync(zhDir), `zh build output is missing: ${zhDir}`).toBeTruthy();

  // Scope: the pages whose in-content links are authored in route components —
  // the blog index, the docs index, and every guide page. Blog post *bodies*
  // come from locale-shared markdown and are intentionally out of scope.
  const targets = [join(zhDir, 'blog', 'index.html'), join(zhDir, 'docs', 'index.html')];
  const guideDir = join(zhDir, 'guide');
  if (existsSync(guideDir)) {
    for (const entry of readdirSync(guideDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isDirectory() && entry.name.endsWith('.html')) {
        targets.push(`${entry.parentPath}/${entry.name}`);
      }
    }
  }

  // Matches absolute-path hrefs on anchor tags: <a ... href="/path" ...>
  const anchorRe = /<a\b[^>]*?\bhref="(\/[^"]*)"[^>]*>/g;
  const failures: string[] = [];
  for (const file of targets) {
    expect(existsSync(file), `Expected zh page is missing: ${file}`).toBeTruthy();
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(anchorRe)) {
      const [tag, href] = match;
      // Layout chrome links carry data-nav and are localized client-side by
      // open-layout (#816); only in-content links are asserted here.
      if (tag.includes('data-nav')) continue;
      // The locale switcher deliberately points at the *other* locale tree;
      // it must not carry data-nav or the client-side localization would
      // rewrite it back into the current locale.
      if (tag.includes('locale-switch')) continue;
      if (href === '/zh' || href.startsWith('/zh/')) continue;
      failures.push(`${file}: ${href}`);
    }
  }
  expect(
    failures,
    `zh pages must not contain unprefixed internal links:\n${failures.join('\n')}`,
  ).toEqual([]);
});
