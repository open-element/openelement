/**
 * @openelement/adapter-vite - Entry renderer snapshot tests (Deno)
 *
 * Snapshot tests for renderEntry output covering:
 * - CSP middleware (with/without nonce)
 * - _renderer.ts / _middleware.ts special routes
 * - Island upgrade strategies (load/idle/visible/only)
// Package islands
// Code structure validation
 */

import { assertEquals, assertExists, assertFalse, assertStringIncludes } from '@std/assert';
import { buildEntryDescriptor, renderEntry } from '../src/internal/ssg/index.ts';
import { resetCorsOriginWarningForTests } from '../src/internal/ssg/entry-server-codegen.ts';
import type { RouteEntry } from '../src/internal/protocol/framework.ts';

// Fixtures

const basicRoutes: RouteEntry[] = [
  { path: '/', filePath: 'index.ts', type: 'page', varName: 'pageIndex' },
  { path: '/api/hello', filePath: 'api/hello.ts', type: 'api', varName: 'apiHello' },
];

const withSpecialRoutes: RouteEntry[] = [
  { path: '/', filePath: 'index.ts', type: 'page', varName: 'pageIndex' },
  { path: '/guide', filePath: 'guide/index.ts', type: 'page', varName: 'guideIndex' },
  {
    path: '/guide/getting-started',
    filePath: 'guide/getting-started.ts',
    type: 'page',
    varName: 'guideGettingStarted',
  },
  { path: '/api/data', filePath: 'api/data.ts', type: 'api', varName: 'apiData' },
  {
    path: '/_renderer',
    filePath: '_renderer.ts',
    type: 'special',
    special: 'renderer',
    varName: 'specialRenderer',
  },
  {
    path: '/guide/_renderer',
    filePath: 'guide/_renderer.ts',
    type: 'special',
    special: 'renderer',
    varName: 'guideRenderer',
  },
  {
    path: '/api/_middleware',
    filePath: 'api/_middleware.ts',
    type: 'special',
    special: 'middleware',
    varName: 'apiMiddleware',
  },
];

// Section

Deno.test('renderEntry: CSP without nonce generates header middleware', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      csp: {
        policy: "default-src 'self'; script-src 'self'",
      },
    },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'Content-Security-Policy');
  assertStringIncludes(code, "default-src 'self'; script-src 'self'");
  // No nonce middleware when not configured - c.get('cspNonce') returns undefined
  assertEquals(code.includes('crypto.randomUUID()'), false);
  // cspNonce is always passed to wrapInDocument but will be undefined
  // when no CSP nonce middleware is configured
  assertStringIncludes(code, "cspNonce: c.get('cspNonce')");
});

Deno.test('renderEntry: does not emit the retired duplicate /_data loader protocol (#987)', () => {
  const code = renderEntry(buildEntryDescriptor(basicRoutes, {}));

  // SPA mode executes its RouteConfig loader with decoded router params;
  // request-time navigation uses the canonical page route. A second generated
  // loader endpoint had no consumer and lost params/headers/control flow.
  assertFalse(code.includes('/_data'));
  assertFalse(code.includes('__dataRouteMap'));
});

Deno.test('buildEntryDescriptor: catch-all param names come from the scanner, not the path pattern (#1022)', () => {
  const catchAllRoutes: RouteEntry[] = [
    {
      path: '/docs/:path{.+}',
      filePath: 'docs/[...path].tsx',
      type: 'page',
      varName: 'docsPath',
      params: ['path'],
    },
  ];
  const desc = buildEntryDescriptor(catchAllRoutes, {});
  const route = desc.pageRoutes[0];
  assertEquals(route.paramNames, ['path']);

  // Hand-built descriptors without scanner params fall back to derivation
  // that strips the regex body instead of capturing it.
  const { params: _scannerParams, ...withoutParams } = catchAllRoutes[0];
  const fallback = buildEntryDescriptor([withoutParams], {});
  assertEquals(fallback.pageRoutes[0].paramNames, ['path']);
});

Deno.test('renderEntry: CSP with nonce generates per-request nonce', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      csp: {
        policy: "default-src 'self'",
        nonce: true,
      },
    },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'crypto.randomUUID()');
  assertStringIncludes(code, "c.set('cspNonce'");
  // v0.3.1: NONCE_PLACEHOLDER template approach (fixes missing closing quote bug)
  assertStringIncludes(code, 'NONCE_PLACEHOLDER');
  assertStringIncludes(code, ".replace('NONCE_PLACEHOLDER', nonce)");
});

Deno.test('renderEntry: CSP report-only mode', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      csp: {
        policy: "default-src 'self'",
        reportOnly: true,
      },
    },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'Content-Security-Policy-Report-Only');
  assertEquals(code.includes('Content-Security-Policy"'), false);
});

Deno.test('buildEntryDescriptor: CSP config is serialized into descriptor', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      csp: {
        policy: "default-src 'self'; script-src 'self'",
        nonce: true,
      },
    },
  });

  const cspMw = desc.middleware.find((m) => m.kind === 'csp');
  assertExists(cspMw);
  assertEquals(cspMw.config?.csp?.policy, "default-src 'self'; script-src 'self'");
  assertEquals(cspMw.config?.csp?.nonce, true);
});

// Section

Deno.test('renderEntry: _renderer.ts generates wrap call', () => {
  const desc = buildEntryDescriptor(withSpecialRoutes);
  const code = renderEntry(desc);

  // Renderers should appear in descriptor
  assertEquals(desc.renderers.length >= 2, true);
  // Generated code should reference renderer variable names
  assertStringIncludes(code, '$specialRenderer');
  assertStringIncludes(code, '$guideRenderer');
  // Renderer wrap call receives the rendered page HTML and c (Hono context)
  assertStringIncludes(code, '.default.wrap(__content, c)');
});

Deno.test('renderEntry: _middleware.ts generates app.use scope', () => {
  const desc = buildEntryDescriptor(withSpecialRoutes);
  const code = renderEntry(desc);

  // Middleware scopes should appear in descriptor
  assertEquals(desc.middlewareScopes.length >= 1, true);
  // Generated code should reference middleware variable name
  assertStringIncludes(code, '$apiMiddleware');
  assertStringIncludes(code, 'app.use(');
});

Deno.test('buildEntryDescriptor: special routes are separated from page/api', () => {
  const desc = buildEntryDescriptor(withSpecialRoutes);

  // Special routes should NOT be in apiRoutes or pageRoutes; they go to renderers/middlewareScopes
  assertEquals(desc.apiRoutes.length > 0, true);
  assertEquals(desc.pageRoutes.length > 0, true);

  // They should appear as renderers and middlewareScopes instead
  assertEquals(desc.renderers.length + desc.middlewareScopes.length >= 3, true); // _renderer x2 + _middleware x1
});

// Island upgrade strategy tests

Deno.test('buildEntryDescriptor: upgradeStrategy is recorded (load)', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    islandTagNames: ['my-counter'],
    upgradeStrategy: 'load',
  });

  assertEquals(desc.upgradeStrategy, 'load');
});

Deno.test('buildEntryDescriptor: upgradeStrategy is recorded (visible)', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    islandTagNames: ['idle-image'],
    upgradeStrategy: 'visible',
  });

  assertEquals(desc.upgradeStrategy, 'visible');
});

Deno.test('buildEntryDescriptor: default upgradeStrategy is idle', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    islandTagNames: ['my-counter'],
  });

  // Default should be 'idle'
  assertEquals(desc.upgradeStrategy, 'idle');
});

// Package islands

// Package islands

Deno.test('renderEntry: package islands are included in island upgrade entry', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    packageManifests: [
      {
        schemaVersion: '1.0.0',
        packageName: '@acme/components',
        version: '0.17.0',
        declarations: [
          {
            tagName: 'open-layout',
            className: 'OpenLayout',
            openElement: { module: '@acme/components/open-layout', hydrate: 'load' },
          },
          {
            tagName: 'open-button',
            className: 'OpenButton',
            openElement: { module: '@acme/components/open-button', hydrate: 'idle' },
          },
        ],
      },
    ],
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'open-layout');
  assertStringIncludes(code, 'open-button');
  assertStringIncludes(code, '@acme/components');
});

Deno.test('renderEntry: package islands are not imported by SSR entry', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    packageManifests: [
      {
        schemaVersion: '1.0.0',
        packageName: '@acme/components',
        version: '0.17.0',
        declarations: [
          {
            tagName: 'open-layout',
            className: 'OpenLayout',
            openElement: { module: '@acme/components/open-layout', hydrate: 'load' },
          },
          {
            tagName: 'open-button',
            className: 'OpenButton',
            openElement: { module: '@acme/components/open-button', hydrate: 'idle' },
          },
        ],
      },
    ],
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, '"open-layout": "@acme/components/open-layout"');
  assertFalse(
    code.includes("import * as __island_kiss_layout from '@acme/components/open-layout'"),
  );
  assertFalse(code.includes('__kiss_get_default_export'));
  assertFalse(code.includes("customElements.define('open-layout'"));
  assertFalse(code.includes('__island_kiss_layout.default'));
  assertFalse(code.includes('__island_kiss_button.default'));
});

// Code structure validation

Deno.test('renderEntry: no bare process.env references', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: { corsOrigin: 'https://example.com' },
  });
  const code = renderEntry(desc);

  const codeLines = code
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
  assertFalse(
    codeLines.some((l) => l.includes('process.env')),
    'Generated code must not contain process.env calls',
  );
});

Deno.test('renderEntry: API routes support Hono apps and direct functions', () => {
  const desc = buildEntryDescriptor(basicRoutes);
  const code = renderEntry(desc);

  assertStringIncludes(code, 'app.route("/api/hello"');
  assertStringIncludes(code, 'app.all("/api/hello"');
  assertStringIncludes(code, 'request: c.req.raw');
  assertEquals(code.includes('app.get("/api/hello"'), false);
});

Deno.test('renderEntry: exports default app', () => {
  const desc = buildEntryDescriptor(basicRoutes);
  const code = renderEntry(desc);

  assertStringIncludes(code, 'export default app');
});

Deno.test('renderEntry: imports Hono and DSD renderer', () => {
  const desc = buildEntryDescriptor(basicRoutes);
  const code = renderEntry(desc);

  assertStringIncludes(code, "import { Hono } from 'hono'");
  // v0.5.0: DSD renderer replaces @lit-labs/ssr; v0.44: the compiled sync
  // renderDsd is the only serializer — no runtime JSX or tree renderer.
  assertStringIncludes(
    code,
    "import { renderDsd, trustedHtml, escapeHtml, wrapInDocument } from '@openelement/element'",
  );
  assertFalse(code.includes('renderDsdTree'));
  assertFalse(code.includes("import { jsx } from '@openelement/element'"));
  // Element owns document/head/body semantics; generated entries only call it.
  assertFalse(code.includes('function wrapInDocument(html, options = {}) {'));
});

Deno.test('renderEntry: app shell composes the page host through the compiled serializer', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    ssg: true,
    appShell: { tagName: 'open-layout', import: '@acme/components/open-layout', props: {} },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'function __renderAppShell(pageHtml, routePath');
  assertStringIncludes(code, '"tagName": "open-layout"');
  assertStringIncludes(code, 'import * as __shell_0 from "@acme/components/open-layout";');
  assertStringIncludes(
    code,
    '__ssr(shell.tagName, layoutProps, { route: routePath }, 0, new Map([["", trustedHtml(content)]]))',
  );
  assertFalse(code.includes('layoutHtml.slice'));
});

Deno.test('renderEntry: unconfigured appShell defaults to false (no import)', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  assertFalse(code.includes('import "@acme/components/open-layout";'));
  assertStringIncludes(code, '"default": false');
  assertStringIncludes(code, 'if (!shell) return content;');
});

Deno.test('renderEntry: appShell false renders route content without default layout import', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true, appShell: false });
  const code = renderEntry(desc);

  assertFalse(code.includes('import "@acme/components/open-layout";'));
  assertStringIncludes(code, '"default": false');
  assertStringIncludes(code, 'if (!shell) return content;');
});

Deno.test('renderEntry: custom appShell import and props are generated from config', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    ssg: true,
    appShell: {
      tagName: 'blog-layout',
      import: './app/components/blog-layout.tsx',
      props: { siteName: 'Field Notes' },
    },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'import * as __shell_0 from "/app/components/blog-layout.tsx";');
  assertStringIncludes(code, '"tagName": "blog-layout"');
  assertStringIncludes(code, '"siteName": "Field Notes"');
});

Deno.test('renderEntry: route meta layout can select named layouts', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    ssg: true,
    layouts: {
      default: false,
      post: {
        tagName: 'post-layout',
        import: './app/components/post-layout.tsx',
      },
    },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'import * as __shell_0 from "/app/components/post-layout.tsx";');
  assertStringIncludes(
    code,
    'const layout = Object.prototype.hasOwnProperty.call(routeMeta, "layout")',
  );
  assertStringIncludes(code, '__appShellPlan.layouts[layout] ?? __appShellPlan.default');
  assertStringIncludes(code, 'module: $pageIndex');
});

Deno.test('renderEntry: definePage descriptor feeds load and metadata wiring', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'let __page = __pageDefinition($pageIndex)');
  assertStringIncludes(
    code,
    'const __data = typeof $pageIndex.loader === "function" ? await $pageIndex.loader(__loadContext) : undefined',
  );
  // v0.44 (ADR-0143): request-scoped data reaches the compiled page ONLY
  // through the descriptor's props projector — the compiled serializer maps
  // declared compiled properties onto the host; the legacy __openElement*
  // host-prop channel is gone (the #1129/#1130 guarantee is structural).
  // #1326: the request-scoped context is built once and feeds both the props
  // projector and the resolved-Document seam.
  assertStringIncludes(
    code,
    'const __pageContext = { data: __data, actionData: undefined, params: __params, request: c.req.raw, locale: __localeFromPath(c.req.path, __getDefaultLocale()), route: __routeContext, meta: __routeMetaValue };',
  );
  assertStringIncludes(code, 'const __doc = __resolvePageDocument(__page.head, __pageContext);');
  assertStringIncludes(
    code,
    "import { resolvePageDocument as __resolvePageDocument } from '@openelement/router/document'",
  );
  assertStringIncludes(
    code,
    '__ssr(__tag, __pageProps($pageIndex, __pageContext)',
  );
  assertFalse(code.includes('__openElementData'));
  assertEquals(code.includes('module?.meta'), false);
  assertEquals(code.includes('page.layout'), false);
  assertStringIncludes(code, 'title: __doc.title || "openElement"');
  assertStringIncludes(
    code,
    'meta: { description: __doc.description, tags: __doc.meta },',
  );
  assertStringIncludes(code, 'links: __doc.links,');
  assertStringIncludes(
    code,
    'dangerouslyHeadFragments: __doc.dangerouslyHeadFragments || [],',
  );
  assertStringIncludes(code, 'function __pageDefinition(module) {');
  assertStringIncludes(
    code,
    "import { isOpenElementRedirect as __isOpenElementRedirect, isOpenElementNotFound as __isOpenElementNotFound, classifyActionResult as __classifyActionResult, ACTION_FETCH_HEADER as __actionFetchHeader, PROBLEM_JSON_MEDIA_TYPE as __problemJsonMediaType } from '@openelement/router';",
  );
  assertFalse(code.includes('function __isOpenElementRedirect(error) {'));
  assertFalse(code.includes('function __isOpenElementNotFound(error) {'));
  assertStringIncludes(
    code,
    'data = typeof info.module.loader === "function" ? await info.module.loader(loadContext) : undefined;',
  );
  assertStringIncludes(code, '__pageProps(info.module, __pageContext)');
  assertStringIncludes(code, 'const __doc = __resolvePageDocument(page.head, __pageContext);');
  assertStringIncludes(code, 'filePath: "index.ts"');
  assertStringIncludes(
    code,
    'rendering: (__pageDefinition($pageIndex).renderIntent?.mode || "static")',
  );
  assertStringIncludes(code, 'title: title || __doc.title || "openElement"');
  // #1217: ISR semantics were removed in v0.44 — generated route metadata
  // must not carry a revalidate field.
  assertFalse(code.includes('revalidate'));
});

Deno.test('renderEntry: lifecycle control produces redirect and not-found responses', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'return c.redirect(err.location, err.status)');
  assertStringIncludes(code, '__statusHtml("404 Not Found", err.message || "Not Found")');
  assertStringIncludes(
    code,
    'redirect: { location: error.location, status: error.status }',
  );
  assertStringIncludes(code, 'notFound: true');
  assertStringIncludes(code, '__pageErrorProps($pageIndex, err,');
});

Deno.test('renderEntry: SSG renderRoute renders the page error component on failure', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  // Parity with the dev/server route handler: a page declaring an error
  // component renders it with __openElementError inside the SSG renderRoute
  // catch, and the failure still surfaces as a 500 result carrying the
  // RenderError (no silent normal-page write).
  assertStringIncludes(code, 'if (typeof page.error === "function") {');
  assertStringIncludes(code, '__pageErrorProps(info.module, error,');
  assertStringIncludes(code, '__renderAppShell(__ssr(info.tagName,');
  assertStringIncludes(
    code,
    'return { html: errorHtml, status: 500, errors: [renderError], componentCount: errorComponentCount, renderTimeMs };',
  );
  // A failing error renderer falls back to the plain 500 status page.
  assertStringIncludes(code, "'[openElement] Route error renderer failed for ' + routePath + ':'");
  assertStringIncludes(code, '__statusHtml("500 Internal Server Error", detail)');
  // The routeInfo emission no longer carries the dead streaming contract.
  assertFalse(code.includes('renderIntent?.streaming'));
});

Deno.test('renderEntry: uses descriptor SSR admission plan without recomputing it', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    ssg: true,
    islandTagNames: ['planned-widget'],
    islandFiles: ['planned-widget.ts'],
  });
  desc.ssrAdmissionPlan.renderableTags = [];
  desc.ssrAdmissionPlan.clientOnlyTags = ['planned-widget'];
  desc.ssrAdmissionPlan.reasons['planned-widget'] = 'test override';

  const code = renderEntry(desc);

  assertFalse(code.includes('import * as __island_planned_widget from'));
  assertFalse(code.includes("customElements.define('planned-widget'"));
  assertStringIncludes(code, '"clientOnlyTags": [\n    "planned-widget"\n  ]');
});

Deno.test('renderEntry: SSG mode includes no DOM shim (DSD renderer)', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  // v0.5.0: DSD renderer doesn't need DOM shim - pure string concatenation
  assertEquals(code.includes('install-global-dom-shim'), false);
});

// Section

Deno.test('renderEntry: CSP flows through full pipeline', () => {
  const code = renderEntry(buildEntryDescriptor(basicRoutes, {
    middleware: {
      csp: {
        policy: "default-src 'self'; script-src 'self' 'unsafe-inline'",
        nonce: false,
      },
    },
  }));

  assertStringIncludes(code, 'Content-Security-Policy');
  assertStringIncludes(code, "default-src 'self'");
  assertStringIncludes(code, 'export default app');
});

Deno.test('renderEntry: complex scenario with all features', () => {
  const code = renderEntry(buildEntryDescriptor(withSpecialRoutes, {
    routesDir: 'app/routes',
    islandsDir: 'app/islands',
    middleware: {
      corsOrigin: 'https://example.com',
      csp: { policy: "default-src 'self'", nonce: true },
      securityHeaders: true,
    },
    islandTagNames: ['code-block', 'counter-island'],
    packageManifests: [
      {
        schemaVersion: '1.0.0',
        packageName: '@acme/components',
        version: '0.17.0',
        declarations: [
          {
            tagName: 'open-layout',
            className: 'OpenLayout',
            openElement: { module: '@acme/components/open-layout', hydrate: 'load' },
          },
        ],
      },
    ],
    html: { lang: 'zh-CN', title: 'openElement' },
    headExtras: '<link rel="stylesheet" href="/styles.css" />',
    upgradeStrategy: 'idle' as const,
  }));

  // All features present
  assertStringIncludes(code, 'Content-Security-Policy');
  assertStringIncludes(code, 'crypto.randomUUID()');
  assertStringIncludes(code, '"https://example.com"');
  assertStringIncludes(code, '_renderer');
  assertStringIncludes(code, '_middleware');
  assertStringIncludes(code, 'open-layout');
  assertStringIncludes(code, 'lang: "zh-CN"');
  assertStringIncludes(code, 'openElement');
  assertStringIncludes(code, '/styles.css');
  // No process.env
  const codeLines = code.split('\n').filter((l) => !l.trimStart().startsWith('//'));
  assertFalse(codeLines.some((l) => l.includes('process.env')));
});

// Section

Deno.test('renderEntry: CSP nonce with existing script-src in policy', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      csp: {
        policy: "default-src 'self'; script-src 'self' 'unsafe-inline'",
        nonce: true,
      },
    },
  });
  const code = renderEntry(desc);

  // When script-src already exists, nonce is injected into existing directive
  assertStringIncludes(code, 'NONCE_PLACEHOLDER');
  assertStringIncludes(code, "script-src 'nonce-NONCE_PLACEHOLDER'");
});

Deno.test('renderEntry: CSP nonce without existing script-src', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      csp: {
        policy: "default-src 'self'",
        nonce: true,
      },
    },
  });
  const code = renderEntry(desc);

  // When no script-src, one is appended
  assertStringIncludes(code, 'NONCE_PLACEHOLDER');
  assertStringIncludes(code, "script-src 'nonce-NONCE_PLACEHOLDER'");
});

Deno.test('renderEntry: CORS with array origins', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      corsOrigin: ['http://localhost:3000', 'http://localhost:3001'],
    },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'cors');
  assertStringIncludes(code, 'localhost:3000');
});

Deno.test('renderEntry: CORS default (no corsOrigin) generates localhost regex', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      cors: true,
    },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'cors');
  assertStringIncludes(code, 'localhost');
});

Deno.test('renderEntry: default CORS warns with config entry and security impact', () => {
  resetCorsOriginWarningForTests();
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...values: unknown[]) => warnings.push(values.map(String).join(' '));
  try {
    const desc = buildEntryDescriptor(basicRoutes, { middleware: { cors: true } });
    renderEntry(desc);
  } finally {
    console.warn = originalWarn;
  }
  assertStringIncludes(warnings.join('\n'), 'middleware.corsOrigin');
  assertStringIncludes(warnings.join('\n'), 'production');
});

Deno.test('renderEntry: explicit CORS config is silent', () => {
  resetCorsOriginWarningForTests();
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...values: unknown[]) => warnings.push(values.map(String).join(' '));
  try {
    const desc = buildEntryDescriptor(basicRoutes, {
      middleware: { cors: true, corsOrigin: 'https://example.com' },
    });
    renderEntry(desc);
  } finally {
    console.warn = originalWarn;
  }
  assertEquals(warnings, []);
});

Deno.test('renderEntry: securityHeaders middleware', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      securityHeaders: true,
    },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'secureHeaders');
});

Deno.test('renderEntry: requestId middleware', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      requestId: true,
    },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'requestId');
});

Deno.test('renderEntry: logger middleware', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      logger: true,
    },
  });
  const code = renderEntry(desc);

  assertStringIncludes(code, 'honoLogger');
});

Deno.test('renderEntry: no middleware generates clean app', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      requestId: false,
      logger: false,
      cors: false,
      securityHeaders: false,
    },
  });
  const code = renderEntry(desc);

  assertEquals(code.includes('cors'), false);
  assertEquals(code.includes('secureHeaders'), false);
  assertEquals(code.includes('requestId'), false);
  assertEquals(code.includes('honoLogger'), false);
});

Deno.test('renderEntry: SSG mode disabled by default', () => {
  const desc = buildEntryDescriptor(basicRoutes);
  const code = renderEntry(desc);

  assertEquals(code.includes('install-global-dom-shim'), false);
});

// Section

Deno.test('renderEntry: local island with ssr===true is registered in SSR', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    ssg: true,
    islandTagNames: ['my-counter'],
    islandFiles: ['my-counter.ts'],
  });
  // Mark island as ssr: true
  desc.islands[0].ssr = true;
  const code = renderEntry(desc);

  // SSR registration should happen (#952: via the ownership-tracked helper)
  assertStringIncludes(code, '__registerSsrComponent("my-counter"');
});

Deno.test('renderEntry: local island with ssr===false is excluded from SSR registration', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    ssg: true,
    islandTagNames: ['client-only-widget'],
    islandFiles: ['client-only-widget.ts'],
    islandMeta: {
      'client-only-widget': { ssr: false },
    },
  });
  const code = renderEntry(desc);

  // SSR registration should NOT happen for ssr:false islands
  assertFalse(code.includes('__registerSsrComponent("client-only-widget"'));
  assertFalse(code.includes('import * as __island_client_only_widget from'));
  // But it should still be in the island map for client-side upgrade
  assertStringIncludes(code, 'client-only-widget');
});

Deno.test('renderEntry: package island with ssr===false excluded from SSR but in island map', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    ssg: true,
    packageManifests: [
      {
        schemaVersion: '1.0.0',
        packageName: '@acme/components',
        version: '0.17.0',
        declarations: [
          {
            tagName: 'open-layout',
            className: 'OpenLayout',
            openElement: { module: '@acme/components/open-layout', hydrate: 'load', ssr: true },
          },
          {
            tagName: 'open-widget',
            className: 'OpenWidget',
            openElement: { module: '@acme/components/open-widget', hydrate: 'idle', ssr: false },
          },
        ],
      },
    ],
  });
  const code = renderEntry(desc);

  // v0.17.4: Package islands with ssr:true are now SSR-registered
  // (#952: via the ownership-tracked helper)
  assertStringIncludes(code, '__registerSsrComponent("open-layout"');
  // Package islands with ssr:false remain client-only
  assertFalse(code.includes('__registerSsrComponent("open-widget"'));
  // But both should be in the island map
  assertStringIncludes(code, '"open-layout": "@acme/components/open-layout"');
  assertStringIncludes(code, '"open-widget": "@acme/components/open-widget"');
});

Deno.test('buildEntryDescriptor: ssr field is extracted from manifest declarations', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    packageManifests: [
      {
        schemaVersion: '1.0.0',
        packageName: '@acme/components',
        version: '0.17.0',
        declarations: [
          {
            tagName: 'ssr-component',
            className: 'SsrComponent',
            openElement: { module: '@acme/components/ssr-component', ssr: true },
          },
          {
            tagName: 'client-only-component',
            className: 'ClientOnlyComponent',
            openElement: { module: '@acme/components/client-only-component', ssr: false },
          },
          {
            tagName: 'default-component',
            className: 'DefaultComponent',
            openElement: { module: '@acme/components/default-component' },
          },
        ],
      },
    ],
  });

  const ssrComp = desc.islands.find((i) => i.tagName === 'ssr-component');
  const clientOnly = desc.islands.find((i) => i.tagName === 'client-only-component');
  const defaultComp = desc.islands.find((i) => i.tagName === 'default-component');

  assertEquals(ssrComp?.ssr, true);
  assertEquals(clientOnly?.ssr, false);
  assertEquals(defaultComp?.ssr, undefined); // no ssr field in manifest -> undefined
});

// ─── 0.42.0-alpha.2 (ADR-0120): action protocol codegen ───────────────────

Deno.test('renderEntry: action POST follows the ADR-0120 protocol', () => {
  const desc = buildEntryDescriptor(basicRoutes, {});
  const code = renderEntry(desc);

  // The action runs before the loader (revalidation invariant): a mutation
  // never renders stale loader data.
  const actionIndex = code.indexOf('const actionOutcome = __classifyActionResult(await actionFn');
  const loaderIndex = code.indexOf('const __data =', actionIndex);
  assertEquals(actionIndex > 0, true, 'action execution must be emitted');
  assertEquals(loaderIndex > actionIndex, true, 'loader must run after the action on POST');

  // Real FormData (not parseBody objects), fail() 422 channel, PRG 303 on
  // success, named actions via ?/name, fetch-path ActionResult JSON.
  assertStringIncludes(code, 'await c.req.raw.formData()');
  assertStringIncludes(code, "actionOutcome.kind === 'failure'");
  assertStringIncludes(code, 'response: c.redirect(prgTarget, 303)');
  assertStringIncludes(code, "key.startsWith('/')");
  assertStringIncludes(code, 'namedActions[actionName]');
  // #743: generated code references the shared ACTION_FETCH_HEADER constant
  // (single source of truth in @openelement/element) instead of a literal.
  assertStringIncludes(code, 'ACTION_FETCH_HEADER as __actionFetchHeader');
  assertStringIncludes(code, 'c.req.header(__actionFetchHeader)');
  assertStringIncludes(
    code,
    'if (JSON.stringify(data) === undefined) data = null;',
  );
  assertStringIncludes(
    code,
    "{ type: 'failure', status: actionOutcome.status, data }",
  );
  assertStringIncludes(code, ', __actionStatus)');
  // No action export on a route: POST is a defined 404, not a render.
  assertStringIncludes(code, 'This route does not accept submissions.');
});

// ─── 0.42.0-alpha.5 (ADR-0121): protocol hardening codegen ─────────────────

Deno.test('renderEntry: ADR-0121 hardening is present in the action codegen', () => {
  const desc = buildEntryDescriptor(basicRoutes, {});
  const code = renderEntry(desc);

  // #611: default same-origin CSRF floor on generated action POST
  assertStringIncludes(code, 'sec-fetch-site');
  assertStringIncludes(code, 'cross-site');
  assertStringIncludes(code, 'OPEN_ELEMENT_DISABLE_CSRF');
  assertStringIncludes(code, 'Cross-site form submission rejected');
  assertStringIncludes(code, 'loadContext.env');

  // #542: named-action dispatch is own-key gated (prototype keys are 404).
  assertStringIncludes(code, 'Object.prototype.hasOwnProperty.call(namedActions, actionName)');
  // #541: App owns returned-Response rejection; generated Hono code consumes
  // the canonical action classifier instead of redefining the contract.
  assertStringIncludes(code, '__classifyActionResult(await actionFn');
  assertEquals(code.includes('actionResult instanceof Response'), false);
  // #548: the default PRG target strips the ?/name action marker.
  assertStringIncludes(code, 'prgParams.delete(key)');
  assertStringIncludes(code, "{ type: 'redirect', status: 303, location: prgTarget }");
  // #549 + #863: fetch callers receive an RFC 9457 problem+json 404, not an
  // HTML page.
  assertStringIncludes(
    code,
    "{ type: 'about:blank', title: 'Not Found', status: 404, detail: message }",
  );
  assertStringIncludes(code, "{ 'Content-Type': __problemJsonMediaType }");
  // #550: request-time responses are never cacheable; POST is negotiated.
  assertStringIncludes(code, "c.header('Cache-Control', 'no-store');");
  assertStringIncludes(code, "c.header('Vary', __actionFetchHeader);");
  // #943: successful GET pages relax to private,no-cache (bfcache/scroll
  // restoration); the no-store baseline above still guards every other kind.
  assertStringIncludes(code, "c.header('Cache-Control', 'private, no-cache');");
  // #558: the JSON error channel scrubs internals in production.
  assertStringIncludes(code, "import.meta.env.PROD ? 'Internal Server Error' : String(err");
  // #568: action POSTs carry a default body limit.
  assertStringIncludes(code, '__bodyLimit({ maxSize: 10 * 1024 * 1024');
  // #572: non-GET/POST methods on page routes are a defined 405.
  assertStringIncludes(code, "app.all('*', __createRouteMiddleware([");
});

Deno.test('renderEntry: action protocol is emitted once for many routes (#1098)', () => {
  const routes: RouteEntry[] = Array.from({ length: 30 }, (_, index) => ({
    path: `/page-${index}`,
    filePath: `page-${index}.ts`,
    type: 'page',
    varName: `page${index}`,
  }));
  const code = renderEntry(buildEntryDescriptor(routes));
  assertEquals(code.match(/async function __runActionProtocol/g)?.length, 1);
  assertEquals(code.match(/const csrfOff =/g)?.length, 1);
  assertEquals(code.match(/await __runActionProtocol\(/g)?.length, routes.length);
});

Deno.test('renderEntry: private,no-cache is emitted only after a successful render (#943 amendment)', () => {
  const desc = buildEntryDescriptor(basicRoutes, {});
  const code = renderEntry(desc);

  // The Cache-Control relaxation must sit between the shell render and the
  // response return: emitted BEFORE __renderAppShell it leaks onto the
  // redirect/notFound/error responses produced by the catch block below.
  const renderIndex = code.indexOf('__renderAppShell(__content,');
  const relaxIndex = code.indexOf("c.header('Cache-Control', 'private, no-cache');");
  const returnIndex = code.indexOf(
    'return c.html(__withDevClientScript(wrapInDocument(content, {',
    relaxIndex,
  );
  assertEquals(renderIndex > 0, true, 'shell render must be emitted');
  assertEquals(relaxIndex > renderIndex, true, 'private,no-cache must follow the shell render');
  assertEquals(returnIndex > relaxIndex, true, 'private,no-cache must precede the 200 return');
});

Deno.test('renderEntry: dev client script also wraps notFound/error HTML responses (#1067)', () => {
  const routes: RouteEntry[] = [
    ...basicRoutes,
    { path: '/404', filePath: '404.ts', type: 'page', varName: 'page404' },
  ];
  const code = renderEntry(buildEntryDescriptor(routes, {}));

  // #951 parity: prod injects the island client entry into every HTML
  // response (post-build injectClientScript + serve-time withClientScript),
  // so dev must run the same __withDevClientScript on the 404/error channels,
  // not only on the successful GET page.
  assertStringIncludes(
    code,
    'return c.html(__withDevClientScript(wrapInDocument(__statusHtml("404 Not Found", err.message || "Not Found"), {',
  );
  assertStringIncludes(code, 'return c.html(__withDevClientScript(wrapInDocument(errorContent, {');
  const notFoundBody = code.slice(code.indexOf('app.notFound('));
  assertStringIncludes(
    notFoundBody,
    'return c.html(__withDevClientScript(wrapInDocument(content, {',
  );
  assertStringIncludes(
    notFoundBody,
    'return c.html(__withDevClientScript(wrapInDocument(__statusHtml("404 Not Found", "Not Found"), {',
  );
});

Deno.test('renderEntry: hasAction codegen covers named `actions` exports (#539)', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  // The routeInfo hasAction flag must be true for a route exporting ONLY a
  // named `actions` map — otherwise the prerender hard rule is bypassable.
  assertStringIncludes(code, 'hasAction: (typeof');
  assertStringIncludes(code, '.actions === "object" &&');
});

Deno.test('renderEntry: action catch paths answer fetch callers (redirect as ActionResult, errors as problem+json)', () => {
  const desc = buildEntryDescriptor(basicRoutes, {});
  const code = renderEntry(desc);

  // Redirects out of a POST action are coerced to 303 (PRG) — every 3xx,
  // per ADR-0121 — including the ActionResult redirect shape; GET handlers
  // keep the author's status.
  assertStringIncludes(code, 'const __redirectStatus = 303;');
  assertStringIncludes(
    code,
    "{ type: 'redirect', status: __redirectStatus, location: err.location }",
  );
  assertStringIncludes(
    code,
    '{ type: \'about:blank\', title: "Internal Server Error", status: 500, detail: import.meta.env.PROD',
  );
});

// Fetch middleware contract (ADR-0123 item 2, #858)

Deno.test('renderEntry: middleware.use composes at the handler boundary (#858)', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      use: [
        async (_request, next) => {
          const response = await next();
          response.headers.set('x-outer', '1');
          return response;
        },
      ],
    },
  });
  const code = renderEntry(desc);

  assertStringIncludes(
    code,
    "import { composeFetchMiddleware } from '@openelement/element/build-utils';",
  );
  assertStringIncludes(code, 'const __openElementFetchMiddleware = [');
  // The user middleware source is inlined into the generated entry.
  assertStringIncludes(code, "response.headers.set('x-outer', '1')");
  assertStringIncludes(
    code,
    'export const openElementHandler = composeFetchMiddleware(' +
      '__openElementFetchMiddleware, __openElementBaseHandler)',
  );
  // Dev-server boundary export (@hono/vite-dev-server reads it via the
  // `export` option when middleware.use is configured).
  assertStringIncludes(code, 'export const openElementDevFetch = {');
  // The raw Hono app stays the default export — SSG prerender is unchanged.
  assertStringIncludes(code, 'export default app');
});

Deno.test('renderEntry: no middleware.use keeps the pre-#858 handler shape', () => {
  const desc = buildEntryDescriptor(basicRoutes);
  const code = renderEntry(desc);

  assertFalse(code.includes('composeFetchMiddleware'));
  assertFalse(code.includes('openElementDevFetch'));
  assertStringIncludes(code, 'export const openElementHandler = (request, context = {}) => {');
});

Deno.test('renderEntry: corsOrigin warning is emitted once per process (#925)', () => {
  resetCorsOriginWarningForTests();
  const desc = buildEntryDescriptor(basicRoutes);
  const calls: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: string) => calls.push(String(msg));
  try {
    renderEntry(desc);
    renderEntry(desc);
  } finally {
    console.warn = originalWarn;
  }
  const warnings = calls.filter((c) => c.includes('middleware.corsOrigin is not configured'));
  assertEquals(
    warnings.length,
    1,
    'configResolved + buildStart both render the entry; warning must dedupe',
  );
});

Deno.test('renderEntry: /404 page route emits the styled notFound fallback (#923)', () => {
  const routes: RouteEntry[] = [
    { path: '/', filePath: 'index.ts', type: 'page', varName: 'pageIndex' },
    { path: '/404', filePath: '404.tsx', type: 'page', varName: 'page404' },
  ];
  const code = renderEntry(buildEntryDescriptor(routes));
  assertStringIncludes(code, 'app.notFound(async (c) => {');
  assertStringIncludes(code, '// Styled 404 (#923)');
  assertStringIncludes(code, 'page404.loader === "function"');
  assertStringIncludes(code, '__renderAppShell(__content, c.req.path || "/404",');
  // Fallback renders with a forced 404 status and degrades to the plain
  // status page on failure — never a 500 from the fallback itself.
  assertStringIncludes(code, 'wrapInDocument(content, {');
  assertStringIncludes(code, '})), 404)');
  assertStringIncludes(code, '__statusHtml("404 Not Found", "Not Found")');
});

Deno.test('renderEntry: no /404 route keeps the bare 404 fallback (#923)', () => {
  const code = renderEntry(buildEntryDescriptor(basicRoutes));
  assertFalse(code.includes('app.notFound('));
});
