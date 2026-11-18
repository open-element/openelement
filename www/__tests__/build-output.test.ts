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
import {
  type BrowserEntryGraphArtifact,
  EXECUTOR_ENTRY_RELATIVE_MODULES,
  executorEntryModuleIds,
  evaluateBrowserEntryGraphArtifact,
} from '../../packages/router/src/vite/internal/browser-entry-graph-artifact.ts';

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
    // dragon-live-gaze's sheet lives in client/assets/ — a hit means the
    // extraction path regressed and the sheet re-inlined into the chunk.
    ['dragon-enter', 'extracted dragon-live-gaze sheet'],
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

  // B2/#1544 — THE PROPERTY, stated directly. A page must not pay the element
  // runtime floor for code it cannot run:
  //
  //   1. the page floor (the client entry's whole STATIC closure, which every
  //      page downloads) must not carry the generic Part Program executor;
  //   2. a page whose island manifest carries no client-activatable island must
  //      not fetch the runtime at all — no modulepreload, no reference to the
  //      emitted chunk's filename.
  //
  // The old phrasing of this test — "the entry must have NO static edge to the
  // shared runtime chunk" — was only ever a PROXY for (1)+(2) on the shape that
  // existed when it was written (a class-lane island was present, so the entry
  // emitted a lazy runtime loader and therefore no static edge). It is retired:
  // on the all-generated-lane shape `clientEntryNeedsElementRuntime()` is false,
  // the lazy loader and its `element-services-*` import are gone, and the entry
  // installs the two document-level services from the executor-free
  // `@openelement/element/document-services` surface instead — which is a
  // STATIC import, and (because the #1544 chunk grouping puts every module under
  // the element package root in one chunk) necessarily reaches the shared
  // element-runtime chunk. Asserting the absence of that edge would now assert
  // the absence of the document services. The property below holds either way:
  // it is about what the page floor CONTAINS and what an island-free page
  // FETCHES, not about which import form wired it.
  //
  // Anti-vacuity: the executor half is judged from the build's own emitted
  // evidence (`.vite/oe-browser-entry-graph.json`, the same artifact the P1
  // checker `tools/repo/check-browser-entry-graph.ts` judges), and the
  // island-free-page half is measured over every emitted `.html`.
  const manifest = JSON.parse(
    readFileSync(join(DIST, 'client', '.vite', 'manifest.json'), 'utf8'),
  ) as Record<string, { imports?: string[]; dynamicImports?: string[] }>;
  const entry = manifest['virtual:open-client-entry'];
  if (!entry) throw new Error('client entry missing from the vite build manifest');
  const runtimeKey = `_${runtimeChunks[0]}`;
  expect(
    entry.imports ?? [],
    `B2: the shared element-runtime chunk (${runtimeKey}) must not be a direct static import of the client entry`,
  ).not.toContain(runtimeKey);
  // P1 (post-executor-split, all www islands on the generated lane): a build
  // with zero class-lane islands emits NO element-services dynamic edge at all
  // — the check-browser-entry-graph verdict (MET) is the authority for that
  // surface. When a class-lane island exists, the services surface must be a
  // lazy edge that statically imports the shared runtime chunk.
  const servicesKey = (entry.dynamicImports ?? []).find((key) => /element-services/.test(key));
  if (servicesKey !== undefined) {
    expect(
      manifest[servicesKey]?.imports ?? [],
      `The lazily imported element-services module must statically import the shared runtime chunk (${runtimeKey})`,
    ).toContain(runtimeKey);
  }

  // B2 gap (a): the DIRECT edge is not the property; the entry's whole STATIC
  // closure is. Vite homes its injected preload helper in whichever chunk first
  // needs it; www's `open-search` island carries a nested dynamic import, so the
  // helper once landed in that ISLAND chunk, the entry statically imported the
  // island chunk to reach the helper, and the runtime came back transitively —
  // with a direct-edge assertion still green. So walk the closure: over the vite
  // manifest's `imports` keys only (`dynamicImports` is a different field and is
  // deliberately not followed — that is how islands are reached).
  const staticClosure: string[] = [];
  const queue = [...(entry.imports ?? [])];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (staticClosure.includes(key)) continue;
    staticClosure.push(key);
    for (const next of manifest[key]?.imports ?? []) queue.push(next);
  }
  // Nor an island chunk: an island in the entry's static closure is the exact
  // shape that smuggles the runtime back in, and it is what the island chunk's
  // own runtime import means the moment one appears.
  const islandKeysInClosure = staticClosure.filter((key) => /^_island-/.test(key));
  expect(
    islandKeysInClosure,
    `B2 gap (a): no island chunk may sit in the client entry's static closure; found: ${islandKeysInClosure.join(', ')}`,
  ).toEqual([]);
  // Guard against a vacuous pass: the closure walk must actually have found
  // the one chunk the entry does import eagerly (the dedicated helper chunk).
  // An empty closure would mean the walk read nothing, not that the graph is
  // clean.
  const helperKeys = staticClosure.filter((key) => /^_vite-helper-/.test(key));
  expect(
    helperKeys,
    `The entry's static closure must carry the dedicated vite-helper chunk (the helper Vite injects for the ` +
      `entry's own dynamic island imports); closure: ${staticClosure.join(', ') || '(empty)'}`,
  ).toHaveLength(1);
  // And the helper chunk itself must not carry the runtime either — it is the
  // one eager import, so an edge from it would defeat the whole property.
  expect(
    manifest[helperKeys[0]]?.imports ?? [],
    `The dedicated vite-helper chunk must be a leaf: ${helperKeys[0]} imports something`,
  ).toEqual([]);

  // (a) EXECUTOR ABSENCE IN THE PAGE FLOOR — judged on the emitted evidence, not
  // on an import shape. `.vite/oe-browser-entry-graph.json` is written by the
  // same client build into the same directory as the manifest above, and it is
  // the ONE truth source for "does a production browser entry load the generic
  // executor": the P1 checker recomputes this predicate from raw chunk/module
  // facts. Chunk keys in the Vite manifest are not module ids, so the module-id
  // claim can only be made against this artifact.
  const graphPath = join(DIST, 'client', '.vite', 'oe-browser-entry-graph.json');
  expect(
    existsSync(graphPath),
    `B2 (a): the browser-entry graph artifact is missing (${graphPath}) — the client build must ` +
      `write it, or the page floor's executor absence is unproven`,
  ).toBeTruthy();
  const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as BrowserEntryGraphArtifact;
  // `status: 'incomplete'` is the writer saying it could not observe the whole
  // graph (unknown virtual ids, missing chunks); a verdict derived from it would
  // be a guess, so it is a failure here, not a pass.
  expect(
    graph.status,
    `B2 (a): the browser-entry graph artifact is not complete (status: ${String(graph.status)})`,
  ).toBe('complete');
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

  // (b) AN ISLAND-FREE PAGE MUST NOT FETCH THE RUNTIME. The build's own
  // projection owns which pages get the runtime preload: postprocess.ts
  // `injectElementRuntimePreload` emits exactly one
  // `<link rel="modulepreload" ... data-open-element-runtime-preload>` per page
  // whose island manifest is non-empty, and skips the rest.
  //
  // First half: the runtime chunk itself carries no executor entry module, so
  // nothing an island-free page would fetch is the executor.
  const executorIds = executorEntryModuleIds(graph.element.packageRoot);
  expect(
    executorIds.slice().sort(),
    "B2 (b): the executor-entry table must match the artifact's own (one revision, one claim)",
  ).toEqual(graph.predicate.executorEntry.slice().sort());
  const runtimeChunkFile = `islands/${runtimeChunks[0]}`;
  const runtimeChunk = graph.chunks.find((chunk) => chunk.file === runtimeChunkFile);
  expect(
    runtimeChunk,
    `B2 (b): the emitted runtime chunk ${runtimeChunkFile} is absent from the browser-entry graph artifact's chunk list`,
  ).toBeTruthy();
  const executorModulesInRuntime = runtimeChunk!.modules
    .map((module) => module.id)
    .filter((id) => executorIds.includes(id));
  expect(
    executorModulesInRuntime,
    `B2 (b): the shared element-runtime chunk must hold no executor entry module; found: ${executorModulesInRuntime.join(', ')}`,
  ).toEqual([]);
  // Anti-vacuity: an empty table would satisfy the filter above trivially.
  expect(
    EXECUTOR_ENTRY_RELATIVE_MODULES.length,
    'B2 (b): the executor-entry table is empty — the assertions above would be vacuous',
  ).toBeGreaterThan(0);

  // Second half: the projection's own partition, measured over the built dist.
  // A page that carries NO preload link is a page the build judged island-free;
  // its bytes must not name the runtime chunk's file. Measured on the current
  // build: 78 emitted pages, 78 carry the preload link, 0 do not (every www
  // page carries at least one client-activatable island host). The "no link"
  // bucket is therefore empty TODAY — the assertion is kept as a live guard: it
  // activates on its own the moment an island-free page is emitted, and it
  // cannot be satisfied by inventing one.
  const preloadAttribute = 'data-open-element-runtime-preload';
  const pages: string[] = [];
  const walkHtml = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walkHtml(path);
      else if (entry.name.endsWith('.html')) pages.push(path);
    }
  };
  walkHtml(DIST);
  expect(
    pages.length,
    `B2 (b): no emitted .html under ${DIST} — nothing was measured`,
  ).toBeGreaterThan(0);
  const pagesWithPreload: string[] = [];
  const islandFreePagesThatFetchRuntime: string[] = [];
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    if (html.includes(preloadAttribute)) {
      pagesWithPreload.push(page);
      continue;
    }
    if (html.includes(runtimeChunks[0]!)) islandFreePagesThatFetchRuntime.push(page);
  }
  // Report the partition so a reader can see what was measured: today 78 of 78
  // pages carry the link and 0 do not, so the island-free bucket is EMPTY and
  // the assertion below is a live guard rather than a currently-exercised
  // branch. The counts ride every failure message.
  const pagesWithoutPreload = pages.length - pagesWithPreload.length;
  // Anti-vacuity, and the one guard that keeps the empty bucket honest: if the
  // projection's marker spelling ever changes, EVERY page lands in the "without"
  // bucket and the island-free assertion would pass while measuring nothing. At
  // least one page must be seen carrying the link, which proves the marker is
  // what the build actually writes.
  expect(
    pagesWithPreload.length,
    `B2 (b): no emitted page carries the ${preloadAttribute} link — the marker the assertion ` +
      `partitions on was not detected on any of ${pages.length} pages, so the island-free check ` +
      `would be measuring nothing`,
  ).toBeGreaterThan(0);
  expect(
    islandFreePagesThatFetchRuntime,
    `B2 (b): pages with no client-activatable island must not reference the runtime chunk ` +
      `(${runtimeChunks[0]}); found ${pagesWithPreload.length} pages with the preload link and ` +
      `${pagesWithoutPreload} without, of which the following still fetch it: ` +
      `${islandFreePagesThatFetchRuntime.map((page) => page.slice(DIST.length + 1)).join(', ')}`,
  ).toEqual([]);
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
