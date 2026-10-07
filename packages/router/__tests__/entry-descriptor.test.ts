/**
 * @openelement/router - Entry descriptor + renderer tests
 *
 * Tests the two-step entry pipeline:
 *   1. buildEntryDescriptor - produces structured data
 *   2. renderEntry - renders data to code string
 */

import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import type { RouteEntry } from '@openelement/protocol/framework';

// Test fixtures

const sampleRoutes: RouteEntry[] = [
  { path: '/', filePath: 'index.ts', type: 'page', varName: 'pageIndex' },
  { path: '/about', filePath: 'about.ts', type: 'page', varName: 'pageAbout' },
  { path: '/api/hello', filePath: 'api/hello.ts', type: 'api', varName: 'apiHello' },
];

const islandRoutes: RouteEntry[] = [
  { path: '/', filePath: 'index.ts', type: 'page', varName: 'pageIndex' },
];

// buildEntryDescriptor tests

test('buildEntryDescriptor: default options produce correct structure', () => {
  const desc = buildEntryDescriptor(sampleRoutes);

  expect(desc.isSSG).toEqual(false);
  expect(desc.apiRoutes.length).toEqual(1);
  expect(desc.pageRoutes.length).toEqual(2);
  expect(desc.middleware.length).toEqual(4); // requestId, logger, cors, securityHeaders
  expect(desc.document.lang).toEqual('en');
  expect(desc.document.title).toEqual('openElement');
  expect(desc.document.headExtras).toEqual('');
});

test('buildEntryDescriptor: SSG mode sets isSSG', () => {
  const desc = buildEntryDescriptor(sampleRoutes, { ssg: true });

  expect(desc.isSSG).toEqual(true);
});

test('buildEntryDescriptor: middleware can be disabled', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    middleware: { cors: false, requestId: false },
  });

  const kinds = desc.middleware.map((m) => m.kind);
  expect(kinds.includes('cors')).toEqual(false);
  expect(kinds.includes('requestId')).toEqual(false);
  expect(kinds.includes('logger')).toEqual(true);
  expect(kinds.includes('securityHeaders')).toEqual(true);
});

test('buildEntryDescriptor: custom CORS origin is serialized', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    middleware: { corsOrigin: 'https://example.com' },
  });

  const corsMw = desc.middleware.find((m) => m.kind === 'cors');
  expect(corsMw?.config?.corsOrigin).toEqual('https://example.com');
});

test('buildEntryDescriptor: array CORS origin is preserved', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    middleware: { corsOrigin: ['https://a.com', 'https://b.com'] },
  });

  const corsMw = desc.middleware.find((m) => m.kind === 'cors');
  expect(corsMw?.config?.corsOrigin).toEqual(['https://a.com', 'https://b.com']);
});

test('buildEntryDescriptor: function CORS origin fails with a migration error (Alpha.1)', () => {
  const originFn = (origin: string) => (origin.endsWith('.example.com') ? origin : '');
  assertThrowsIncludes(
    () =>
      buildEntryDescriptor(sampleRoutes, {
        middleware: { corsOrigin: originFn as never },
      }),
    Error,
    'middleware.corsOrigin no longer accepts a function',
  );
});

test('buildEntryDescriptor: corsOriginModule is carried as an import path', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    middleware: { corsOriginModule: './app/cors-origin.ts' },
  });

  const corsMw = desc.middleware.find((m) => m.kind === 'cors');
  expect(corsMw?.config?.corsOrigin).toEqual(undefined);
  expect(corsMw?.config?.corsOriginModule).toEqual('/app/cors-origin.ts');
});

test('buildEntryDescriptor: corsOrigin and corsOriginModule are mutually exclusive', () => {
  assertThrowsIncludes(
    () =>
      buildEntryDescriptor(sampleRoutes, {
        middleware: {
          corsOrigin: 'https://example.com',
          corsOriginModule: './app/cors-origin.ts',
        },
      }),
    Error,
    'mutually exclusive',
  );
});

test('buildEntryDescriptor: custom html config is applied', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    html: { lang: 'zh-CN', title: 'My App' },
    headExtras: '<link rel="stylesheet" href="https://cdn.example.com/styles.css" />',
  });

  expect(desc.document.lang).toEqual('zh-CN');
  expect(desc.document.title).toEqual('My App');
  expect(desc.document.headExtras).toContain('cdn.example.com');
});

test('buildEntryDescriptor: islands are mapped correctly', () => {
  const desc = buildEntryDescriptor(islandRoutes, {
    islandTagNames: ['my-counter', 'theme-toggle'],
    islandsDir: 'app/islands',
  });

  expect(desc.islands.length).toEqual(2);
  expect(desc.islands[0].tagName).toEqual('my-counter');
  expect(desc.islands[0].modulePath).toEqual('/app/islands/my-counter.ts');
  expect(desc.islands[1].tagName).toEqual('theme-toggle');
});

test('buildEntryDescriptor: route import paths include routesDir', () => {
  const desc = buildEntryDescriptor(sampleRoutes, { routesDir: 'app/routes' });

  expect(desc.apiRoutes[0].importPath).toEqual('/app/routes/api/hello.ts');
  expect(desc.pageRoutes[0].importPath).toEqual('/app/routes/index.ts');
});

test('buildEntryDescriptor: static components are explicit and rendered into the SSR entry', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    staticComponents: [
      {
        tagName: 'open-article-view',
        modulePath: '/app/components/article.tsx',
        compilerInteractionEvents: [],
      },
    ],
  });
  const code = renderEntry(desc);

  expect(desc.staticComponents).toEqual([
    {
      tagName: 'open-article-view',
      modulePath: '/app/components/article.tsx',
      compilerInteractionEvents: [],
    },
  ]);
  expect(code).toContain('import * as __static_component_0 from "/app/components/article.tsx"');
  expect(code).toContain(
    '__registerSsrComponent("open-article-view", __static_component_0.default)',
  );
  // The admitted-tag list is serialized build data inside the factory config
  // (#1470 block e — no standalone const anymore).
  expect(code).toContain('"open-article-view"');
  expect(code).toContain('ssrRenderableTags: [');
  expect(code.includes('__expandNestedHosts')).toEqual(false);
  expect(code.includes('__nestedShellPattern')).toEqual(false);
  expect(code.includes('__propsFromAttrs')).toEqual(false);
  expect(code.includes('__projectLightChildren')).toEqual(false);
  expect(code).toContain('"open-article-view"');
});

test('buildEntryDescriptor: compiler-proven interaction becomes one client admission input', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    upgradeStrategy: 'visible',
    staticComponents: [
      {
        tagName: 'open-menu-button',
        modulePath: '/app/components/menu-button.tsx',
        compilerInteractionEvents: ['click', 'keydown'],
      },
    ],
  });
  const code = renderEntry(desc);

  expect(desc.staticComponents).toEqual([]);
  expect(desc.islands).toEqual([
    {
      tagName: 'open-menu-button',
      modulePath: '/app/components/menu-button.tsx',
      hydrate: 'visible',
      ssr: true,
      dsd: true,
      authoring: 'basic-element',
      source: 'nested',
      reason: 'compiler-proven interaction events: click, keydown',
    },
  ]);
  expect(desc.ssrAdmissionPlan.renderableTags).toEqual(['open-menu-button']);
  expect(code).toContain('import * as __island_open_menu_button');
  expect(code).toContain('"open-menu-button"');
  expect(code.includes('__static_component_0')).toEqual(false);
});

// renderEntry tests

test('renderEntry: produces valid module code', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  const code = renderEntry(desc);

  // ADR-0160 rule a (#1470 block e): the Hono app is the factory's — the
  // entry carries no Hono import and no `new Hono()` assembly.
  expect(code.includes("from 'hono'")).toBeFalsy();
  expect(code.includes('new Hono()')).toBeFalsy();
  expect(code).toContain('const __app = createGeneratedApp({');
  // v0.44 (ADR-0143): the sync compiled renderDsd is the only serializer
  // import — the legacy VNode tree renderer is gone.
  expect(code).toContain(
    "import { createDeferredDsdExecutor, renderDsd, trustedHtml, escapeHtml, wrapInDocument } from '@openelement/element'",
  );
  expect(code.includes('renderDsdTree')).toEqual(false);
  expect(code).toContain('export default app');
});

test('renderEntry: SSG mode excludes DOM shim (DSD renderer has no shim dependency)', () => {
  const desc = buildEntryDescriptor(sampleRoutes, { ssg: true });
  const code = renderEntry(desc);

  // v0.5.0: DSD renderer doesn't need DOM shim - no @lit-labs/ssr dependency
  expect(code.includes('install-global-dom-shim')).toEqual(false);
});

test('renderEntry: SSG mode omits /__kiss debug endpoint', () => {
  const desc = buildEntryDescriptor(sampleRoutes, { ssg: true });
  const code = renderEntry(desc);

  expect(code.includes('/__kiss')).toEqual(false);
});

test('renderEntry: dev mode omits the /__kiss debug endpoint', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  const code = renderEntry(desc);

  // Debug endpoint was removed in Phase 4A audit (security: leaked route info).
  // Generated code must NOT contain /__kiss.
  expect(code.includes('/__kiss')).toEqual(false);
});

test('renderEntry: API routes mount as functions or method-keyed WinterCG records', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  const code = renderEntry(desc);

  // API routes accept (ctx) => Response functions and method-keyed handler
  // records joined into the shared route middleware.
  expect(code).toContain('app.all("/api/hello"');
  expect(code).toContain(
    '__apiRouteRecords.push({ id: "api/hello.ts", path: "/api/hello", handlers: $apiHello.default })',
  );
  expect(code).toContain('request: c.req.raw');
  expect(code).toContain('$apiHello');
});

test('renderEntry: page routes use SSR helper and wrapInDocument', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  const code = renderEntry(desc);

  expect(code).toContain('__pageHandlers["/"].GET = [');
  // v0.5.0: __ssr takes route params as second arg for SSR-time data access —
  // the renderer seam is imported runtime (ADR-0160 rule a); the handler call
  // site stays pinned and the native factory binding lives in
  // createGeneratedApp (#1470 block e).
  expect(code).toContain('__ssr(__tag,');
  expect(code).toContain('ssr: __ssr,');
  // The WinterCG route middleware hands params to the handler directly.
  expect(code).toContain('__params = __route.params');
  // v0.3.4: SSR automatically registers page components for Shadow DOM rendering
  // (#952/#1339/#1470 block e: registration runs through the imported registry
  // guard — the wrapper and its registry reads are typed module code, so the
  // generated entry carries the register call sites only).
  expect(code).toContain('__registerSsrComponent(');
  expect(code.includes('customElements.define =')).toEqual(false);
  // v0.3.0: Uses wrapInDocument from ssr-handler.ts (single source of truth)
  expect(code).toContain('wrapInDocument(');
  // v0.5.0: No legacy SSR client artifacts
  expect(code.includes('generateHydrationScript')).toEqual(false);
  expect(code.includes('stripLitComments')).toEqual(false);
  expect(code.includes('lit-part')).toEqual(false);
});

test('renderEntry: no process.env call in output', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  const code = renderEntry(desc);

  // Check that process.env is not used as a runtime call (only in comments is fine)
  const codeLines = code.split('\n').filter((l) => !l.trimStart().startsWith('//'));
  expect(codeLines.some((l) => l.includes('process.env'))).toEqual(false);
});

test('renderEntry: custom CORS origin renders correctly', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    middleware: { corsOrigin: 'https://example.com' },
  });
  const code = renderEntry(desc);

  expect(code).toContain('"https://example.com"');
  // Verify no process.env call in non-comment lines
  const codeLines = code.split('\n').filter((l) => !l.trimStart().startsWith('//'));
  expect(codeLines.some((l) => l.includes('process.env'))).toEqual(false);
});

test('renderEntry: document config renders correctly', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    html: { lang: 'zh-CN', title: 'Test' },
    headExtras: '<link rel="stylesheet" href="https://cdn.example.com/styles.css" />',
  });
  const code = renderEntry(desc);

  // v0.3.0: wrapInDocument is called at runtime, not inlined HTML.
  // The generated code passes config as parameters.
  expect(code).toContain('lang: "zh-CN"');
  expect(code).toContain('title: __doc.title || "Test"');
  expect(code).toContain('cdn.example.com');
});

// Integration test: buildEntryDescriptor + renderEntry end-to-end

test('buildEntryDescriptor + renderEntry: end-to-end produces runnable code', () => {
  const code = renderEntry(
    buildEntryDescriptor(sampleRoutes, {
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
    }),
  );

  // ADR-0160 rule a (#1470 block e): Hono assembly is the factory's.
  expect(code.includes("from 'hono'")).toBeFalsy();
  expect(code).toContain('export default app');
  expect(code).toContain('__apiRouteRecords.push({ id: "api/hello.ts"');
  expect(code).toContain('__pageHandlers["/"].GET = [');
  expect(code).toContain('__pageHandlers["/about"].GET = [');
  // No process.env call in non-comment lines
  const codeLines = code.split('\n').filter((l) => !l.trimStart().startsWith('//'));
  expect(codeLines.some((l) => l.includes('process.env'))).toEqual(false);
});

// v0.5 Trust Release regression tests

test('buildEntryDescriptor: root middleware scope uses /* not //*', () => {
  // Bug: scope '/' + '/*' = '//*' in Hono only matches '/', not sub-paths.
  // Fix: scope '/' renders as '/*' (not '//*').
  const routesWithRootMiddleware: RouteEntry[] = [
    { path: '/', filePath: 'index.ts', type: 'page', varName: 'pageIndex' },
    { path: '/admin', filePath: 'admin.ts', type: 'page', varName: 'pageAdmin' },
    {
      path: '/_middleware',
      filePath: '_middleware.ts',
      type: 'special',
      special: 'middleware',
      varName: 'rootMiddleware',
    },
  ];
  const desc = buildEntryDescriptor(routesWithRootMiddleware);
  const code = renderEntry(desc);

  // Root middleware must use '/*' (matches all paths), NOT '//*' (only matches /)
  expect(code).toContain('app.use("/*"');
  expect(code.includes('app.use("//*"'), 'Root middleware must NOT use //* pattern').toEqual(false);
});

test('buildEntryDescriptor: nested island files use real paths, not tagName-derived paths', () => {
  // Bug: tagName "posts-index" was used to build modulePath "/app/islands/posts-index.ts"
  //      but the real file is at "app/islands/posts/index.ts"
  // Fix: islandFiles provides real relative paths, used in preference to tagName
  const desc = buildEntryDescriptor(islandRoutes, {
    islandTagNames: ['my-counter', 'posts-index'],
    islandFiles: ['my-counter.ts', 'posts/index.ts'],
    islandsDir: 'app/islands',
  });

  expect(desc.islands.length).toEqual(2);
  // Top-level island: same as before
  expect(desc.islands[0].modulePath).toEqual('/app/islands/my-counter.ts');
  // Nested island: uses real file path, NOT /app/islands/posts-index.ts
  expect(desc.islands[1].modulePath).toEqual('/app/islands/posts/index.ts');
  expect(
    desc.islands[1].modulePath.includes('posts-index'),
    'Nested island must NOT use tagName-derived path',
  ).toEqual(false);
});

test('buildEntryDescriptor: islandFiles omitted falls back to tagName paths', () => {
  // Backwards compatibility: if islandFiles is not provided, use tagName
  const desc = buildEntryDescriptor(islandRoutes, {
    islandTagNames: ['my-counter'],
    islandsDir: 'app/islands',
  });

  expect(desc.islands[0].modulePath).toEqual('/app/islands/my-counter.ts');
});

test('buildEntryDescriptor: client:only is excluded from SSR admission', () => {
  const desc = buildEntryDescriptor(islandRoutes, {
    islandTagNames: ['client-only-widget'],
    islandFiles: ['client-only-widget.ts'],
    islandMeta: {
      'client-only-widget': {
        tagName: 'client-only-widget',
        hydrate: 'only',
      },
    },
  });

  expect(desc.islands[0].hydrate).toEqual('only');
  expect(desc.islands[0].ssr).toEqual(false);
  expect(desc.islands[0].dsd).toEqual(false);
  expect(desc.ssrAdmissionPlan.clientOnlyTags).toEqual(['client-only-widget']);
  expect(desc.ssrAdmissionPlan.renderableTags).toEqual([]);
});

// Fetch middleware contract (ADR-0123 item 2, #858)

test('buildEntryDescriptor: middleware.use module paths are normalized in order (#858)', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    middleware: { use: ['./app/middleware/outer.ts', './app/middleware/inner.ts'] },
  });

  expect(desc.fetchMiddleware).toEqual(['/app/middleware/outer.ts', '/app/middleware/inner.ts']);
});

test('buildEntryDescriptor: middleware.use rejects function values with a migration error (#858)', () => {
  const fn = (_request: Request, next: () => Promise<Response>) => next();
  assertThrowsIncludes(
    () =>
      buildEntryDescriptor(sampleRoutes, {
        middleware: { use: [fn as never] },
      }),
    Error,
    'middleware.use[0] must be a module path (string)',
  );
});

test('buildEntryDescriptor: no middleware.use leaves fetchMiddleware absent (#858)', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  expect(desc.fetchMiddleware).toEqual(undefined);
});

// #960: registration decoupling — definePage routes ignore the tagName export

test('buildEntryDescriptor: definePage route registers under the fallback tag (#960)', () => {
  const routes: RouteEntry[] = [
    {
      path: '/',
      filePath: 'index.tsx',
      type: 'page',
      varName: 'pageIndex',
      tagName: 'home-page',
      definePage: true,
    },
  ];
  const desc = buildEntryDescriptor(routes);

  expect(desc.pageRoutes[0].defaultTagName).toEqual('index-page');
  expect(
    desc.pageRoutes[0].tagName,
    'definePage route ignores the tagName export for registration',
  ).toEqual('index-page');
});

test('buildEntryDescriptor: plain element route keeps its tagName export (#960)', () => {
  const routes: RouteEntry[] = [
    { path: '/', filePath: 'index.tsx', type: 'page', varName: 'pageIndex', tagName: 'home-page' },
  ];
  const desc = buildEntryDescriptor(routes);

  expect(desc.pageRoutes[0].tagName).toEqual('home-page');
  expect(desc.pageRoutes[0].defaultTagName).toEqual('index-page');
});

test('renderEntry: definePage route binds its tag through the compiled program, never the tagName export (#960, #1276)', () => {
  const routes: RouteEntry[] = [
    {
      path: '/',
      filePath: 'index.tsx',
      type: 'page',
      varName: 'pageIndex',
      tagName: 'home-page',
      definePage: true,
    },
  ];
  const code = renderEntry(buildEntryDescriptor(routes));

  // Registration and the page handler resolve the tag from the route module's
  // compiled Part Program at entry evaluation (#1276); the path-derived
  // fallback tag is the resolver's fallback argument only, and the exported
  // content-element tag never appears — a module-self-registered content
  // element can no longer shadow the definePage render (the #960 failure
  // mode).
  expect(code).toContain('__registerSsrComponent(__resolvePageTag($pageIndex, "index-page")');
  expect(code.includes('__registerSsrComponent("home-page"')).toEqual(false);
  expect(code.includes('__resolvePageTag($pageIndex, "home-page"')).toEqual(false);
  expect(code).toContain('let __tag = __resolvePageTag($pageIndex, "index-page")');
});

test('renderEntry: plain element route binds its tag through the compiled program too (#1276)', () => {
  const routes: RouteEntry[] = [
    { path: '/', filePath: 'index.tsx', type: 'page', varName: 'pageIndex', tagName: 'home-page' },
  ];
  const code = renderEntry(buildEntryDescriptor(routes));

  // One canonical binding for every page route: the scanner's tagName export
  // is the fallback argument; the compiled program tag wins at evaluation.
  expect(code).toContain('__registerSsrComponent(__resolvePageTag($pageIndex, "home-page")');
  expect(code).toContain('let __tag = __resolvePageTag($pageIndex, "home-page")');
});
