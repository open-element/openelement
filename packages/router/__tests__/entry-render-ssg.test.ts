/**
 * @openelement/router - entry-render-ssg.ts tests
 *
 * Behavioral tests for the generated SSG renderRoute(): the generated code
 * is executed in a data: module with mocked entry-level dependencies so the
 * loader/render error paths (redirect, 404, 500 + errors collection) are
 * exercised for real, not just string-matched.
 */
import { expect, test } from 'vitest';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderSsgSection } from '../src/vite/internal/ssg/entry-render-ssg.ts';
import type { RouteEntry } from '../src/vite/internal/protocol/framework.ts';

const routes: RouteEntry[] = [
  {
    path: '/boom',
    filePath: 'boom.tsx',
    type: 'page',
    varName: 'boom_route',
    tagName: 'boom-page',
  },
];

interface RenderedPage {
  html: string;
  status?: number;
  errors: Array<{
    code: string;
    severity: string;
    phase: string;
    tagName: string;
    message: string;
  }>;
  componentCount: number;
  renderTimeMs: number;
}

/**
 * Execute the generated SSG section with mocked entry-level dependencies.
 * The generated code runs verbatim, except import.meta.env.PROD which is
 * replaced the same way Vite's define would at bundle time.
 */
async function loadGeneratedRenderRoute(options: {
  renderAppShellBody: string;
  loaderBody?: string;
  prod?: boolean;
}): Promise<(path: string, opts?: Record<string, unknown>) => Promise<RenderedPage>> {
  const desc = buildEntryDescriptor(routes, { ssg: true });
  const section = renderSsgSection(desc).replaceAll(
    'import.meta.env.PROD',
    options.prod ? 'true' : 'false',
  );

  const harness = `
const $boom_route = {
  loader: ${options.loaderBody ?? 'undefined'},
  default: class BoomPage {},
};
function __pageDefinition(m) { return m?.default?.openElementPage || {}; }
function __resolvePageTag(routeModule, fallback) {
  const program = routeModule && routeModule.default && routeModule.default.__partProgram;
  return program && typeof program.tag === "string" && program.tag.includes("-") ? program.tag : fallback;
}
function __routeMeta() { return {}; }
function __isOpenElementRedirect(e) { return e && e.__openRedirect === true; }
function __isOpenElementNotFound(e) { return e && e.__openNotFound === true; }
function __statusHtml(title, message) { return "<main><h1>" + title + "</h1><p>" + message + "</p></main>"; }
function wrapInDocument(content, opts) {
  return "<!DOCTYPE html><html lang=\\"" + opts.lang + "\\\"><head><title>" + opts.title + "</title></head><body>" + content + "</body></html>";
}
function __ssr(tag, props) { return tag + (props.context.locale ? ":" + props.context.locale : ""); }
function __pageProps(routeModule, context) { return { context: context }; }
function __pageErrorProps(routeModule, error, context) { return { error: error, context: context }; }
function __clientScriptDescriptors() { return [{ type: "module", src: "/client/islands/client.js" }]; }
// Faithful miniature of @openelement/router/document resolvePageDocument (#1326):
// resolver heads receive the same context object; lang carries the locale;
// links default to []; the render wiring's client-script descriptors ride the
// resolved document (#1471). Resolution policy itself is unit-tested in
// packages/router/__tests__/document.test.ts and end-to-end in the app-flow
// fixtures; here we only pin the renderRoute wiring.
function __resolvePageDocument(head, context, clientScripts) {
  const resolved = typeof head === "function" ? head(context) : head;
  const doc = Object.assign({ links: [] }, resolved);
  if (context && context.locale) doc.lang = context.locale;
  if (clientScripts && clientScripts.length > 0) doc.clientScripts = clientScripts;
  return doc;
}
function __renderAppShell(pageHtml, routePath) { ${options.renderAppShellBody} }
`;

  const mod = await import(
    'data:text/javascript;charset=utf-8,' + encodeURIComponent(harness + section)
  );
  return mod.renderRoute;
}

test('renderRoute: happy path returns html with empty errors', async () => {
  const renderRoute = await loadGeneratedRenderRoute({
    renderAppShellBody: 'return "<div>ok " + pageHtml + "</div>";',
  });
  const result = await renderRoute('/boom');
  expect(result.html).toContain('<div>ok boom-page</div>');
  expect(result.status).toEqual(undefined);
  expect(result.errors).toEqual([]);
});

test('renderRoute: locale reaches the page props projector', async () => {
  const renderRoute = await loadGeneratedRenderRoute({
    renderAppShellBody: 'return "<div>" + pageHtml + "</div>";',
  });
  const result = await renderRoute('/boom', { locale: 'zh-CN' });
  expect(result.html).toContain('<div>boom-page:zh-CN</div>');
});

test('renderRoute: render failure produces defined 500 and collects a RenderError', async () => {
  const renderRoute = await loadGeneratedRenderRoute({
    renderAppShellBody: 'throw new Error("render exploded");',
  });
  const result = await renderRoute('/boom');
  expect(result.status).toEqual(500);
  expect(result.html).toContain('500 Internal Server Error');
  expect(result.errors.length).toEqual(1);
  expect(result.errors[0].code).toEqual('OPEN_ELEMENT_RENDER_RENDER_FAILED');
  expect(result.errors[0].severity).toEqual('error');
  expect(result.errors[0].phase).toEqual('render');
  expect(result.errors[0].tagName).toEqual('boom-page');
  expect(result.errors[0].message).toEqual('render exploded');
});

test('renderRoute: loader failure produces defined 500 and collects a RenderError', async () => {
  const renderRoute = await loadGeneratedRenderRoute({
    renderAppShellBody: 'return "unreachable";',
    loaderBody: 'async () => { throw new Error("loader exploded"); }',
  });
  const result = await renderRoute('/boom');
  expect(result.status).toEqual(500);
  expect(result.errors.length).toEqual(1);
  expect(result.errors[0].message).toEqual('loader exploded');
});

test('renderRoute: production mode hides the error stack from the 500 page', async () => {
  const renderRoute = await loadGeneratedRenderRoute({
    renderAppShellBody: 'throw new Error("render exploded");',
    prod: true,
  });
  const result = await renderRoute('/boom');
  expect(result.status).toEqual(500);
  expect(
    !result.html.includes('render exploded'),
    'prod 500 page must not leak error details',
  ).toBeTruthy();
  // The structured error is still collected for observability.
  expect(result.errors[0].message).toEqual('render exploded');
});

test('renderRoute: redirect and not-found still short-circuit with status pages', async () => {
  const redirect = await loadGeneratedRenderRoute({
    renderAppShellBody: 'throw { __openRedirect: true, location: "/login", status: 302 };',
  });
  const redirectResult = await redirect('/boom');
  expect(redirectResult.status).toEqual(302);
  expect(redirectResult.errors).toEqual([]);

  const notFound = await loadGeneratedRenderRoute({
    renderAppShellBody: 'throw { __openNotFound: true, message: "gone" };',
  });
  const notFoundResult = await notFound('/boom');
  expect(notFoundResult.status).toEqual(404);
  expect(notFoundResult.errors).toEqual([]);
});
