/**
 * @openelement/router — M14-3: the four awaited page channels, on settlement
 * and on rejection.
 *
 * `function-page.test.ts` pins the resolved side of the same real pipeline
 * (compiled fixture → generated entry → the published
 * `renderFunctionPageAwaited` seam). This file adds the negative half — what
 * each channel does when the awaited value REJECTS — and re-runs the resolve
 * assertion per channel so the pair is visible at one head.
 *
 * The harness is the same real pipeline, not a second mock: the route module
 * is compiled by the production transform, transpiled, imported natively and
 * fed to the real entry codegen. Only the document/status wrappers are
 * miniatures (the html-page.test pattern, identical to `function-page.test.ts`).
 * The helpers are reproduced because that file's are file-local and M11 may
 * still touch it; M14-3 must not edit it.
 *
 * Channels and their emitted sites:
 *   1. request-time GET      → entry-codegen.ts routeRenderStatement
 *   2. styled 404            → entry-not-found-codegen.ts static degrade
 *   3. SSG renderRoute       → entry-render-ssg.ts OPEN_ELEMENT_RENDER_RENDER_FAILED
 *   4. GET error boundary    → entry-codegen.ts 500 re-render (status 500)
 */
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import ts from 'typescript';
import { compiledElementPlugin } from '@openelement/compiler';
import type { RouteEntry } from '@openelement/protocol/framework';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderPageRoute } from '../src/vite/internal/ssg/entry-codegen.ts';
import { renderSsgSection } from '../src/vite/internal/ssg/entry-render-ssg.ts';
import { renderNotFoundRoute } from '../src/vite/internal/ssg/entry-not-found-codegen.ts';

const ROUTE_FILE = '/proj/app/routes/awaited.tsx';

let scratch: string;
let serial = 0;

beforeAll(async () => {
  // Same resolution contract as function-page.test.ts: the generated harness
  // imports the bare specifiers a compiled route module does, so the scratch
  // dir carries its own @openelement links anchored to this file — never to
  // process.cwd(). A distinct directory keeps the two suites parallel-safe.
  const repoRoot = join(import.meta.dirname, '..', '..', '..');
  scratch = join(repoRoot, 'node_modules', '.oe-function-page-channels');
  await rm(scratch, { recursive: true, force: true });
  const scope = join(scratch, 'node_modules', '@openelement');
  await mkdir(scope, { recursive: true });
  for (const name of ['router', 'element'] as const) {
    await symlink(join(repoRoot, 'packages', name), join(scope, name), 'dir');
  }
});

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

/**
 * The real-runtime miniatures the generated entries reference: the true
 * `renderFunctionPageAwaited` seam and the true props projector are imported;
 * only pure wrapping/document helpers are miniatured.
 */
const HARNESS_RUNTIME = `
import { renderFunctionPageAwaited as __renderFunctionPageAwaited, createPagePropsRuntime, pageDefinition as __pageDefinition, routeMeta as __routeMeta } from '@openelement/router/server-runtime';
const __propsRuntime = createPagePropsRuntime({ dangerousKeys: new Set(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'hasOwnProperty']) });
const __pageProps = __propsRuntime.pageProps;
const __pageErrorProps = __propsRuntime.pageErrorProps;
function wrapInDocument(content, opts) {
  return '<!DOCTYPE html><html lang="' + opts.lang + '"><head><title>' + opts.title + '</title></head><body>' + content + '</body></html>';
}
function createDocumentStyleResources() {
  const links = [];
  return { get links() { return links; }, add(urls) { for (const url of urls) if (!links.includes(url)) links.push(url); } };
}
function __resolvePageTag(routeModule, fallback) { return fallback; }
function __isOpenElementRedirect(e) { return e && e.__openRedirect === true; }
function __isOpenElementNotFound(e) { return e && e.__openNotFound === true; }
function __statusHtml(title, message) { return '<main><h1>' + title + '</h1></main>'; }
function escapeHtml(text) { return String(text); }
const __locales = [];
function __getDefaultLocale() { return 'en'; }
function __localeFromPath(locales, path, fallback) { return fallback; }
function __ssr(tag, props) { return '<host>' + tag + '</host>'; }
function __renderLayout(content, path) { return '<layout>' + content + '</layout>'; }
function __clientScriptDescriptors() { return []; }
function __resolvePageDocument(head, context) {
  const resolved = typeof head === 'function' ? head(context) : head;
  return Object.assign({ links: [] }, resolved);
}
`;

const FUNCTION_ROUTE: RouteEntry = {
  path: '/awaited',
  filePath: 'awaited.tsx',
  type: 'page',
  varName: 'pageAwaited',
  definePage: true,
  functionPage: 'AwaitedPage',
};

const NOT_FOUND_ROUTE: RouteEntry = {
  path: '/404',
  filePath: '404.tsx',
  type: 'page',
  varName: 'page404',
  definePage: true,
  functionPage: 'NotFoundPage',
};

/** Compile one route module through the real production transform. */
async function writeTransformedRoute(
  source: string,
  id = ROUTE_FILE,
): Promise<{ file: string; code: string }> {
  const plugin = compiledElementPlugin({});
  const transform = plugin.transform;
  if (typeof transform !== 'function') {
    throw new Error('compiledElementPlugin transform is not a function');
  }
  const result = await Promise.resolve(
    transform.call(
      {
        error(message: unknown): never {
          throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
        },
      } as never,
      source,
      id,
    ),
  );
  if (
    result === null ||
    result === undefined ||
    typeof result === 'string' ||
    !('code' in result)
  ) {
    throw new Error(`production transform did not emit a module for ${id}`);
  }
  const js = ts.transpileModule(result.code, {
    fileName: id,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const file = `route-${serial++}.mjs`;
  await writeFile(join(scratch, file), js);
  return { file, code: result.code };
}

/** Load the request-time GET/error-boundary handler over a compiled module. */
async function loadRequestTimeHandler(routes: RouteEntry[], routeModuleFile: string) {
  const desc = buildEntryDescriptor(routes, { layout: false });
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
    );
  }
  const emitted = lines.join('\n');
  expect(emitted).toContain('let __content = await __renderFunctionPageAwaited(__page,');
  expect(emitted).toContain(
    'let __errorHtml = await __renderFunctionPageAwaited(__page, __pageErrorProps(',
  );
  const harness = `
${HARNESS_RUNTIME}
import * as $pageAwaited from './${routeModuleFile}';
const __pageHandlers = { ${routes.map((route) => `${JSON.stringify(route.path)}: {}`).join(', ')} };
function __requestScope(request) {
  const headers = {};
  return {
    header: (name, value) => { headers[name] = value; },
    get: () => undefined,
    req: { raw: request, path: new URL(request.url).pathname },
    env: {},
    html: (body, status) => new Response(body, { status: status || 200, headers }),
    redirect: (location, status) => new Response(null, { status: status || 302, headers: { Location: String(location) } }),
  };
}
function __mergeChannelHeaders(promise) { return promise; }
${lines.join('\n')}
export async function run(path) {
  const [handler] = __pageHandlers[path].GET;
  const response = await handler(new Request('http://localhost' + path), { params: {} });
  return { status: response.status, html: await response.text() };
}
`.replaceAll('import.meta.env.PROD', 'false');
  const file = join(scratch, `handler-${serial++}.mjs`);
  await writeFile(file, harness);
  const mod = (await import(pathToFileURL(file).href)) as {
    run: (path: string) => Promise<{ status: number; html: string }>;
  };
  return mod.run;
}

/** Load the SSG renderRoute section over a compiled module. */
async function loadSsgRenderRoute(routes: RouteEntry[], routeModuleFile: string) {
  const desc = buildEntryDescriptor(routes, { ssg: true, layout: false });
  const section = renderSsgSection(desc);
  expect(section).toContain('content = await __renderFunctionPageAwaited(page, props);');
  expect(section).toContain(
    '__errorPageHtml = await __renderFunctionPageAwaited(page, __pageErrorProps(',
  );
  const harness = `
const __headExtras = '';
${HARNESS_RUNTIME}
import * as $pageAwaited from './${routeModuleFile}';
${renderSsgSection(desc)}
`.replaceAll('import.meta.env.PROD', 'false');
  const file = join(scratch, `ssg-${serial++}.mjs`);
  await writeFile(file, harness);
  const mod = (await import(pathToFileURL(file).href)) as {
    renderRoute: (path: string) => Promise<{
      html: string;
      status?: number;
      errors: Array<{ code: string; phase: string; message: string; recoverable: boolean }>;
    }>;
  };
  return mod.renderRoute;
}

/** Load the styled-404 handler over a compiled module. */
async function loadNotFoundHandler(routeModuleFile: string) {
  const desc = buildEntryDescriptor([NOT_FOUND_ROUTE], { layout: false });
  const lines: string[] = [];
  renderNotFoundRoute(
    lines,
    desc.pageRoutes[0],
    desc.renderers,
    { title: 't', lang: 'en', headExtras: '', allowHeadExtrasScripts: false },
    false,
  );
  expect(lines.join('\n')).toContain('await __renderFunctionPageAwaited(');
  const harness = `
${HARNESS_RUNTIME}
import * as $page404 from './${routeModuleFile}';
let __notFound;
const app = { notFound(fn) { __notFound = fn; } };
function __requestScope(request) {
  const headers = {};
  return {
    header: (name, value) => { headers[name] = value; },
    get: () => undefined,
    req: { raw: request, path: new URL(request.url).pathname },
    env: {},
    html: (body, status) => new Response(body, { status: status || 200, headers }),
    redirect: (location, status) => new Response(null, { status: status || 302, headers: { Location: String(location) } }),
  };
}
function __mergeChannelHeaders(promise) { return promise; }
${lines.join('\n')}
export async function run() {
  const response = await __notFound(new Request('http://localhost/missing'));
  return { status: response.status, html: await response.text() };
}
`.replaceAll('import.meta.env.PROD', 'false');
  const file = join(scratch, `not-found-${serial++}.mjs`);
  await writeFile(file, harness);
  const mod = (await import(pathToFileURL(file).href)) as {
    run: () => Promise<{ status: number; html: string }>;
  };
  return mod.run;
}

// ─── Sources ────────────────────────────────────────────────────────────────

const SETTLED_PAGE = [
  "import { definePage } from '@openelement/router';",
  'export function settled() { return Promise.resolve("settled-value"); }',
  'export async function AwaitedPage() {',
  '  return <p id="awaited-marker">{await settled()}</p>;',
  '}',
  'export default definePage(AwaitedPage);',
].join('\n');

const REJECTING_PAGE = [
  "import { definePage } from '@openelement/router';",
  'export function fail() { return Promise.reject(new Error("boom-origin")); }',
  'export async function AwaitedPage() {',
  '  return <p id="awaited-marker">{await fail()}</p>;',
  '}',
  'export default definePage(AwaitedPage);',
].join('\n');

const SETTLED_NOT_FOUND_PAGE = [
  "import { definePage } from '@openelement/router';",
  'export function settled() { return Promise.resolve("not-found-settled"); }',
  'export async function NotFoundPage() {',
  '  return <p id="not-found-marker">{await settled()}</p>;',
  '}',
  'export default definePage(NotFoundPage);',
].join('\n');

const REJECTING_NOT_FOUND_PAGE = [
  "import { definePage } from '@openelement/router';",
  'export function fail() { return Promise.reject(new Error("boom-404")); }',
  'export async function NotFoundPage() {',
  '  return <p id="not-found-marker">{await fail()}</p>;',
  '}',
  'export default definePage(NotFoundPage);',
].join('\n');

const ERROR_BOUNDARY_PAGE = [
  "import { definePage } from '@openelement/router';",
  'export function settled() { return Promise.resolve("recovered-value"); }',
  "export const loader = async () => { throw new Error('loader-exploded'); };",
  'export async function AwaitedPage() {',
  '  return <h1>{await settled()}</h1>;',
  '}',
  'export default definePage(AwaitedPage, { error: () => ({}) });',
].join('\n');

const REJECTING_BOUNDARY_PAGE = [
  "import { definePage } from '@openelement/router';",
  'export function fail() { return Promise.reject(new Error("boom-boundary")); }',
  "export const loader = async () => { throw new Error('loader-exploded'); };",
  'export async function AwaitedPage() {',
  '  return <h1>{await fail()}</h1>;',
  '}',
  'export default definePage(AwaitedPage, { error: () => ({}) });',
].join('\n');

// ─── 1. Request-time GET ────────────────────────────────────────────────────

test('GET: the request-time channel renders the settled value', async () => {
  const { file, code } = await writeTransformedRoute(SETTLED_PAGE);
  expect(code).toContain('export async function AwaitedPage');
  expect(code).toContain('__t(await settled())');
  const run = await loadRequestTimeHandler([FUNCTION_ROUTE], file);
  const { status, html } = await run('/awaited');
  expect(status).toEqual(200);
  expect(html).toContain('<p id="awaited-marker">settled-value</p>');
  expect(html).not.toContain('[object Promise]');
});

test('GET: a rejecting await reaches the error boundary with the original reason', async () => {
  const { file, code } = await writeTransformedRoute(REJECTING_PAGE);
  expect(code).toContain('__t(await fail())');
  const run = await loadRequestTimeHandler([FUNCTION_ROUTE], file);
  const { status, html } = await run('/awaited');
  // No error projector is declared, so the generated catch boundary answers
  // 500 and its dev-mode body carries the original reason (never the page).
  expect(status).toEqual(500);
  expect(html).toContain('boom-origin');
  expect(html).not.toContain('awaited-marker');
  expect(html).not.toContain('[object Promise]');
});

// ─── 2. Styled 404 ─────────────────────────────────────────────────────────

test('404: the not-found channel renders the settled value', async () => {
  const { file } = await writeTransformedRoute(SETTLED_NOT_FOUND_PAGE, '/proj/app/routes/404.tsx');
  const run = await loadNotFoundHandler(file);
  const { status, html } = await run();
  expect(status).toEqual(404);
  expect(html).toContain('<p id="not-found-marker">not-found-settled</p>');
  expect(html).not.toContain('[object Promise]');
});

test('404: a rejecting await degrades to the static 404 page', async () => {
  const { file } = await writeTransformedRoute(
    REJECTING_NOT_FOUND_PAGE,
    '/proj/app/routes/404.tsx',
  );
  const run = await loadNotFoundHandler(file);
  const { status, html } = await run();
  // entry-not-found-codegen.ts:105-114 — the fallback never 500s and never
  // leaks the render reason; it answers the plain status page with 404.
  expect(status).toEqual(404);
  expect(html).toContain('<main><h1>404 Not Found</h1></main>');
  expect(html).not.toContain('boom-404');
  expect(html).not.toContain('not-found-marker');
  expect(html).not.toContain('[object Promise]');
});

// ─── 3. SSG renderRoute ────────────────────────────────────────────────────

test('SSG: renderRoute renders the settled value', async () => {
  const { file } = await writeTransformedRoute(SETTLED_PAGE);
  const renderRoute = await loadSsgRenderRoute([FUNCTION_ROUTE], file);
  const result = await renderRoute('/awaited');
  expect(result.errors).toEqual([]);
  expect(result.html).toContain('<p id="awaited-marker">settled-value</p>');
  expect(result.html).not.toContain('[object Promise]');
});

test('SSG: a rejecting await reports OPEN_ELEMENT_RENDER_RENDER_FAILED', async () => {
  const { file } = await writeTransformedRoute(REJECTING_PAGE);
  const renderRoute = await loadSsgRenderRoute([FUNCTION_ROUTE], file);
  const result = await renderRoute('/awaited');
  // entry-render-ssg.ts:206-213 — the caught reason becomes the RenderError's
  // message; the render never resolves with a page body.
  expect(result.status).toEqual(500);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].code).toEqual('OPEN_ELEMENT_RENDER_RENDER_FAILED');
  expect(result.errors[0].phase).toEqual('render');
  expect(result.errors[0].message).toEqual('boom-origin');
  expect(result.errors[0].recoverable).toEqual(false);
  expect(result.html).toContain('500 Internal Server Error');
  expect(result.html).not.toContain('[object Promise]');
});

// ─── 4. GET error boundary (loader rejection → awaited re-render) ──────────

test('error channel: a throwing loader re-renders the awaited page with status 500', async () => {
  const { file } = await writeTransformedRoute(ERROR_BOUNDARY_PAGE);
  const run = await loadRequestTimeHandler([FUNCTION_ROUTE], file);
  const { status, html } = await run('/awaited');
  expect(status).toEqual(500);
  expect(html).toContain('<h1>recovered-value</h1>');
  expect(html).not.toContain('[object Promise]');
});

test('error channel: a rejecting boundary re-render keeps the loader reason and 500', async () => {
  const { file } = await writeTransformedRoute(REJECTING_BOUNDARY_PAGE);
  const run = await loadRequestTimeHandler([FUNCTION_ROUTE], file);
  const { status, html } = await run('/awaited');
  // The boundary's own awaited re-render rejects too: the inner catch drops
  // to the outer 500 fallback, which keeps the ORIGINAL loader reason.
  expect(status).toEqual(500);
  expect(html).toContain('loader-exploded');
  expect(html).not.toContain('boom-boundary');
  expect(html).not.toContain('[object Promise]');
});
