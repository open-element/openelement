/**
 * @openelement/router - Entry renderer snapshot tests (Deno)
 *
 * Snapshot tests for renderEntry output covering:
 * - CSP middleware (with/without nonce)
 * - _renderer.ts / _middleware.ts special routes
 * - Island upgrade strategies (load/idle/visible/only)
// Package islands
// Code structure validation
 */

import { expect, test } from 'vitest';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import { resetCorsOriginWarningForTests } from '../src/vite/internal/ssg/entry-server-codegen.ts';
import { createAppShellRuntime } from '../src/vite/internal/server-runtime/document-runtime.ts';
import { routeMeta } from '../src/vite/internal/server-runtime/page-render.ts';
import type { RouteEntry } from '../src/vite/internal/protocol/framework.ts';

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

test('renderEntry: CSP without nonce generates header middleware', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      csp: {
        policy: "default-src 'self'; script-src 'self'",
      },
    },
  });
  const code = renderEntry(desc);

  expect(code).toContain('Content-Security-Policy');
  expect(code).toContain("default-src 'self'; script-src 'self'");
  // No nonce middleware when not configured - c.get('cspNonce') returns undefined
  expect(code.includes('crypto.randomUUID()')).toEqual(false);
  // cspNonce is always passed to wrapInDocument but will be undefined
  // when no CSP nonce middleware is configured
  expect(code).toContain("cspNonce: c.get('cspNonce')");
});

test('renderEntry: does not emit the retired duplicate /_data loader protocol (#987)', () => {
  const code = renderEntry(buildEntryDescriptor(basicRoutes, {}));

  // No second generated loader endpoint (/_data, __dataRouteMap): it had no
  // consumer and lost params/headers/control flow (#987). Request-time
  // navigation uses the canonical page route; RouteConfig carries no loader —
  // client-side data fetching is not a second loader protocol.
  expect(code.includes('/_data')).toBeFalsy();
  expect(code.includes('__dataRouteMap')).toBeFalsy();
});

test('buildEntryDescriptor: catch-all param names come from the scanner, not the path pattern (#1022)', () => {
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
  expect(route.paramNames).toEqual(['path']);

  // Hand-built descriptors without scanner params fall back to derivation
  // that strips the regex body instead of capturing it.
  const { params: _scannerParams, ...withoutParams } = catchAllRoutes[0];
  const fallback = buildEntryDescriptor([withoutParams], {});
  expect(fallback.pageRoutes[0].paramNames).toEqual(['path']);
});

test('renderEntry: CSP with nonce generates per-request nonce', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      csp: {
        policy: "default-src 'self'",
        nonce: true,
      },
    },
  });
  const code = renderEntry(desc);

  // ADR-0160 rule a: nonce creation and policy instantiation are calls into
  // the imported @openelement/router/server-runtime module; the template is
  // generated data (the nonce semantics themselves are pinned by
  // server-runtime-response-channel.test.ts). The hono/ssg prerender pass
  // binds no nonce — static bytes cannot be per-request — so binding is
  // gated on __ssgPrerenderPass(c.env) and both the context variable and
  // the CSP header only materialize for request-time dispatches.
  expect(code).toContain(
    'const nonce = __ssgPrerenderPass(c.env) ? undefined : __cspCreateNonce()',
  );
  expect(code).toContain("if (nonce) c.set('cspNonce', nonce)");
  expect(code).toContain("if (policy) c.header('Content-Security-Policy', policy)");
  // v0.3.1: NONCE_PLACEHOLDER template approach (fixes missing closing quote bug)
  expect(code).toContain('NONCE_PLACEHOLDER');
  expect(code).toContain(
    `const policy = nonce ? __cspApplyNonce("default-src 'self'; script-src 'nonce-NONCE_PLACEHOLDER'", nonce) : undefined`,
  );
});

test('renderEntry: CSP report-only mode', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      csp: {
        policy: "default-src 'self'",
        reportOnly: true,
      },
    },
  });
  const code = renderEntry(desc);

  expect(code).toContain('Content-Security-Policy-Report-Only');
  expect(code.includes('Content-Security-Policy"')).toEqual(false);
});

test('buildEntryDescriptor: CSP config is serialized into descriptor', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      csp: {
        policy: "default-src 'self'; script-src 'self'",
        nonce: true,
      },
    },
  });

  const cspMw = desc.middleware.find((m) => m.kind === 'csp');
  expect(cspMw).toEqual(expect.anything());
  expect(cspMw.config?.csp?.policy).toEqual("default-src 'self'; script-src 'self'");
  expect(cspMw.config?.csp?.nonce).toEqual(true);
});

// Section

test('renderEntry: _renderer.ts generates wrap call', () => {
  const desc = buildEntryDescriptor(withSpecialRoutes);
  const code = renderEntry(desc);

  // Renderers should appear in descriptor
  expect(desc.renderers.length >= 2).toEqual(true);
  // Generated code should reference renderer variable names
  expect(code).toContain('$specialRenderer');
  expect(code).toContain('$guideRenderer');
  // Renderer wrap call receives the rendered page HTML and c (Hono context)
  expect(code).toContain('.default.wrap(__content, c)');
});

test('renderEntry: _middleware.ts generates an app.use scope with the WinterCG adapter', () => {
  const desc = buildEntryDescriptor(withSpecialRoutes);
  const code = renderEntry(desc);

  // Middleware scopes should appear in descriptor
  expect(desc.middlewareScopes.length >= 1).toEqual(true);
  // Generated code should reference middleware variable name
  expect(code).toContain('$apiMiddleware');
  expect(code).toContain('app.use(');
  // The author-facing contract is the WinterCG shape (request, next); the
  // entry adapts it into the Hono chain in place.
  expect(code).toContain(
    'app.use("/api/*", (c, next) => $apiMiddleware.default(c.req.raw, async () => { await next(); return c.res; }))',
  );
});

test('buildEntryDescriptor: special routes are separated from page/api', () => {
  const desc = buildEntryDescriptor(withSpecialRoutes);

  // Special routes should NOT be in apiRoutes or pageRoutes; they go to renderers/middlewareScopes
  expect(desc.apiRoutes.length > 0).toEqual(true);
  expect(desc.pageRoutes.length > 0).toEqual(true);

  // They should appear as renderers and middlewareScopes instead
  expect(desc.renderers.length + desc.middlewareScopes.length >= 3).toEqual(true); // _renderer x2 + _middleware x1
});

// Island upgrade strategy tests

test('buildEntryDescriptor: upgradeStrategy is recorded (load)', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    islandTagNames: ['my-counter'],
    upgradeStrategy: 'load',
  });

  expect(desc.upgradeStrategy).toEqual('load');
});

test('buildEntryDescriptor: upgradeStrategy is recorded (visible)', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    islandTagNames: ['idle-image'],
    upgradeStrategy: 'visible',
  });

  expect(desc.upgradeStrategy).toEqual('visible');
});

test('buildEntryDescriptor: default upgradeStrategy is idle', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    islandTagNames: ['my-counter'],
  });

  // Default should be 'idle'
  expect(desc.upgradeStrategy).toEqual('idle');
});

// Package islands

// Package islands

test('renderEntry: package islands are included in island upgrade entry', () => {
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

  expect(code).toContain('open-layout');
  expect(code).toContain('open-button');
  expect(code).toContain('@acme/components');
});

test('renderEntry: package islands are not imported by SSR entry', () => {
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

  expect(code).toContain('"open-layout": "@acme/components/open-layout"');
  expect(
    code.includes("import * as __island_kiss_layout from '@acme/components/open-layout'"),
  ).toBeFalsy();
  expect(code.includes('__kiss_get_default_export')).toBeFalsy();
  expect(code.includes("customElements.define('open-layout'")).toBeFalsy();
  expect(code.includes('__island_kiss_layout.default')).toBeFalsy();
  expect(code.includes('__island_kiss_button.default')).toBeFalsy();
});

// Code structure validation

test('renderEntry: no bare process.env references', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: { corsOrigin: 'https://example.com' },
  });
  const code = renderEntry(desc);

  const codeLines = code
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
  expect(
    codeLines.some((l) => l.includes('process.env')),
    'Generated code must not contain process.env calls',
  ).toBeFalsy();
});

test('renderEntry: API routes support method-keyed WinterCG handlers and direct functions', () => {
  const desc = buildEntryDescriptor(basicRoutes);
  const code = renderEntry(desc);

  expect(code).toContain('app.all("/api/hello"');
  expect(code).toContain(
    '__apiRouteRecords.push({ id: "api/hello.ts", path: "/api/hello", handlers: $apiHello.default })',
  );
  expect(code).toContain('request: c.req.raw');
  expect(code.includes('app.route("/api/hello"')).toEqual(false);
  expect(code.includes('app.get("/api/hello"')).toEqual(false);
});

test('renderEntry: exports default app', () => {
  const desc = buildEntryDescriptor(basicRoutes);
  const code = renderEntry(desc);

  expect(code).toContain('export default app');
});

test('renderEntry: imports DSD renderer; Hono assembly is the factory (#1470 block e)', () => {
  const desc = buildEntryDescriptor(basicRoutes);
  const code = renderEntry(desc);

  // ADR-0160 rule a: `new Hono()` moved into createGeneratedApp — the entry
  // no longer imports Hono or builds the app itself.
  expect(code.includes("from 'hono'")).toBeFalsy();
  expect(code).toContain('const __app = createGeneratedApp({');
  expect(code).toContain('export default app');
  // v0.5.0: DSD renderer replaces @lit-labs/ssr; v0.44: the compiled sync
  // renderDsd is the only serializer — no runtime JSX or tree renderer.
  expect(code).toContain(
    "import { createDeferredDsdExecutor, renderDsd, trustedHtml, escapeHtml, wrapInDocument } from '@openelement/element'",
  );
  expect(code.includes('renderDsdTree')).toBeFalsy();
  expect(code.includes("import { jsx } from '@openelement/element'")).toBeFalsy();
  // Element owns document/head/body semantics; generated entries only call it.
  expect(code.includes('function wrapInDocument(html, options = {}) {')).toBeFalsy();
});

test('renderEntry: app shell composes the page host through the compiled serializer', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    ssg: true,
    appShell: { tagName: 'open-layout', import: '@acme/components/open-layout', props: {} },
  });
  const code = renderEntry(desc);

  // The shell composition is typed runtime code; the entry pins the plan data
  // in the factory config and the factory binds the runtime (ADR-0160 rule a,
  // #1470 block e — the wiring line moved into createGeneratedApp).
  expect(code).toContain('"tagName": "open-layout"');
  expect(code).toContain('import * as __shell_0 from "@acme/components/open-layout";');
  expect(code).toContain('appShellPlan: {');
  // The slot claim contract stays pinned on the shipped runtime: the shell
  // renders through the page renderer with the content as trusted slot HTML.
  const { runtime, ssrCalls } = loadLayoutRuntime({
    default: { tagName: 'open-layout', props: { brand: 'acme' } },
    layouts: {},
  });
  const composed = runtime.renderAppShell('<page></page>', '/guide');
  expect(composed).toEqual('<shell>open-layout</shell>');
  expect(ssrCalls).toEqual([
    {
      tag: 'open-layout',
      props: {
        currentPath: '/guide',
        locale: 'en',
        locales: ['en'],
        navItems: [],
        headerNav: [],
        homeHref: '/',
        home: undefined,
        routeMeta: {},
        brand: 'acme',
      },
      route: '/guide',
    },
  ]);
  expect(code.includes('layoutHtml.slice')).toBeFalsy();
});

test('renderEntry: unconfigured appShell defaults to false (no import)', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  expect(code.includes('import "@acme/components/open-layout";')).toBeFalsy();
  expect(code).toContain('"default": false');
  // An unresolved shell returns route content unchanged (shipped runtime).
  const { runtime, ssrCalls } = loadLayoutRuntime({ default: false, layouts: {} });
  expect(runtime.renderAppShell('<page></page>', '/')).toEqual('<page></page>');
  expect(ssrCalls).toEqual([]);
});

test('renderEntry: appShell false renders route content without default layout import', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true, appShell: false });
  const code = renderEntry(desc);

  expect(code.includes('import "@acme/components/open-layout";')).toBeFalsy();
  expect(code).toContain('"default": false');
  const { runtime, ssrCalls } = loadLayoutRuntime({ default: false, layouts: {} });
  expect(runtime.renderAppShell('<page></page>', '/')).toEqual('<page></page>');
  expect(ssrCalls).toEqual([]);
});

test('renderEntry: custom appShell import and props are generated from config', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    ssg: true,
    appShell: {
      tagName: 'blog-layout',
      import: './app/components/blog-layout.tsx',
      props: { siteName: 'Field Notes' },
    },
  });
  const code = renderEntry(desc);

  expect(code).toContain('import * as __shell_0 from "/app/components/blog-layout.tsx";');
  expect(code).toContain('"tagName": "blog-layout"');
  expect(code).toContain('"siteName": "Field Notes"');
});

test('renderEntry: route meta layout can select named layouts', () => {
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

  expect(code).toContain('import * as __shell_0 from "/app/components/post-layout.tsx";');
  // The named-layout lookup lives in the typed app-shell runtime; the entry
  // pins the plan data in the factory config (ADR-0160 rule a, #1470 block e).
  expect(code).toContain('"post-layout"');
  expect(code).toContain('appShellPlan: {');
  expect(code).toContain('module: $pageIndex');
});

// Behavior-level proof for the named-layout wiring: execute the shipped typed
// runtime (routeMeta + the app-shell runtime) with the same plan shape the
// entry binds (ADR-0160 rule a).
function loadLayoutRuntime(appShellPlan: { default: unknown; layouts: Record<string, unknown> }) {
  const ssrCalls: Array<{ tag: string; props: Record<string, unknown>; route: string }> = [];
  const runtime = createAppShellRuntime({
    ssr: (tag, props, sourceInfo) => {
      ssrCalls.push({
        tag,
        props: props ?? {},
        route: sourceInfo?.route ?? '',
      });
      return '<shell>' + tag + '</shell>';
    },
    trustedHtml: (html) => ({ html }),
    appShellPlan: appShellPlan as never,
    locales: ['en'],
    navSections: [],
    headerNav: [],
    defaultLocale: 'en',
  });
  return { runtime, ssrCalls };
}

function pageModule(layout: string | false | undefined): unknown {
  return {
    default: {
      openElementPage: layout === undefined ? {} : { route: { layout } },
    },
  };
}

test('routeMeta surfaces route.layout and resolveAppShell selects the named layout', () => {
  const defaultShell = { tagName: 'main-shell' };
  const postShell = { tagName: 'post-layout' };
  const { runtime } = loadLayoutRuntime({
    default: defaultShell,
    layouts: { post: postShell },
  });
  const meta = routeMeta(pageModule('post'));
  expect(meta.layout).toEqual('post');
  expect(runtime.resolveAppShell(meta)).toEqual({ tagName: 'post-layout' });
});

test('resolveAppShell: layout false disables the shell, unknown names fall back to default', () => {
  const defaultShell = { tagName: 'main-shell' };
  const { runtime } = loadLayoutRuntime({
    default: defaultShell,
    layouts: { post: { tagName: 'post-layout' } },
  });
  expect(runtime.resolveAppShell(routeMeta(pageModule(false)))).toEqual(false);
  expect(runtime.resolveAppShell(routeMeta(pageModule('no-such-layout')))).toEqual({
    tagName: 'main-shell',
  });
  // Unset layout: no layout key in the meta, default shell applies.
  const meta = routeMeta(pageModule(undefined));
  expect('layout' in meta).toEqual(false);
  expect(runtime.resolveAppShell(meta)).toEqual({ tagName: 'main-shell' });
});

test('renderEntry: definePage descriptor feeds load and metadata wiring', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  expect(code).toContain('let __page = __pageDefinition($pageIndex)');
  expect(code).toContain(
    'const __data = typeof $pageIndex.loader === "function" ? await $pageIndex.loader(__loadContext) : undefined',
  );
  // v0.44 (ADR-0143): request-scoped data reaches the compiled page ONLY
  // through the descriptor's props projector — the compiled serializer maps
  // declared compiled properties onto the host; the legacy __openElement*
  // host-prop channel is gone (the #1129/#1130 guarantee is structural).
  // #1326: the request-scoped context is built once and feeds both the props
  // projector and the resolved-Document seam.
  expect(code).toContain(
    'const __pageContext = { data: __data, actionData: undefined, params: __params, request: c.req.raw, locale: __localeFromPath(__locales, c.req.path, __getDefaultLocale()), route: __routeContext, meta: __routeMetaValue };',
  );
  expect(code).toContain(
    'const __doc = __resolvePageDocument(__page.head, __pageContext, __clientScriptDescriptors());',
  );
  expect(code).toContain(
    "import { resolvePageDocument as __resolvePageDocument } from '@openelement/router/document'",
  );
  expect(code).toContain('__ssr(__tag, __pageProps($pageIndex, __pageContext)');
  expect(code.includes('__openElementData')).toBeFalsy();
  expect(code.includes('module?.meta')).toEqual(false);
  // Named layouts (ADR-0123): the descriptor's route.layout is the producer
  // for the routeMeta.layout the app-shell resolver reads. The extractor is
  // imported runtime (ADR-0160 rule a); the entry pins the import binding.
  expect(code).toContain(
    "import { routeMeta as __routeMeta } from '@openelement/router/server-runtime'",
  );
  expect(code).toContain('title: __doc.title || "openElement"');
  expect(code).toContain('meta: { description: __doc.description, tags: __doc.meta },');
  expect(code).toContain('links: __doc.links,');
  expect(code).toContain('structuredData: __doc.structuredData || [],');
  expect(code).toContain('dangerouslyHeadFragments: __doc.dangerouslyHeadFragments || [],');
  // The page-definition extractor is imported runtime (ADR-0160 rule a):
  // the entry pins the binding, not a local function body.
  expect(code).toContain(
    "import { pageDefinition as __pageDefinition } from '@openelement/router/server-runtime'",
  );
  // The lifecycle guards stay the authoring imports; the action protocol
  // constants and classifier moved into the server-runtime action module
  // (ADR-0160 rule a, #1470 block c).
  expect(code).toContain(
    "import { isOpenElementRedirect as __isOpenElementRedirect, isOpenElementNotFound as __isOpenElementNotFound } from '@openelement/router';",
  );
  expect(code.includes('function __isOpenElementRedirect(error) {')).toBeFalsy();
  expect(code.includes('function __isOpenElementNotFound(error) {')).toBeFalsy();
  expect(code).toContain(
    'data = typeof info.module.loader === "function" ? await info.module.loader(loadContext) : undefined;',
  );
  expect(code).toContain('__pageProps(info.module, __pageContext)');
  expect(code).toContain(
    'const __doc = __resolvePageDocument(page.head, __pageContext, __clientScriptDescriptors());',
  );
  expect(code).toContain('filePath: "index.ts"');
  expect(code).toContain(
    'rendering: (__pageDefinition($pageIndex).renderIntent?.mode || "static")',
  );
  expect(code).toContain('title: title || __doc.title || "openElement"');
  // #1217: ISR semantics were removed in v0.44 — generated route metadata
  // must not carry a revalidate field.
  expect(code.includes('revalidate')).toBeFalsy();
});

test('renderEntry: lifecycle control produces redirect and not-found responses', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  expect(code).toContain('return c.redirect(err.location, err.status)');
  expect(code).toContain('__statusHtml("404 Not Found", err.message || "Not Found")');
  expect(code).toContain('redirect: { location: error.location, status: error.status }');
  expect(code).toContain('notFound: true');
  expect(code).toContain('__pageErrorProps($pageIndex, err,');
});

test('renderEntry: SSG renderRoute renders the page error component on failure', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  // Parity with the dev/server route handler: a page declaring an error
  // component renders it with __openElementError inside the SSG renderRoute
  // catch, and the failure still surfaces as a 500 result carrying the
  // RenderError (no silent normal-page write).
  expect(code).toContain('if (typeof page.error === "function") {');
  expect(code).toContain('__pageErrorProps(info.module, error,');
  expect(code).toContain('__renderAppShell(__ssr(info.tagName,');
  expect(code).toContain(
    'return { html: errorHtml, status: 500, errors: [renderError], componentCount: errorComponentCount, renderTimeMs };',
  );
  // A failing error renderer falls back to the plain 500 status page.
  expect(code).toContain("'[openElement] Route error renderer failed for ' + routePath + ':'");
  expect(code).toContain('__statusHtml("500 Internal Server Error", detail)');
  // The routeInfo emission no longer carries the dead streaming contract.
  expect(code.includes('renderIntent?.streaming')).toBeFalsy();
});

test('renderEntry: uses descriptor SSR admission plan without recomputing it', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    ssg: true,
    islandTagNames: ['planned-widget'],
    islandFiles: ['planned-widget.ts'],
  });
  desc.ssrAdmissionPlan.renderableTags = [];
  desc.ssrAdmissionPlan.clientOnlyTags = ['planned-widget'];
  desc.ssrAdmissionPlan.reasons['planned-widget'] = 'test override';

  const code = renderEntry(desc);

  expect(code.includes('import * as __island_planned_widget from')).toBeFalsy();
  expect(code.includes("customElements.define('planned-widget'")).toBeFalsy();
  expect(code).toContain('"clientOnlyTags": [\n    "planned-widget"\n  ]');
});

test('renderEntry: SSG mode includes no DOM shim (DSD renderer)', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  // v0.5.0: DSD renderer doesn't need DOM shim - pure string concatenation
  expect(code.includes('install-global-dom-shim')).toEqual(false);
});

// Section

test('renderEntry: CSP flows through full pipeline', () => {
  const code = renderEntry(
    buildEntryDescriptor(basicRoutes, {
      middleware: {
        csp: {
          policy: "default-src 'self'; script-src 'self' 'unsafe-inline'",
          nonce: false,
        },
      },
    }),
  );

  expect(code).toContain('Content-Security-Policy');
  expect(code).toContain("default-src 'self'");
  expect(code).toContain('export default app');
});

test('renderEntry: complex scenario with all features', () => {
  const code = renderEntry(
    buildEntryDescriptor(withSpecialRoutes, {
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
    }),
  );

  // All features present
  expect(code).toContain('Content-Security-Policy');
  expect(code).toContain('__cspCreateNonce()');
  expect(code).toContain('"https://example.com"');
  expect(code).toContain('_renderer');
  expect(code).toContain('_middleware');
  expect(code).toContain('open-layout');
  expect(code).toContain('lang: "zh-CN"');
  expect(code).toContain('openElement');
  expect(code).toContain('/styles.css');
  // No process.env
  const codeLines = code.split('\n').filter((l) => !l.trimStart().startsWith('//'));
  expect(codeLines.some((l) => l.includes('process.env'))).toBeFalsy();
});

// Section

test('renderEntry: CSP nonce with existing script-src in policy', () => {
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
  expect(code).toContain('NONCE_PLACEHOLDER');
  expect(code).toContain("script-src 'nonce-NONCE_PLACEHOLDER'");
});

test('renderEntry: CSP nonce without existing script-src', () => {
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
  expect(code).toContain('NONCE_PLACEHOLDER');
  expect(code).toContain("script-src 'nonce-NONCE_PLACEHOLDER'");
});

test('renderEntry: CORS with array origins', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      corsOrigin: ['http://localhost:3000', 'http://localhost:3001'],
    },
  });
  const code = renderEntry(desc);

  expect(code).toContain('cors');
  expect(code).toContain('localhost:3000');
});

test('renderEntry: CORS default (no corsOrigin) generates localhost regex', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      cors: true,
    },
  });
  const code = renderEntry(desc);

  expect(code).toContain('cors');
  expect(code).toContain('localhost');
});

test('renderEntry: default CORS warns with config entry and security impact', () => {
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
  expect(warnings.join('\n')).toContain('middleware.corsOrigin');
  expect(warnings.join('\n')).toContain('production');
});

test('renderEntry: explicit CORS config is silent', () => {
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
  expect(warnings).toEqual([]);
});

test('renderEntry: securityHeaders middleware', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      securityHeaders: true,
    },
  });
  const code = renderEntry(desc);

  expect(code).toContain('secureHeaders');
});

test('renderEntry: requestId middleware', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      requestId: true,
    },
  });
  const code = renderEntry(desc);

  expect(code).toContain('requestId');
});

test('renderEntry: logger middleware', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      logger: true,
    },
  });
  const code = renderEntry(desc);

  expect(code).toContain('honoLogger');
});

test('renderEntry: no middleware generates clean app', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      requestId: false,
      logger: false,
      cors: false,
      securityHeaders: false,
    },
  });
  const code = renderEntry(desc);

  expect(code.includes('cors')).toEqual(false);
  expect(code.includes('secureHeaders')).toEqual(false);
  expect(code.includes('requestId')).toEqual(false);
  expect(code.includes('honoLogger')).toEqual(false);
});

test('renderEntry: SSG mode disabled by default', () => {
  const desc = buildEntryDescriptor(basicRoutes);
  const code = renderEntry(desc);

  expect(code.includes('install-global-dom-shim')).toEqual(false);
});

// Section

test('renderEntry: local island with ssr===true is registered in SSR', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    ssg: true,
    islandTagNames: ['my-counter'],
    islandFiles: ['my-counter.ts'],
  });
  // Mark island as ssr: true
  desc.islands[0].ssr = true;
  const code = renderEntry(desc);

  // SSR registration should happen (#952: via the ownership-tracked helper)
  expect(code).toContain('__registerSsrComponent("my-counter"');
});

test('renderEntry: local island with ssr===false is excluded from SSR registration', () => {
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
  expect(code.includes('__registerSsrComponent("client-only-widget"')).toBeFalsy();
  expect(code.includes('import * as __island_client_only_widget from')).toBeFalsy();
  // But it should still be in the island map for client-side upgrade
  expect(code).toContain('client-only-widget');
});

test('renderEntry: package island with ssr===false excluded from SSR but in island map', () => {
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
  expect(code).toContain('__registerSsrComponent("open-layout"');
  // Package islands with ssr:false remain client-only
  expect(code.includes('__registerSsrComponent("open-widget"')).toBeFalsy();
  // But both should be in the island map
  expect(code).toContain('"open-layout": "@acme/components/open-layout"');
  expect(code).toContain('"open-widget": "@acme/components/open-widget"');
});

test('buildEntryDescriptor: ssr field is extracted from manifest declarations', () => {
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

  expect(ssrComp?.ssr).toEqual(true);
  expect(clientOnly?.ssr).toEqual(false);
  expect(defaultComp?.ssr).toEqual(undefined); // no ssr field in manifest -> undefined
});

// ─── 0.42.0-alpha.2 (ADR-0120): action protocol wiring ─────────────────────
//
// The protocol semantics themselves (CSRF floor, named-action dispatch, the
// fail()/PRG channels, the RFC 9457 problem+json bodies) are BEHAVIOR of the
// imported @openelement/router/server-runtime action module since #1470
// block c (ADR-0160 rule a); they are exercised against that module by
// server-runtime-action-runtime.test.ts and end-to-end by the read-only
// request-time-parity oracle. What remains pinned here is the generated
// WIRING: the import bindings, the middleware composition, and the
// action-before-loader revalidation order.

test('renderEntry: action POST wiring follows the ADR-0120 protocol', () => {
  const desc = buildEntryDescriptor(basicRoutes, {});
  const code = renderEntry(desc);

  // The protocol runner is the imported runtime module, bound once.
  expect(code).toContain(
    "import { runActionProtocol as __runActionProtocol } from '@openelement/router/server-runtime'",
  );
  expect(code.includes('async function __runActionProtocol')).toBeFalsy();

  // The action runs before the loader (revalidation invariant): a mutation
  // never renders stale loader data.
  const actionIndex = code.indexOf('const __actionExecution = await __runActionProtocol(');
  const loaderIndex = code.indexOf('const __data =', actionIndex);
  expect(actionIndex > 0, 'action execution must be emitted').toEqual(true);
  expect(loaderIndex > actionIndex, 'loader must run after the action on POST').toEqual(true);

  // The POST handler composes the default body-limit middleware ahead of the
  // handler through the Hono↔WinterCG bridge; the limit value is the
  // canonical MAX_ACTION_BODY_BYTES policy constant (#568, S1c) — since
  // #1470 block e the factory imports it from the kernel-free /authoring
  // leaf and binds the middleware itself, so the entry carries neither the
  // serialized number nor the binding line (only the destructured middleware).
  expect(code).toContain(
    '__pageHandlers["/"].POST = [__asFetchMiddleware(__actionBodyLimit), __asFetchHandler(async (c, __route) => {',
  );
  expect(code.includes('__maxActionBodyBytes')).toBeFalsy();
  expect(code.includes('createActionBodyLimit')).toBeFalsy();
  expect(code).toContain('actionBodyLimit: __actionBodyLimit,');
  // The Vary negotiation header rides the shared wire constant, never a
  // literal (#743).
  expect(code).toContain(
    "import { ACTION_FETCH_HEADER as __actionFetchHeader } from '@openelement/router/server-runtime'",
  );
  expect(code).toContain("c.header('Vary', __actionFetchHeader);");
  // The 422 re-render renders at the author's fail() status.
  expect(code).toContain(', __actionStatus)');
});

// ─── 0.42.0-alpha.5 (ADR-0121): protocol hardening wiring ──────────────────

test('renderEntry: ADR-0121 hardening wiring is present in the action codegen', () => {
  const desc = buildEntryDescriptor(basicRoutes, {});
  const code = renderEntry(desc);

  // The CSRF floor, the own-key named-action gate, the PRG target stripping,
  // and the problem+json error bodies are behavior of the imported module
  // (server-runtime-action-runtime.test.ts). The entry-level pins are the
  // response-negotiation wiring and the middleware registration.
  expect(code).toContain("c.header('Cache-Control', 'no-store');");
  // #550: request-time responses are never cacheable; POST is negotiated.
  expect(code).toContain("c.header('Vary', __actionFetchHeader);");
  // #943: successful GET pages relax to private,no-cache (bfcache/scroll
  // restoration); the no-store baseline above still guards every other kind.
  expect(code).toContain("c.header('Cache-Control', 'private, no-cache');");
  // #572: non-GET/POST methods on page routes are a defined 405.
  expect(code).toContain('const __routeMiddleware = __createRouteMiddleware([');
  expect(code).toContain(
    "app.all('*', (c, next) => { __honoContexts.set(c.req.raw, c); return __routeMiddleware(c.req.raw,",
  );
  // The Hono↔WinterCG bridge is the factory's own bridge, destructured once
  // (ADR-0160 rule a, #1470 block e — the bridge creation moved into
  // createGeneratedApp; the 405 responder is the factory-bound dispatch
  // module).
  expect(code).toContain('methodNotAllowed: __methodNotAllowed,');
  expect(code).toContain(
    'const { contexts: __honoContexts, asFetchHandler: __asFetchHandler, asFetchMiddleware: __asFetchMiddleware } = __app.hono;',
  );
  expect(code.includes('const __honoContexts = new WeakMap();')).toBeFalsy();
  expect(code.includes('createHonoBridge')).toBeFalsy();
});

test('renderEntry: the action error/redirect channels are imported runtime calls', () => {
  const desc = buildEntryDescriptor(basicRoutes, {});
  const code = renderEntry(desc);

  // ADR-0121: the 303 redirect coercion (fetch ActionResult shape included)
  // and the RFC 9457 500 mapping (#863, #558) are the imported module; the
  // catch block keeps only the call sites. The `import.meta.env.PROD`
  // argument stays emitted at the call site so the bundler define keeps
  // owning the production flag.
  expect(code).toContain(
    "import { actionRedirectResponse as __actionRedirectResponse } from '@openelement/router/server-runtime'",
  );
  expect(code).toContain(
    "import { actionErrorResponse as __actionErrorResponse } from '@openelement/router/server-runtime'",
  );
  expect(code).toContain(
    'return __actionRedirectResponse(c, err.location, __actionState.isFetch);',
  );
  expect(code).toContain('return __actionErrorResponse(c, "/", err, import.meta.env.PROD);');
  expect(code.includes("title: 'Internal Server Error'")).toBeFalsy();
});

test('renderEntry: the action protocol wiring is emitted once for many routes (#1098)', () => {
  const routes: RouteEntry[] = Array.from({ length: 30 }, (_, index) => ({
    path: `/page-${index}`,
    filePath: `page-${index}.ts`,
    type: 'page',
    varName: `page${index}`,
  }));
  const code = renderEntry(buildEntryDescriptor(routes));
  expect(code.match(/import { runActionProtocol as __runActionProtocol }/g)?.length).toEqual(1);
  expect(code.match(/actionBodyLimit: __actionBodyLimit,/g)?.length).toEqual(1);
  expect(code.match(/await __runActionProtocol\(/g)?.length).toEqual(routes.length);
});

test('renderEntry: private,no-cache is emitted only after a successful render (#943 amendment)', () => {
  const desc = buildEntryDescriptor(basicRoutes, {});
  const code = renderEntry(desc);

  // The Cache-Control relaxation must sit between the shell render and the
  // response return: emitted BEFORE __renderAppShell it leaks onto the
  // redirect/notFound/error responses produced by the catch block below.
  const renderIndex = code.indexOf('__renderAppShell(__content,');
  const relaxIndex = code.indexOf("c.header('Cache-Control', 'private, no-cache');");
  const returnIndex = code.indexOf('return c.html(wrapInDocument(content, {', relaxIndex);
  expect(renderIndex > 0, 'shell render must be emitted').toEqual(true);
  expect(relaxIndex > renderIndex, 'private,no-cache must follow the shell render').toEqual(true);
  expect(returnIndex > relaxIndex, 'private,no-cache must precede the 200 return').toEqual(true);
});

test('renderEntry: island client script descriptors also cover notFound/error HTML responses (#1067)', () => {
  const routes: RouteEntry[] = [
    ...basicRoutes,
    { path: '/404', filePath: '404.ts', type: 'page', varName: 'page404' },
  ];
  const code = renderEntry(buildEntryDescriptor(routes, {}));

  // #951 parity: prod embeds the island client entry into every HTML
  // response (post-build injectClientScript on static pages, render-time
  // script descriptors on request-time pages), so the 404/error channels
  // must pass the same descriptors as the successful GET page — one
  // serialization point (wrapInDocument) attaches the CSP nonce to all of
  // them.
  expect(code).toContain(
    'return c.html(wrapInDocument(__statusHtml("404 Not Found", err.message || "Not Found"), {',
  );
  expect(code).toContain('return c.html(wrapInDocument(errorContent, {');
  const notFoundBody = code.slice(code.indexOf('app.notFound('));
  expect(notFoundBody).toContain('return c.html(wrapInDocument(content, {');
  expect(notFoundBody).toContain(
    'return c.html(wrapInDocument(__statusHtml("404 Not Found", "Not Found"), {',
  );
  expect(code.includes('__withDevClientScript')).toEqual(false);
  // #951/#1471: the document wraps read the resolved document's clientScripts
  // (`scripts: __doc.clientScripts || []` — GET+POST success and error
  // boundary per page route, plus the app.notFound success wrap). The direct
  // descriptor call remains only where no resolved document exists: the
  // 404 catch per page route (GET + POST) and the app.notFound catch — same
  // list, same tags, one serialization point.
  const pageRouteCount = routes.filter((r) => r.type === 'page').length;
  expect(code.match(/scripts: __clientScriptDescriptors\(\)/g)?.length).toEqual(
    pageRouteCount * 2 + 1,
  );
  expect(code.match(/scripts: __doc\.clientScripts \|\| \[\]/g)?.length).toEqual(
    pageRouteCount * 4 + 1,
  );
});

test('renderEntry: hasAction codegen covers named `actions` exports (#539)', () => {
  const desc = buildEntryDescriptor(basicRoutes, { ssg: true });
  const code = renderEntry(desc);

  // The routeInfo hasAction flag must be true for a route exporting ONLY a
  // named `actions` map — otherwise the prerender hard rule is bypassable.
  expect(code).toContain('hasAction: (typeof');
  expect(code).toContain('.actions === "object" &&');
});

test('renderEntry: GET catch keeps the author redirect status while POST coerces to 303', () => {
  const desc = buildEntryDescriptor(basicRoutes, {});
  const code = renderEntry(desc);

  // The GET handler keeps the author's status; the POST handler delegates to
  // the imported 303-coercion helper (ADR-0121; behavior covered by
  // server-runtime-action-runtime.test.ts and the request-time-parity oracle).
  expect(code).toContain('return c.redirect(err.location, err.status)');
  expect(code).toContain(
    'return __actionRedirectResponse(c, err.location, __actionState.isFetch);',
  );
});

// Fetch middleware contract (ADR-0123 item 2, #858)

test('renderEntry: middleware.use composes imported module defaults at the handler boundary (#858)', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: {
      use: ['./app/middleware/outer.ts', './app/middleware/inner.ts'],
    },
  });
  const code = renderEntry(desc);

  // Module contract: each middleware module is imported and its default
  // export handed to the factory — order preserved (use[0] outermost), no
  // source inlining. The onion composition itself is the typed factory
  // (#1470 block e): the entry no longer imports composeFetchMiddleware.
  expect(code).toContain('import * as __mw_0 from "/app/middleware/outer.ts"');
  expect(code).toContain('import * as __mw_1 from "/app/middleware/inner.ts"');
  expect(code).toContain('fetchMiddleware: [');
  expect(code).toContain('__mw_0.default,');
  expect(code).toContain('__mw_1.default,');
  expect(code.includes('composeFetchMiddleware')).toBeFalsy();
  // The composed handler is the factory result under the same export name.
  expect(code).toContain('export const openElementHandler = __app.handler;');
  // Dev-server boundary export (@hono/vite-dev-server reads it via the
  // `export` option when middleware.use is configured).
  expect(code).toContain('export const openElementDevFetch = __app.devFetch;');
  // The raw Hono app stays the default export — SSG prerender is unchanged.
  expect(code).toContain('export default app');
});

test('renderEntry: middleware.corsOriginModule is imported and referenced, never inlined', () => {
  const desc = buildEntryDescriptor(basicRoutes, {
    middleware: { corsOriginModule: './app/cors-origin.ts' },
  });
  const code = renderEntry(desc);

  expect(code).toContain('import * as __cors_origin_module from "/app/cors-origin.ts";');
  expect(code).toContain("app.use('*', cors({ origin: __cors_origin_module.default,");
});

test('renderEntry: no middleware.use keeps the single composed handler export', () => {
  const desc = buildEntryDescriptor(basicRoutes);
  const code = renderEntry(desc);

  // The handler export exists in both shapes since #1470 block e — without
  // middleware.use the factory composes nothing around app.fetch, and no
  // dev-server export is emitted.
  expect(code.includes('composeFetchMiddleware')).toBeFalsy();
  expect(code.includes('openElementDevFetch')).toBeFalsy();
  expect(code).toContain('export const openElementHandler = __app.handler;');
});

test('renderEntry: corsOrigin warning is emitted once per process (#925)', () => {
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
  expect(
    warnings.length,
    'configResolved + buildStart both render the entry; warning must dedupe',
  ).toEqual(1);
});

test('renderEntry: island client script is descriptor-driven (dev URL + request-time setter)', () => {
  const code = renderEntry(
    buildEntryDescriptor(basicRoutes, {
      islandTagNames: ['live-counter'],
      islandFiles: ['live-counter.ts'],
    }),
  );

  // One render-time seam: the dev URL (compile-time constant) is computed in
  // the entry and handed to the factory; the request-time src the generated
  // dist/server/index.js hands in reaches the same seam. wrapInDocument
  // serializes the tag — the only place a CSP nonce is attached. (#1470
  // block e: the setter/descriptor machinery moved into createGeneratedApp;
  // the entry re-exports the setter and binds the descriptor list.)
  expect(code).toContain(
    "devClientScriptSrc: import.meta.env.DEV && true ? import.meta.env.BASE_URL + 'client/islands/client.js' : null,",
  );
  expect(code).toContain(
    'export const __setRequestTimeClientScript = __app.setRequestTimeClientScript;',
  );
  expect(code).toContain('clientScriptDescriptors: __clientScriptDescriptors,');
  // No HTML string-splicing survives in the generated entry.
  expect(code.includes('insertBeforeBodyClose')).toEqual(false);
  expect(code.includes('__withDevClientScript')).toEqual(false);
});

test('renderEntry: no islands and no enhanced forms yields no dev client script', () => {
  const code = renderEntry(buildEntryDescriptor(basicRoutes));
  expect(code).toContain(
    "devClientScriptSrc: import.meta.env.DEV && false ? import.meta.env.BASE_URL + 'client/islands/client.js' : null,",
  );
});

test('renderEntry: /404 page route emits the styled notFound fallback (#923)', () => {
  const routes: RouteEntry[] = [
    { path: '/', filePath: 'index.ts', type: 'page', varName: 'pageIndex' },
    { path: '/404', filePath: '404.tsx', type: 'page', varName: 'page404' },
  ];
  const code = renderEntry(buildEntryDescriptor(routes));
  expect(code).toContain('app.notFound(async (c) => {');
  expect(code).toContain('// Styled 404 (#923)');
  expect(code).toContain('page404.loader === "function"');
  expect(code).toContain('__renderAppShell(__content, c.req.path || "/404",');
  // Fallback renders with a forced 404 status and degrades to the plain
  // status page on failure — never a 500 from the fallback itself.
  expect(code).toContain('wrapInDocument(content, {');
  expect(code).toContain('}), 404)');
  expect(code).toContain('__statusHtml("404 Not Found", "Not Found")');
});

test('renderEntry: no /404 route keeps the bare 404 fallback (#923)', () => {
  const code = renderEntry(buildEntryDescriptor(basicRoutes));
  expect(code.includes('app.notFound(')).toBeFalsy();
});
