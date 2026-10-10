/**
 * @openelement/router — per-property og dedup wiring (consumer form).
 *
 * The unit face of the suppression (headFragmentsForRoute /
 * filterHeadExtrasForRoute) is pinned in app-config-og-dedup.test.ts. These
 * tests pin the WIRING the unit level cannot see: the site-level og:* block
 * is serialized ONCE per build into a baked string (`__HEAD_EXTRAS__` for the
 * SSG bundle, a quoted literal per request-time handler), so the dedup has to
 * happen at the two points where the route's resolved document exists —
 *
 *   - SSG: renderRoute's inline mirror reads `__doc.meta` after the
 *     document resolution and filters the site fallback before
 *     wrapInDocument;
 *   - request time: each generated GET/POST handler does the same over its
 *     baked literal at every wrap that serializes route meta (success,
 *     stream document, error-boundary re-render), while status-page wraps
 *     (404/redirect/500 — no route meta emitted) keep the raw string so the
 *     head is never orphaned of its og block.
 *
 * Both harnesses execute the GENERATED code verbatim in a data: module
 * (the entry-render-ssg.test.ts pattern) against the REAL emitter output:
 * the baked string is produced by headFragmentsForRoute + the buildHeadExtras
 * join, and the canonical filterHeadExtrasForRoute is the oracle for the
 * expected site block (the rendererScopeMatches ↔ __matchingRenderers
 * keep-in-sync contract).
 */
import { expect, test } from 'vitest';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderPageRoute } from '../src/vite/internal/ssg/entry-codegen.ts';
import { renderSsgSection } from '../src/vite/internal/ssg/entry-render-ssg.ts';
import { filterHeadExtrasForRoute, headFragmentsForRoute } from '../src/vite/app-config.ts';
import type { RouteEntry } from '@openelement/protocol/framework';

const HEAD = {
  title: 'Site title',
  description: 'Site description',
  favicon: '/favicon.svg',
  ogImage: 'https://example.com/og.png',
};

/**
 * The baked site string exactly as the build produces it: the real emitter
 * table's fragments, joined with the buildHeadExtras separator.
 */
const BAKED_SITE_HEAD_EXTRAS = headFragmentsForRoute(HEAD, 'Site title', undefined).join('\n  ');

const ROUTE_OG_META = [{ property: 'og:title', content: 'Route og title' }];

function ogTitleCount(html: string): number {
  return (html.match(/<meta property="og:title"/g) ?? []).length;
}

/**
 * Faithful miniature of the wrapInDocument channels under test (the real
 * serializer is pinned in the element package; here only the meta.tags and
 * headExtras channels matter, serialized in the same relative order).
 */
const WRAP_IN_DOCUMENT_MINIATURE = `
function wrapInDocument(content, opts) {
  let metaTags = '';
  if (opts.meta && opts.meta.description) {
    metaTags += '<meta name="description" content="' + opts.meta.description + '">';
  }
  for (const tag of (opts.meta && opts.meta.tags) || []) {
    metaTags += '<meta ' + Object.keys(tag).map((k) => k + '="' + tag[k] + '"').join(' ') + '>';
  }
  return '<!DOCTYPE html><html><head><title>' + opts.title + '</title>' + metaTags +
    (opts.headExtras || '') + '</head><body>' + content + '</body></html>';
}
`;

// ─── SSG: the generated renderRoute filters the site fallback ───────────────

const ssgRoutes: RouteEntry[] = [
  { path: '/og', filePath: 'og.tsx', type: 'page', varName: 'og_route' },
  { path: '/plain', filePath: 'plain.tsx', type: 'page', varName: 'plain_route' },
];

async function loadSsgRenderRoute(): Promise<
  (path: string, opts?: Record<string, unknown>) => Promise<{ html: string; status?: number }>
> {
  const desc = buildEntryDescriptor(ssgRoutes, { ssg: true });
  const harness = `
const __headExtras = ${JSON.stringify(BAKED_SITE_HEAD_EXTRAS)};
const $og_route = {
  default: { openElementPage: { head: { title: 'Route title', meta: ${JSON.stringify(
    ROUTE_OG_META,
  )} } } },
};
const $plain_route = { default: { openElementPage: {} } };
function __pageDefinition(m) { return m?.default?.openElementPage || {}; }
function __resolvePageTag(routeModule, fallback) { return fallback; }
function __routeMeta() { return {}; }
function __isOpenElementRedirect(e) { return e && e.__openRedirect === true; }
function __isOpenElementNotFound(e) { return e && e.__openNotFound === true; }
function __statusHtml(title, message) { return '<main><h1>' + title + '</h1></main>'; }
${WRAP_IN_DOCUMENT_MINIATURE}
function __ssr(tag, props) { return '<main>' + tag + '</main>'; }
function __pageProps(routeModule, context) { return {}; }
function __pageErrorProps(routeModule, error, context) { return {}; }
function __clientScriptDescriptors() { return []; }
function __resolvePageDocument(head, context, clientScripts) {
  const resolved = typeof head === 'function' ? head(context) : head;
  return Object.assign({ links: [] }, resolved);
}
function __renderAppShell(pageHtml, routePath) { return pageHtml; }
${renderSsgSection(desc)}
`;
  const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(harness));
  return mod.renderRoute;
}

test('SSG: a route declaring head.meta og:title emits exactly one og:title (the route\u2019s)', async () => {
  const renderRoute = await loadSsgRenderRoute();
  const result = await renderRoute('/og');
  const html = result.html;

  // Exactly one og:title — the route's own tag through the meta channel.
  expect(ogTitleCount(html)).toEqual(1);
  expect(html).toContain('<meta property="og:title" content="Route og title">');
  // The site-level og:title default must not follow it into the document.
  expect(html).not.toContain('<meta property="og:title" content="Site title">');
  // Per-property only: undeclared site og tags survive.
  expect(html).toContain('<meta property="og:site_name" content="Site title">');
  expect(html).toContain('<meta property="og:image" content="https://example.com/og.png">');
  // name= metas are never suppressed.
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  // The surviving site block is exactly what the canonical filter predicts.
  expect(html).toContain(filterHeadExtrasForRoute(BAKED_SITE_HEAD_EXTRAS, ROUTE_OG_META));
});

test('SSG: a route with no og declarations keeps the site og block verbatim', async () => {
  const renderRoute = await loadSsgRenderRoute();
  const result = await renderRoute('/plain');
  expect(ogTitleCount(result.html)).toEqual(1);
  expect(result.html).toContain('<meta property="og:title" content="Site title">');
  expect(result.html).toContain(BAKED_SITE_HEAD_EXTRAS);
});

// ─── Request time: the generated GET handler filters its baked literal ──────

const requestRoutes: RouteEntry[] = [
  { path: '/og', filePath: 'og.tsx', type: 'page', varName: 'og_route' },
  { path: '/status', filePath: 'status.tsx', type: 'page', varName: 'status_route' },
];

async function loadRequestTimeHandler(): Promise<
  (path: string) => Promise<{ status: number; html: string }>
> {
  const desc = buildEntryDescriptor(requestRoutes, { headExtras: BAKED_SITE_HEAD_EXTRAS });
  const lines: string[] = [];
  for (const route of desc.pageRoutes) {
    renderPageRoute(
      lines,
      route,
      desc.renderers,
      {
        title: desc.document.title,
        lang: desc.document.lang,
        headExtras: desc.document.headExtras,
        allowHeadExtrasScripts: desc.document.allowHeadExtrasScripts,
      },
      desc.isSSG,
      desc.renderer,
    );
  }
  const harness = `
const __pageHandlers = { ${requestRoutes.map((route) => `${JSON.stringify(route.path)}: {}`).join(', ')} };
const $og_route = {
  default: { openElementPage: { head: { title: 'Route title', meta: ${JSON.stringify(
    ROUTE_OG_META,
  )} } } },
};
const $status_route = {
  loader: async () => { throw { __openNotFound: true, message: 'gone' }; },
  default: { openElementPage: {} },
};
function __requestScope(request) {
  const headers = {};
  return {
    header: (name, value) => { headers[name] = value; },
    get: () => undefined,
    req: { raw: request, path: new URL(request.url).pathname },
    env: {},
    html: (body, status) => new Response(body, { status: status || 200, headers }),
  };
}
function __mergeChannelHeaders(promise) { return promise; }
function __resolvePageTag(routeModule, fallback) { return fallback; }
function __pageDefinition(m) { return m?.default?.openElementPage || {}; }
function __routeMeta(m) { return {}; }
function __isOpenElementRedirect(e) { return e && e.__openRedirect === true; }
function __isOpenElementNotFound(e) { return e && e.__openNotFound === true; }
function __statusHtml(title, message) { return '<main><h1>' + title + '</h1></main>'; }
function escapeHtml(text) { return String(text); }
const __locales = [];
function __getDefaultLocale() { return 'en'; }
function __localeFromPath(locales, path, fallback) { return fallback; }
${WRAP_IN_DOCUMENT_MINIATURE}
function __ssr(tag, props) { return '<main>' + tag + '</main>'; }
function __pageProps(routeModule, context) { return {}; }
function __pageErrorProps(routeModule, error, context) { return {}; }
function __renderAppShell(content) { return content; }
function __clientScriptDescriptors() { return []; }
function __resolvePageDocument(head, context, clientScripts) {
  const resolved = typeof head === 'function' ? head(context) : head;
  return Object.assign({ links: [] }, resolved);
}
${lines.join('\n')}
export async function run(path) {
  const [handler] = __pageHandlers[path].GET;
  const response = await handler(new Request('http://localhost' + path), { params: {} });
  return { status: response.status, html: await response.text() };
}
`;
  const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(harness));
  return mod.run;
}

test('request time: a route declaring head.meta og:title emits exactly one og:title', async () => {
  const run = await loadRequestTimeHandler();
  const { status, html } = await run('/og');

  expect(status).toEqual(200);
  expect(ogTitleCount(html)).toEqual(1);
  expect(html).toContain('<meta property="og:title" content="Route og title">');
  expect(html).not.toContain('<meta property="og:title" content="Site title">');
  expect(html).toContain('<meta property="og:site_name" content="Site title">');
  expect(html).toContain(filterHeadExtrasForRoute(BAKED_SITE_HEAD_EXTRAS, ROUTE_OG_META));
});

test('request time: a not-found status page keeps the raw site og block (never orphaned)', async () => {
  const run = await loadRequestTimeHandler();
  const { status, html } = await run('/status');

  // The 404 wrap serializes no route meta, so the unfiltered site block is
  // correct there: one site og:title, nothing suppressed.
  expect(status).toEqual(404);
  expect(ogTitleCount(html)).toEqual(1);
  expect(html).toContain('<meta property="og:title" content="Site title">');
});
