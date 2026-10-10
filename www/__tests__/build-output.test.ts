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
import { PAGEFIND_UI_SUITE_FILES } from '../build-pagefind.ts';
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

test('build output: artifact scan — no vendored highlighter, no CDN font references, no CSS text in island chunks', () => {
  expect(existsSync(DIST), `Build output is missing: ${DIST}`).toBeTruthy();
  // The dist-level closeout scan for the retirement/protocol lanes:
  //   #1552 — the vendored Prism runtime is gone (pages, pagefind sibling
  //     guard above): no vendor/prism tree and no prism-named file may ship.
  //   H lane (supersedes #1554) — fonts are self-hosted from the fontsource
  //     npm packages (www/site-fonts.ts) through the linked style bundle:
  //     woff2 binaries ship under assets/ by design, but no artifact may
  //     reference the retired jsDelivr CDN, and no woff2 may sit outside the
  //     emitted assets tree (which is where the preset ships url() assets).
  //   #1553/ADR-0164 — component stylesheets emit as client/assets/*.css and
  //     are adopted via the shared runtime; the markers below are the
  //     regression forms of a re-inlined sheet or a second writer on the
  //     static-styles channel. The @openelement/ui package islands (badge,
  //     button, code-block, theme-toggle) intentionally ride the legacy
  //     inline path (ADR-0164 transition note), so generic :host text is NOT
  //     a violation here — only the specific markers are.
  const violations: string[] = [];
  const fontReferences = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const rel = path.slice(DIST.length + 1);
      if (rel.includes('vendor/prism') || /^prism(-|\b|\.)/.test(entry.name)) {
        violations.push(`vendored Prism artifact: ${rel}`);
      }
      if (entry.name.endsWith('.woff2')) {
        const asset = `assets/${entry.name}`;
        if (!rel.startsWith('assets/')) {
          violations.push(`font binary outside the emitted assets tree: ${rel}`);
        }
        fontReferences.add(asset);
      }
      if (/\.(?:html|css|js|json|xml|txt|webmanifest)$/.test(entry.name)) {
        const text = readFileSync(path, 'utf8');
        // Host-boundary anchored: a shipped artifact violates only when it
        // references the CDN as a URL host (scheme or protocol-relative) —
        // a bare substring test is both over- and under-specific and is the
        // incomplete-sanitization shape code scanning flags.
        if (/(?:https?:)?\/\/cdn\.jsdelivr\.net(?:[/?:#]|$)/.test(text)) {
          violations.push(`jsDelivr reference in shipped artifact: ${rel}`);
        }
      }
    }
  };
  walk(DIST);

  // The self-hosted contract (H lane): the face binaries ship, and the
  // linked style bundle is what references them. A build that drops the
  // preset font sources (or rewrites their url() targets wrongly) fails here
  // instead of delivering fallback glyphs.
  expect(
    fontReferences.size,
    'no woff2 faces shipped under dist/assets — the self-hosted font sources ' +
      'did not reach the emitted style bundle',
  ).toBeGreaterThan(0);
  const bundlePath = join(DIST, 'assets', 'open-tailwind.css');
  expect(existsSync(bundlePath), `linked style bundle is missing: ${bundlePath}`).toBeTruthy();
  const bundle = readFileSync(bundlePath, 'utf8');
  for (const asset of fontReferences) {
    expect(
      bundle.includes(asset.slice('assets/'.length)),
      `shipped face ${asset} is not referenced by ${bundlePath}`,
    ).toBe(true);
  }
  expect(bundle.includes('@font-face'), 'the linked bundle carries no @font-face rule').toBe(true);

  const islandsDir = join(DIST, 'client', 'islands');
  const cssTextMarkers: Array<[string, string]> = [
    // dragon-live-gaze's sheet lives in client/assets/ — a hit means the
    // extraction path regressed and the sheet re-inlined into the chunk.
    ['dragon-enter', 'extracted dragon-live-gaze sheet'],
    // The DSD static-styles marker is the server serializer's write and the
    // runtime's claim channel; an island copy would be a second writer.
    ['data-oe-static-styles', 'static-styles channel'],
  ];
  for (const file of readdirSync(islandsDir)) {
    if (!file.startsWith('island-') || !file.endsWith('.js')) continue;
    const code = readFileSync(join(islandsDir, file), 'utf8');
    for (const [marker, why] of cssTextMarkers) {
      if (code.includes(marker)) {
        violations.push(`island ${file} carries ${why} (${JSON.stringify(marker)})`);
      }
    }
  }

  expect(violations, 'artifact scan violations').toEqual([]);
});

test('build output: pagefind ships the core runtime and no UI suites (#1555)', () => {
  expect(existsSync(DIST), `Build output is missing: ${DIST}`).toBeTruthy();
  const pagefindDir = join(DIST, 'pagefind');
  expect(existsSync(pagefindDir), `Pagefind output is missing: ${pagefindDir}`).toBeTruthy();

  // The search island loads only /pagefind/pagefind.js; that entry plus its
  // worker and the entry manifest are the artifacts the runtime fetches. The
  // three UI bundles the pagefind service also copies are dead weight and
  // must be filtered by the build (www/build-pagefind.ts).
  const emitted = readdirSync(pagefindDir);
  for (const required of ['pagefind.js', 'pagefind-worker.js', 'pagefind-entry.json']) {
    expect(
      emitted.includes(required),
      `Pagefind core runtime artifact is missing: ${required}`,
    ).toBeTruthy();
  }
  const uiSuites = emitted.filter((f) =>
    (PAGEFIND_UI_SUITE_FILES as readonly string[]).includes(f),
  );
  expect(
    uiSuites,
    `Pagefind UI suites must not ship (the runtime never loads them): ${uiSuites.join(', ')}`,
  ).toEqual([]);
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

test('build output: pages ship exactly two eager scripts — theme-init and the island client (#1552)', () => {
  expect(existsSync(DIST), `Build output is missing: ${DIST}`).toBeTruthy();
  // The #1552 retirement removed the vendored Prism runtime and its init
  // fallback: highlighting compiles into the page HTML at build time, so the
  // executable eager-script set must be exactly theme-init.js (sync, anti
  // -flash) + client.js (the island loader). speculationrules / ld+json are
  // data blocks, not executed scripts, and pagefind loads lazily on search.
  const eagerScripts = /<script\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/g;
  for (const page of [
    join(DIST, 'index.html'),
    join(DIST, 'zh', 'guide', 'getting-started', 'index.html'),
    join(DIST, 'changelog', 'index.html'),
  ]) {
    expect(existsSync(page), `Page not built: ${page}`).toBeTruthy();
    const html = readFileSync(page, 'utf8');
    const srcs = [...html.matchAll(eagerScripts)].map((m) => m[2]!.split('/').pop());
    expect(srcs.sort(), `eager scripts on ${page}`).toEqual(['client.js', 'theme-init.js']);
    expect(html.includes('/assets/vendor/'), `vendored runtime scripts on ${page}`).toBeFalsy();
  }
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

test('build output: the element runtime ships as the one shared chunk islands never embed (#1544)', () => {
  expect(existsSync(DIST), `Build output is missing: ${DIST}`).toBeTruthy();
  const islandsDir = join(DIST, 'client', 'islands');
  expect(existsSync(islandsDir), `Client islands directory is missing: ${islandsDir}`).toBeTruthy();

  // Exactly one shared element-runtime chunk — the layout the client build's
  // grouping identity enforces (router vite/internal/element-runtime-chunk.ts).
  const runtimeChunks = readdirSync(islandsDir).filter((f) => /^element-runtime-.+\.js$/.test(f));
  expect(
    runtimeChunks,
    `Expected exactly one shared element-runtime chunk, got: ${runtimeChunks.join(', ') || 'none'}`,
  ).toHaveLength(1);

  // Island chunks must not embed the runtime: the runtime's DSD style
  // contract attribute (element's open-element-styles.ts) may only appear in
  // the shared chunk — a hit inside an island chunk means per-island runtime
  // copies shipped.
  const runtimeMarker = 'data-open-element-compiled-style';
  const islandsEmbeddingRuntime = readdirSync(islandsDir)
    .filter((f) => f.startsWith('island-') && f.endsWith('.js'))
    .filter((f) => readFileSync(join(islandsDir, f), 'utf8').includes(runtimeMarker));
  expect(
    islandsEmbeddingRuntime,
    `Island chunks must not embed the element runtime: ${islandsEmbeddingRuntime.join(', ')}`,
  ).toEqual([]);

  // The generated client entry statically imports the shared chunk (the
  // import edge is recorded in the vite build manifest).
  const manifest = JSON.parse(
    readFileSync(join(DIST, 'client', '.vite', 'manifest.json'), 'utf8'),
  ) as Record<string, { imports?: string[] }>;
  const entry = manifest['virtual:open-client-entry'];
  if (!entry) throw new Error('client entry missing from the vite build manifest');
  const runtimeKey = `_${runtimeChunks[0]}`;
  expect(
    entry.imports ?? [],
    `The client entry must statically import the shared element-runtime chunk (${runtimeKey})`,
  ).toContain(runtimeKey);
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
