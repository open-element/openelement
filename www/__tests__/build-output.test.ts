/**
 * Build output assertions — runs against www/dist after a production build.
 * These tests validate that build artifacts meet security and size constraints.
 *
 * Run: pnpm --dir www run test (the vitest www project)
 * (must run after `pnpm run site:build`)
 */
import { expect, test } from 'vitest';

import { join } from 'node:path';
import { installCommand } from '../app/data/_generated-install-command.ts';
import { SITE_BUDGET } from '../site-budget.ts';
import { PAGEFIND_UI_SUITE_FILES } from '../build-pagefind.ts';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import {
  type BrowserEntryGraphArtifact,
  EXECUTOR_ENTRY_RELATIVE_MODULES,
  executorEntryModuleIds,
  evaluateBrowserEntryGraphArtifact,
} from '../../packages/router/src/vite/internal/browser-entry-graph-artifact.ts';
import { walkHtmlFileEntries } from '../../packages/router/src/vite/internal/html-files.ts';
import {
  type PageIslandManifest,
  routeFromRelativePath,
} from '../../packages/router/src/vite/internal/ssg/island-manifest.ts';
import { checkPublishOutput } from '../../packages/router/src/vite/internal/publish-manifest.ts';

const DIST = join(import.meta.dirname ?? '.', '..', 'dist');

test('build output: both homepages ship readable code and the canonical install command', () => {
  for (const route of ['index.html', 'zh/index.html']) {
    const html = readFileSync(join(DIST, route), 'utf8');
    expect(html).toContain(`<code id="home-install-command">${installCommand}</code>`);
    expect(html).toContain('open-counter.tsx');
    // The hero sample is compiled by the site's one Shiki pipeline: fenced-code
    // bytes (`class="shiki css-variables"` plus inline --shiki-* token vars),
    // not escaped plain text.
    expect(html).toContain('class="shiki css-variables"');
    expect(html).toMatch(/--shiki-token-/);
    expect(html).toMatch(/<open-counter [^>]*><template shadowrootmode="open"/);
  }
});

test.each([
  ['getting-started', 'Getting Started', '#install', '#before-you-start'],
  ['tutorial', 'Tutorial: Your First App', '#before-you-start', '#install'],
])('build output: guide/%s renders its own heading and outline', (slug, title, href, otherHref) => {
  const html = readFileSync(join(DIST, 'guide', slug, 'index.html'), 'utf8');
  expect(html).toContain(`<title>${title} — openElement</title>`);
  expect(html.match(/<h1\b[\s\S]*?<\/h1>/)?.[0]).toContain(title);
  const rail = html.match(/<open-page-rail\b[\s\S]*?<\/open-page-rail>/)?.[0];
  expect(rail).toContain(`href="${href}"`);
  expect(rail).not.toContain(`href="${otherHref}"`);
});

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
        // The client build emits the stylesheet's url() assets into
        // dist/client/assets/ (the document stylesheet lives there); a face
        // anywhere else is a stray binary.
        if (!rel.startsWith('assets/') && !rel.startsWith('client/assets/')) {
          violations.push(`font binary outside the emitted assets tree: ${rel}`);
        }
        fontReferences.add(entry.name);
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

  // The self-hosted contract (H lane): the face binaries ship, and an emitted
  // client stylesheet references them. A build that drops the font sources
  // (or rewrites their url() targets wrongly) fails here instead of delivering
  // fallback glyphs. Two stylesheet owners exist: the document bundle the
  // emitted head links, and the component sheets the Tailwind compile emits
  // into client/assets/ (a component sheet must address its referenced bytes
  // itself). A face below Vite's inline limit is a data URL in the document
  // bundle and has NO document-side asset — its shipped file belongs to the
  // component sheet — so a shipped face must be referenced by one of the
  // emitted stylesheets, not necessarily the bundle.
  expect(
    fontReferences.size,
    'no woff2 faces shipped under dist — the self-hosted font sources ' +
      'did not reach the emitted style bundle',
  ).toBeGreaterThan(0);
  const homeHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
  const stylesheetHref = homeHtml.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  expect(stylesheetHref, 'the built head links a stylesheet').toBeTruthy();
  const bundlePath = join(DIST, stylesheetHref!.replace(/^\//, ''));
  expect(existsSync(bundlePath), `linked style bundle is missing: ${bundlePath}`).toBeTruthy();
  const bundle = readFileSync(bundlePath, 'utf8');
  const emittedSheets = [bundle];
  for (const file of readdirSync(join(DIST, 'client', 'assets'))) {
    if (file.endsWith('.css')) {
      emittedSheets.push(readFileSync(join(DIST, 'client', 'assets', file), 'utf8'));
    }
  }
  for (const face of fontReferences) {
    expect(
      emittedSheets.some((sheet) => sheet.includes(face)),
      `shipped face ${face} is not referenced by any emitted stylesheet ` +
        `(${bundlePath} or an emitted component sheet)`,
    ).toBe(true);
  }
  // The document side still delivers self-hosted faces by name (not only
  // inlined data URLs): the document stylesheet owns the document entry's
  // @font-face rules.
  expect(
    [...fontReferences].some((face) => bundle.includes(face)),
    `the linked bundle ${bundlePath} references no shipped face by name`,
  ).toBe(true);
  expect(bundle.includes('@font-face'), 'the linked bundle carries no @font-face rule').toBe(true);

  const islandsDir = join(DIST, 'client', 'islands');
  const cssTextMarkers: Array<[string, string]> = [
    // The DSD static-styles marker is the server serializer's write; an island
    // copy would be a second writer. A styled generated shadow island's CLAIM
    // legitimately READS the marked prefix it skips (`hasAttribute(...)`), so
    // only the write spelling counts.
    ['data-oe-static-styles', 'static-styles channel'],
  ];
  for (const file of readdirSync(islandsDir)) {
    if (!file.startsWith('island-') || !file.endsWith('.js')) continue;
    const code = readFileSync(join(islandsDir, file), 'utf8');
    const withoutClaimReader = code
      .replaceAll('hasAttribute(`data-oe-static-styles`)', '')
      .replaceAll('hasAttribute("data-oe-static-styles")', '')
      .replaceAll("hasAttribute('data-oe-static-styles')", '');
    for (const [marker, why] of cssTextMarkers) {
      if (withoutClaimReader.includes(marker)) {
        violations.push(`island ${file} carries ${why} (${JSON.stringify(marker)})`);
      }
    }
  }

  expect(violations, 'artifact scan violations').toEqual([]);
});

test('build output: static publication includes redirects, robots directives, and a sitemap', () => {
  for (const file of ['_redirects', 'robots.txt', 'sitemap.xml']) {
    expect(statSync(join(DIST, file)).size, `${file} is missing or empty`).toBeGreaterThan(0);
  }
  expect(existsSync(join(DIST, 'server'))).toBe(false);
});

test('build output: the public snapshot includes Pagefind and the final Site metadata', () => {
  expect(existsSync(DIST), `Build output is missing: ${DIST}`).toBeTruthy();
  const pagefindDir = join(DIST, 'pagefind');
  expect(existsSync(pagefindDir), `Pagefind output is missing: ${pagefindDir}`).toBeTruthy();
  const { files } = checkPublishOutput(DIST);
  for (const path of ['_redirects', 'robots.txt', 'sitemap.xml']) {
    expect(files.has(path), `Public snapshot is missing ${path}`).toBeTruthy();
  }

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
    expect(files.has(`pagefind/${required}`)).toBeTruthy();
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

test('build output: island runtime is shared and preloaded only by pages that reach it (#1544)', () => {
  const graphPath = join(DIST, 'client', '.vite', 'oe-browser-entry-graph.json');
  const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as BrowserEntryGraphArtifact;
  expect(graph.status, 'The emitted client graph must be complete').toBe('complete');
  expect(graph.islands.map(({ tag }) => tag).sort()).toEqual([
    'open-button',
    'open-code-block',
    'open-copy-button',
    'open-counter',
    'open-layer-strip',
    'open-page-rail',
    'open-registry-lookup',
    'open-search',
    'open-site-menu',
    'open-source-toggle',
    'open-theme-toggle',
  ]);
  expect(
    graph.predicate.loadedViolations,
    `B2 (a): the page floor loads executor entry modules: ${graph.predicate.loadedViolations
      .map((violation) => `${violation.moduleId} (chunk ${violation.chunkFile})`)
      .join(', ')}`,
  ).toEqual([]);
  // The bundled evaluator recomputes that predicate from the chunk/module facts
  // instead of trusting the writer's summary — the same recomputation the P1
  // checker runs, so a forger-of-summaries (or a writer bug) reds here too.
  expect(
    evaluateBrowserEntryGraphArtifact(graph).verdict,
    'B2 (a): the recomputed browser-entry graph verdict must be MET (no executor entry loaded)',
  ).toBe('MET');

  const executorIds = executorEntryModuleIds(graph.element.packageRoot);
  expect(
    EXECUTOR_ENTRY_RELATIVE_MODULES.length,
    'The executor denylist must be non-empty',
  ).toBeGreaterThan(0);
  expect(executorIds.slice().sort()).toEqual(graph.predicate.executorEntry.slice().sort());

  const chunksByFile = new Map(graph.chunks.map((chunk) => [chunk.file, chunk]));
  const staticClosure = (roots: readonly string[]): Set<string> => {
    const pending = [...roots];
    const reached = new Set<string>();
    for (const file of pending) {
      if (reached.has(file)) continue;
      const chunk = chunksByFile.get(file);
      if (chunk === undefined) throw new Error(`Missing emitted client chunk ${file}`);
      reached.add(file);
      pending.push(...chunk.imports);
    }
    return reached;
  };

  const eagerFiles = staticClosure([graph.entry.chunkFile]);
  const islandFiles = new Set(graph.islands.map((island) => island.chunkFile));
  expect([...islandFiles].filter((file) => eagerFiles.has(file))).toEqual([]);
  const eagerHelpers = graph.chunks.filter(
    (chunk) =>
      eagerFiles.has(chunk.file) &&
      chunk.modules.some(
        ({ id, renderedLength }) => id === '\0vite/preload-helper.js' && renderedLength > 0,
      ),
  );
  expect(eagerHelpers, 'The entry eagerly loads one Vite preload helper chunk').toHaveLength(1);
  expect(eagerHelpers[0]!.imports, 'The eager helper chunk is a leaf').toEqual([]);

  const elementRoot = graph.element.packageRoot;
  // These document services install before any island upgrades, so they may
  // live in the eager closure along with Vite's helper.
  const documentServiceIds = new Set(
    [
      'src/document-services.ts',
      'src/internal/core/deep-fragment.ts',
      'src/internal/compiled/runtime/pre-upgrade-events.ts',
      'src/internal/compiled/runtime/pre-upgrade-replay-hook.ts',
    ].map((file) => `${elementRoot}/${file}`),
  );
  const runtimeFiles = new Set<string>();
  const moduleOwners = new Map<string, string>();
  for (const chunk of graph.chunks) {
    for (const { id, renderedLength } of chunk.modules) {
      if (renderedLength === 0 || !id.startsWith(`${elementRoot}/`) || documentServiceIds.has(id)) {
        continue;
      }
      expect(moduleOwners.has(id), `${id} already emitted in ${moduleOwners.get(id)}`).toBe(false);
      moduleOwners.set(id, chunk.file);
      runtimeFiles.add(chunk.file);
    }
  }
  expect(
    moduleOwners.has(`${elementRoot}/src/open-element-styles.ts`),
    'The shared styles runtime must be measured',
  ).toBe(true);
  expect([...runtimeFiles].filter((file) => eagerFiles.has(file) || islandFiles.has(file))).toEqual(
    [],
  );
  for (const file of runtimeFiles) {
    const executorModules = chunksByFile
      .get(file)!
      .modules.map(({ id }) => id)
      .filter((id) => executorIds.includes(id));
    expect(executorModules, `Executor modules in runtime chunk ${file}`).toEqual([]);
  }

  // Match preloads to islands due at page load or the first idle turn.
  // Redirects written after the Router build have no island manifest.
  const manifestsDir = join(DIST, 'island-manifests');
  const manifests = readdirSync(manifestsDir)
    .filter((file) => file.endsWith('.json'))
    .map(
      (file) => JSON.parse(readFileSync(join(manifestsDir, file), 'utf8')) as PageIslandManifest,
    );
  const islandsByRoute = new Map(manifests.map(({ route, islands }) => [route, islands]));
  const assetPrefix = `${graph.app.base}client/`;
  const runtimeFilenames = [...runtimeFiles].map((file) => file.slice(file.lastIndexOf('/') + 1));
  const preloadMarker = 'data-open-element-runtime-preload';
  const failures: string[] = [];
  let pagesWithPreload = 0;
  for (const page of walkHtmlFileEntries(DIST)) {
    const route = routeFromRelativePath(page.relativePath);
    const islands = islandsByRoute.get(route) ?? [];
    const islandRoots = islands
      .filter(({ strategy }) => strategy === 'load' || strategy === 'only' || strategy === 'idle')
      .map(({ chunkUrl }) => {
        expect(chunkUrl.startsWith(assetPrefix), `Island asset ${chunkUrl} on ${route}`).toBe(true);
        return chunkUrl.slice(assetPrefix.length);
      });
    const expected = [...staticClosure(islandRoots)]
      .filter((file) => runtimeFiles.has(file))
      .map((file) => assetPrefix + file)
      .sort();
    const html = readFileSync(page.absolutePath, 'utf8');
    const actual = [...html.matchAll(/<link\b[^>]*>/g)]
      .map(([tag]) => tag)
      .filter((tag) => tag.includes(preloadMarker))
      .map((tag) => {
        expect(tag, `Runtime preload on ${route}`).toContain('rel="modulepreload"');
        return tag.match(/\bhref="([^"]+)"/)?.[1];
      })
      .sort();
    expect(actual, `Runtime preloads on ${route}`).toEqual(expected);
    if (actual.length > 0) pagesWithPreload++;
    if (expected.length === 0 && runtimeFilenames.some((file) => html.includes(file))) {
      failures.push(route);
    }
  }
  expect(
    pagesWithPreload,
    'At least one built page must exercise runtime preloading',
  ).toBeGreaterThan(0);
  expect(
    failures,
    'Pages without runtime dependencies must not reference island runtime files',
  ).toEqual([]);
});

test('build output: zh pages keep in-content links inside the zh tree (#1031)', () => {
  expect(existsSync(DIST), `Build output is missing: ${DIST}`).toBeTruthy();
  const zhDir = join(DIST, 'zh');
  expect(existsSync(zhDir), `zh build output is missing: ${zhDir}`).toBeTruthy();

  // Scope: the pages whose in-content links are authored in route components —
  // the release status, docs index and every guide page.
  const targets = [join(zhDir, 'changelog', 'index.html'), join(zhDir, 'docs', 'index.html')];
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
      // The locale switcher deliberately points at the *other* locale tree,
      // so it is the one layout anchor exempt from this rule. It marks itself
      // with data-locale-switch rather than a presentation class, which the
      // utility-first migration removed (the visual vocabulary is the class
      // list; the behaviour hook stays an attribute).
      if (tag.includes('data-locale-switch')) continue;
      if (href === '/zh' || href.startsWith('/zh/')) continue;
      failures.push(`${file}: ${href}`);
    }
  }
  expect(
    failures,
    `zh pages must not contain unprefixed internal links:\n${failures.join('\n')}`,
  ).toEqual([]);
});
