/**
 * @openelement/router - Entry descriptor + renderer tests (Deno)
 *
 * Tests the two-step entry pipeline:
 *   1. buildEntryDescriptor - produces structured data
 *   2. renderEntry - renders data to code string
 */

import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import type { RouteEntry } from '../src/vite/internal/protocol/framework.ts';

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

Deno.test('buildEntryDescriptor: default options produce correct structure', () => {
  const desc = buildEntryDescriptor(sampleRoutes);

  assertEquals(desc.isSSG, false);
  assertEquals(desc.apiRoutes.length, 1);
  assertEquals(desc.pageRoutes.length, 2);
  assertEquals(desc.middleware.length, 4); // requestId, logger, cors, securityHeaders
  assertEquals(desc.document.lang, 'en');
  assertEquals(desc.document.title, 'openElement');
  assertEquals(desc.document.headExtras, '');
});

Deno.test('buildEntryDescriptor: SSG mode sets isSSG', () => {
  const desc = buildEntryDescriptor(sampleRoutes, { ssg: true });

  assertEquals(desc.isSSG, true);
});

Deno.test('buildEntryDescriptor: middleware can be disabled', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    middleware: { cors: false, requestId: false },
  });

  const kinds = desc.middleware.map((m) => m.kind);
  assertEquals(kinds.includes('cors'), false);
  assertEquals(kinds.includes('requestId'), false);
  assertEquals(kinds.includes('logger'), true);
  assertEquals(kinds.includes('securityHeaders'), true);
});

Deno.test('buildEntryDescriptor: custom CORS origin is serialized', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    middleware: { corsOrigin: 'https://example.com' },
  });

  const corsMw = desc.middleware.find((m) => m.kind === 'cors');
  assertEquals(corsMw?.config?.corsOrigin, 'https://example.com');
});

Deno.test('buildEntryDescriptor: array CORS origin is preserved', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    middleware: { corsOrigin: ['https://a.com', 'https://b.com'] },
  });

  const corsMw = desc.middleware.find((m) => m.kind === 'cors');
  assertEquals(corsMw?.config?.corsOrigin, ['https://a.com', 'https://b.com']);
});

Deno.test('buildEntryDescriptor: function CORS origin is serialized', () => {
  const originFn = (origin: string) => origin.endsWith('.example.com') ? origin : '';
  const desc = buildEntryDescriptor(sampleRoutes, {
    middleware: { corsOrigin: originFn },
  });

  const corsMw = desc.middleware.find((m) => m.kind === 'cors');
  const corsOrigin = corsMw?.config?.corsOrigin;
  if (corsOrigin && typeof corsOrigin === 'object' && !Array.isArray(corsOrigin)) {
    assertEquals(corsOrigin.type, 'function');
    assertStringIncludes(corsOrigin.body, 'example.com');
  } else {
    throw new Error('Expected function-type CorsOriginConfig');
  }
});

Deno.test('buildEntryDescriptor: custom html config is applied', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    html: { lang: 'zh-CN', title: 'My App' },
    headExtras: '<link rel="stylesheet" href="https://cdn.example.com/styles.css" />',
  });

  assertEquals(desc.document.lang, 'zh-CN');
  assertEquals(desc.document.title, 'My App');
  assertStringIncludes(desc.document.headExtras, 'cdn.example.com');
});

Deno.test('buildEntryDescriptor: islands are mapped correctly', () => {
  const desc = buildEntryDescriptor(islandRoutes, {
    islandTagNames: ['my-counter', 'theme-toggle'],
    islandsDir: 'app/islands',
  });

  assertEquals(desc.islands.length, 2);
  assertEquals(desc.islands[0].tagName, 'my-counter');
  assertEquals(desc.islands[0].modulePath, '/app/islands/my-counter.ts');
  assertEquals(desc.islands[1].tagName, 'theme-toggle');
});

Deno.test('buildEntryDescriptor: route import paths include routesDir', () => {
  const desc = buildEntryDescriptor(sampleRoutes, { routesDir: 'app/routes' });

  assertEquals(desc.apiRoutes[0].importPath, '/app/routes/api/hello.ts');
  assertEquals(desc.pageRoutes[0].importPath, '/app/routes/index.ts');
});

Deno.test('buildEntryDescriptor: static components are explicit and rendered into the SSR entry', () => {
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

  assertEquals(desc.staticComponents, [
    {
      tagName: 'open-article-view',
      modulePath: '/app/components/article.tsx',
      compilerInteractionEvents: [],
    },
  ]);
  assertStringIncludes(code, 'import * as __static_component_0 from "/app/components/article.tsx"');
  assertStringIncludes(
    code,
    '__registerSsrComponent("open-article-view", __static_component_0.default)',
  );
  assertStringIncludes(code, 'ssrRenderableTags: __ssrRenderableTags');
  assertEquals(code.includes('__expandNestedHosts'), false);
  assertEquals(code.includes('__nestedShellPattern'), false);
  assertEquals(code.includes('__propsFromAttrs'), false);
  assertEquals(code.includes('__projectLightChildren'), false);
  assertStringIncludes(code, '"open-article-view"');
});

Deno.test('buildEntryDescriptor: compiler-proven interaction becomes one client admission input', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    upgradeStrategy: 'visible',
    staticComponents: [{
      tagName: 'open-menu-button',
      modulePath: '/app/components/menu-button.tsx',
      compilerInteractionEvents: ['click', 'keydown'],
    }],
  });
  const code = renderEntry(desc);

  assertEquals(desc.staticComponents, []);
  assertEquals(desc.islands, [{
    tagName: 'open-menu-button',
    modulePath: '/app/components/menu-button.tsx',
    hydrate: 'visible',
    ssr: true,
    dsd: true,
    authoring: 'basic-element',
    source: 'nested',
    reason: 'compiler-proven interaction events: click, keydown',
  }]);
  assertEquals(desc.ssrAdmissionPlan.renderableTags, ['open-menu-button']);
  assertStringIncludes(code, 'import * as __island_open_menu_button');
  assertStringIncludes(code, '"open-menu-button"');
  assertEquals(code.includes('__static_component_0'), false);
});

// renderEntry tests

Deno.test('renderEntry: produces valid module code', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  const code = renderEntry(desc);

  assertStringIncludes(code, "import { Hono } from 'hono'");
  // v0.44 (ADR-0143): the sync compiled renderDsd is the only serializer
  // import — the legacy VNode tree renderer is gone.
  assertStringIncludes(
    code,
    "import { renderDsd, trustedHtml, escapeHtml, wrapInDocument } from '@openelement/element'",
  );
  assertEquals(code.includes('renderDsdTree'), false);
  assertStringIncludes(code, 'export default app');
  assertStringIncludes(code, 'const app = new Hono()');
});

Deno.test('renderEntry: SSG mode excludes DOM shim (DSD renderer has no shim dependency)', () => {
  const desc = buildEntryDescriptor(sampleRoutes, { ssg: true });
  const code = renderEntry(desc);

  // v0.5.0: DSD renderer doesn't need DOM shim - no @lit-labs/ssr dependency
  assertEquals(code.includes('install-global-dom-shim'), false);
});

Deno.test('renderEntry: SSG mode omits /__kiss debug endpoint', () => {
  const desc = buildEntryDescriptor(sampleRoutes, { ssg: true });
  const code = renderEntry(desc);

  assertEquals(code.includes('/__kiss'), false);
});

Deno.test('renderEntry: dev mode omits the /__kiss debug endpoint', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  const code = renderEntry(desc);

  // Debug endpoint was removed in Phase 4A audit (security: leaked route info).
  // Generated code must NOT contain /__kiss.
  assertEquals(code.includes('/__kiss'), false);
});

Deno.test('renderEntry: API routes are registered with app.route', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  const code = renderEntry(desc);

  // v0.21: API routes accept Hono sub-apps and direct (ctx) => Response functions.
  assertStringIncludes(code, 'app.route("/api/hello"');
  assertStringIncludes(code, 'request: c.req.raw');
  assertStringIncludes(code, '$apiHello');
});

Deno.test('renderEntry: page routes use SSR helper and wrapInDocument', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  const code = renderEntry(desc);

  assertStringIncludes(code, '__pageHandlers["/"].GET = [');
  // v0.5.0: __ssr takes route params as second arg for SSR-time data access
  assertStringIncludes(code, '__ssr(tag');
  assertStringIncludes(code, "c.get('routeResolution').params");
  // v0.3.4: SSR automatically registers page components for Shadow DOM rendering
  assertStringIncludes(code, 'customElements.define(');
  // v0.5.0: DSD renderer uses customElements.get(tag) to find component class
  assertStringIncludes(code, 'customElements.get(tag)');
  // v0.3.0: Uses wrapInDocument from ssr-handler.ts (single source of truth)
  assertStringIncludes(code, 'wrapInDocument(');
  // v0.5.0: No legacy SSR client artifacts
  assertEquals(code.includes('generateHydrationScript'), false);
  assertEquals(code.includes('stripLitComments'), false);
  assertEquals(code.includes('lit-part'), false);
});

Deno.test('renderEntry: no process.env call in output', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  const code = renderEntry(desc);

  // Check that process.env is not used as a runtime call (only in comments is fine)
  const codeLines = code.split('\n').filter((l) => !l.trimStart().startsWith('//'));
  assertEquals(codeLines.some((l) => l.includes('process.env')), false);
});

Deno.test('renderEntry: custom CORS origin renders correctly', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    middleware: { corsOrigin: 'https://example.com' },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, '"https://example.com"');
  // Verify no process.env call in non-comment lines
  const codeLines = code.split('\n').filter((l) => !l.trimStart().startsWith('//'));
  assertEquals(codeLines.some((l) => l.includes('process.env')), false);
});

Deno.test('renderEntry: document config renders correctly', () => {
  const desc = buildEntryDescriptor(sampleRoutes, {
    html: { lang: 'zh-CN', title: 'Test' },
    headExtras: '<link rel="stylesheet" href="https://cdn.example.com/styles.css" />',
  });
  const code = renderEntry(desc);

  // v0.3.0: wrapInDocument is called at runtime, not inlined HTML.
  // The generated code passes config as parameters.
  assertStringIncludes(code, 'lang: "zh-CN"');
  assertStringIncludes(code, 'title: __doc.title || "Test"');
  assertStringIncludes(code, 'cdn.example.com');
});

// Integration test: buildEntryDescriptor + renderEntry end-to-end

Deno.test('buildEntryDescriptor + renderEntry: end-to-end produces runnable code', () => {
  const code = renderEntry(buildEntryDescriptor(sampleRoutes, {
    routesDir: 'app/routes',
    islandsDir: 'app/islands',
  }));

  assertStringIncludes(code, "import { Hono } from 'hono'");
  assertStringIncludes(code, 'export default app');
  assertStringIncludes(code, 'app.route("/api/hello"');
  assertStringIncludes(code, '__pageHandlers["/"].GET = [');
  assertStringIncludes(code, '__pageHandlers["/about"].GET = [');
  // No process.env call in non-comment lines
  const codeLines = code.split('\n').filter((l) => !l.trimStart().startsWith('//'));
  assertEquals(codeLines.some((l) => l.includes('process.env')), false);
});

// v0.5 Trust Release regression tests

Deno.test('buildEntryDescriptor: root middleware scope uses /* not //*', () => {
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
  assertStringIncludes(code, 'app.use("/*"');
  assertEquals(code.includes('app.use("//*"'), false, 'Root middleware must NOT use //* pattern');
});

Deno.test('buildEntryDescriptor: nested island files use real paths, not tagName-derived paths', () => {
  // Bug: tagName "posts-index" was used to build modulePath "/app/islands/posts-index.ts"
  //      but the real file is at "app/islands/posts/index.ts"
  // Fix: islandFiles provides real relative paths, used in preference to tagName
  const desc = buildEntryDescriptor(islandRoutes, {
    islandTagNames: ['my-counter', 'posts-index'],
    islandFiles: ['my-counter.ts', 'posts/index.ts'],
    islandsDir: 'app/islands',
  });

  assertEquals(desc.islands.length, 2);
  // Top-level island: same as before
  assertEquals(desc.islands[0].modulePath, '/app/islands/my-counter.ts');
  // Nested island: uses real file path, NOT /app/islands/posts-index.ts
  assertEquals(desc.islands[1].modulePath, '/app/islands/posts/index.ts');
  assertEquals(
    desc.islands[1].modulePath.includes('posts-index'),
    false,
    'Nested island must NOT use tagName-derived path',
  );
});

Deno.test('buildEntryDescriptor: islandFiles omitted falls back to tagName paths', () => {
  // Backwards compatibility: if islandFiles is not provided, use tagName
  const desc = buildEntryDescriptor(islandRoutes, {
    islandTagNames: ['my-counter'],
    islandsDir: 'app/islands',
  });

  assertEquals(desc.islands[0].modulePath, '/app/islands/my-counter.ts');
});

Deno.test('buildEntryDescriptor: client:only is excluded from SSR admission', () => {
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

  assertEquals(desc.islands[0].hydrate, 'only');
  assertEquals(desc.islands[0].ssr, false);
  assertEquals(desc.islands[0].dsd, false);
  assertEquals(desc.ssrAdmissionPlan.clientOnlyTags, ['client-only-widget']);
  assertEquals(desc.ssrAdmissionPlan.renderableTags, []);
});

// Fetch middleware contract (ADR-0123 item 2, #858)

Deno.test('buildEntryDescriptor: middleware.use functions are serialized in order (#858)', () => {
  const first = async (_request: Request, next: () => Promise<Response>) => {
    const response = await next();
    response.headers.set('x-first', '1');
    return response;
  };
  const second = (_request: Request, next: () => Promise<Response>) => next();
  const desc = buildEntryDescriptor(sampleRoutes, { middleware: { use: [first, second] } });

  assertEquals(desc.fetchMiddleware?.length, 2);
  assertStringIncludes(desc.fetchMiddleware?.[0] ?? '', 'x-first');
  // Serialized sources must evaluate back to self-contained functions.
  const revived = (desc.fetchMiddleware ?? []).map((source) => (0, eval)(`(${source})`) as unknown);
  assertEquals(revived.every((fn) => typeof fn === 'function'), true);
});

Deno.test('buildEntryDescriptor: middleware.use rejects non-functions (#858)', () => {
  assertThrows(
    () =>
      buildEntryDescriptor(sampleRoutes, {
        middleware: { use: ['nope' as never] },
      }),
    Error,
    'middleware.use[0] must be a function',
  );
});

Deno.test('buildEntryDescriptor: no middleware.use leaves fetchMiddleware absent (#858)', () => {
  const desc = buildEntryDescriptor(sampleRoutes);
  assertEquals(desc.fetchMiddleware, undefined);
});

// #960: registration decoupling — definePage routes ignore the tagName export

Deno.test('buildEntryDescriptor: definePage route registers under the fallback tag (#960)', () => {
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

  assertEquals(desc.pageRoutes[0].defaultTagName, 'index-page');
  assertEquals(
    desc.pageRoutes[0].tagName,
    'index-page',
    'definePage route ignores the tagName export for registration',
  );
});

Deno.test('buildEntryDescriptor: plain element route keeps its tagName export (#960)', () => {
  const routes: RouteEntry[] = [
    { path: '/', filePath: 'index.tsx', type: 'page', varName: 'pageIndex', tagName: 'home-page' },
  ];
  const desc = buildEntryDescriptor(routes);

  assertEquals(desc.pageRoutes[0].tagName, 'home-page');
  assertEquals(desc.pageRoutes[0].defaultTagName, 'index-page');
});

Deno.test('renderEntry: definePage route binds its tag through the compiled program, never the tagName export (#960, #1276)', () => {
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
  assertStringIncludes(
    code,
    '__registerSsrComponent(__resolvePageTag($pageIndex, "index-page")',
  );
  assertEquals(code.includes('__registerSsrComponent("home-page"'), false);
  assertEquals(code.includes('__resolvePageTag($pageIndex, "home-page"'), false);
  assertStringIncludes(code, 'let __tag = __resolvePageTag($pageIndex, "index-page")');
});

Deno.test('renderEntry: plain element route binds its tag through the compiled program too (#1276)', () => {
  const routes: RouteEntry[] = [
    { path: '/', filePath: 'index.tsx', type: 'page', varName: 'pageIndex', tagName: 'home-page' },
  ];
  const code = renderEntry(buildEntryDescriptor(routes));

  // One canonical binding for every page route: the scanner's tagName export
  // is the fallback argument; the compiled program tag wins at evaluation.
  assertStringIncludes(code, '__registerSsrComponent(__resolvePageTag($pageIndex, "home-page")');
  assertStringIncludes(code, 'let __tag = __resolvePageTag($pageIndex, "home-page")');
});
