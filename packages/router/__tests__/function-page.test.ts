/**
 * @openelement/router — the server function page lane (R2, alpha15 server
 * architecture).
 *
 * A server function page is the compile-architected page form: a route module
 * exports its TSX component function and the compiler lowers it into a
 * generative HTML constructor (`__h`/`__t`/`__ssr`). `definePage(component)`
 * admits that compiled function (the `__partProgram` discriminant: compiled
 * element CLASSES carry it, server function components never do), the route
 * scanner records the `functionPage` fact, and both render channels — the
 * request-time GET handler and the SSG renderRoute — render through the SAME
 * descriptor render, through the same renderer wraps, layout wrap and document
 * wrap the compiled path feeds.
 *
 * The rows below run against the REAL pipeline: the fixture route module is
 * compiled by the real compiler entry, transpiled, imported natively, and fed
 * to the real codegen. The harness routes call the REAL renderFunctionPage
 * seam and the REAL props projector, so the assertions see the wire bytes and
 * the boundary codes a browser/deploy would.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import ts from 'typescript';
import { analyzeModuleSemantics, compileServerComponentModule } from '@openelement/compiler';
import { ROUTER_MODULE_VOCABULARY } from '@openelement/protocol/module-vocabulary';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { definePage } from '../src/index.ts';
import { PageErrorCode } from '../src/internal/error-codes.ts';
import { renderFunctionPage } from '../src/vite/internal/server-runtime/page-render.ts';
import { createServerComponentSourceResolver } from '../src/vite/internal/server-component-host.ts';
import { collectShadowClassCandidates } from '../src/vite/internal/collect-shadow-candidates.ts';
import { createClassCandidateRegistry } from '@openelement/compiler';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderPageRoute } from '../src/vite/internal/ssg/entry-codegen.ts';
import { renderSsgSection } from '../src/vite/internal/ssg/entry-render-ssg.ts';
import { renderEntry } from '../src/vite/internal/ssg/entry-orchestrator.ts';
import { scanRoutes } from '../src/vite/internal/ssg/route-scanner.ts';
import type { RouteEntry } from '@openelement/protocol/framework';

/** The coded rejection one call raised. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    throw error;
  }
  throw new Error('the call returned; a coded rejection was expected');
}

/** A minimal compiled element class carrying the `__partProgram` discriminant. */
function makeCompiledPageClass(tag: string): CustomElementConstructor {
  const Page = class {
    render() {}
  } as unknown as CustomElementConstructor;
  Object.defineProperty(Page, '__partProgram', {
    value: { version: 2, tag },
    writable: true,
    configurable: true,
  });
  return Page;
}

// ─── 1. definePage: the function-page branch (the runtime discriminant) ─────

test('definePage admits an arrow component as a function page (kind function-page, render: first)', () => {
  const render = (props: Record<string, unknown>) => `<p>${String(props.title ?? '')}</p>`;
  const page = definePage(render as unknown as never);
  const descriptor = (page as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  expect(descriptor.kind).toEqual('function-page');
  expect(descriptor.render).toEqual(render);
  expect(descriptor.renderIntent).toEqual({ mode: 'static' });
});

test('definePage admits a plain function declaration as a function page', () => {
  function Page(props: Record<string, unknown>) {
    return `<p>${String(props.title ?? '')}</p>`;
  }
  const page = definePage(Page as unknown as never);
  const descriptor = (page as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  expect(descriptor.kind).toEqual('function-page');
  expect(descriptor.render).toEqual(Page);
  // The descriptor rides the function itself — the module default export.
  expect(page).toEqual(Page);
});

test('a class carrying __partProgram stays on the class branch (kind page)', () => {
  const Page = makeCompiledPageClass('about-page');
  const page = definePage(Page);
  const descriptor = (page as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  expect(descriptor.kind).toEqual('page');
  expect(descriptor.render).toEqual(undefined);
});

test('a plain (uncompiled) ES class stays on the class branch — the existing contract', () => {
  class HandwrittenPage {}
  const page = definePage(HandwrittenPage as unknown as CustomElementConstructor);
  const descriptor = (page as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  expect(descriptor.kind).toEqual('page');
});

test('a non-function first argument is still NOT_COMPILED_CLASS with the existing message', () => {
  assertThrowsIncludes(
    // @ts-expect-error — exercising the runtime contract
    () => definePage({}),
    Error,
    'requires the compiled page element class',
  );
  assertThrowsIncludes(
    // @ts-expect-error — exercising the runtime contract
    () => definePage(42),
    Error,
    'never definePage(HomePage(), …)',
  );
});

test('function pages validate the descriptor projectors like class pages', () => {
  const render = (props: Record<string, unknown>) => String(props.title ?? '');
  assertThrowsIncludes(
    () => definePage(render as unknown as never, { props: 'nope' as never }),
    Error,
    'props must be a projector function',
  );
  assertThrowsIncludes(
    () => definePage(render as unknown as never, { renderIntent: { mode: 'dynmaic' as never } }),
    Error,
    "renderIntent.mode must be 'static' or 'dynamic'",
  );
  // Unknown descriptor fields stay rejected on the function branch too.
  assertThrowsIncludes(
    () => definePage(render as unknown as never, { render: () => null } as never),
    Error,
    'top-level "render"',
  );
});

test('function pages reject renderIntent.stream — no compiled program to front-gate', () => {
  // Streaming is a compiled-Part-Program channel (the deferred-field front
  // gate rides the compiled program), and a server function page has none.
  // The rejection is authoring-time so the failure names the real reason
  // instead of surfacing later as an unrelated scan/compile diagnostic.
  const render = (props: Record<string, unknown>) => String(props.title ?? '');
  assertThrowsIncludes(
    () =>
      definePage(render as unknown as never, {
        renderIntent: { mode: 'dynamic', stream: { defer: ['first'] } },
      }),
    Error,
    'renderIntent.stream is not supported on a server function page',
  );
  // The same descriptor shape stays legal on the class branch (streaming is
  // a class-page feature): a compiled class with dynamic+stream admits.
  const Page = makeCompiledPageClass('stream-page');
  const page = definePage(Page, {
    renderIntent: { mode: 'dynamic', stream: { defer: ['first'] } },
  });
  expect(page).toEqual(Page);
});

// ─── 2. module-analysis: the pageComponentName fact ─────────────────────────

const FACTS_FILE = '/proj/app/routes/about.tsx';

test('pageComponentName records the definePage default-export first argument', () => {
  const source = [
    "import { definePage } from '@openelement/router';",
    'export function AboutPage(props: { title: string }) { return <main>{props.title}</main>; }',
    'export default definePage(AboutPage);',
  ].join('\n');
  const facts = analyzeModuleSemantics(source, FACTS_FILE, {
    vocabulary: ROUTER_MODULE_VOCABULARY,
  });
  expect(facts.definePage).toEqual(true);
  expect(facts.pageComponentName).toEqual('AboutPage');
  expect(facts.serverFunctionComponents).toEqual(['AboutPage']);
});

test('pageComponentName is order-independent: the default export may precede the declaration', () => {
  const source = [
    "import { definePage } from '@openelement/router';",
    'export default definePage(AboutPage);',
    'export function AboutPage(props: { title: string }) { return <main>{props.title}</main>; }',
  ].join('\n');
  const facts = analyzeModuleSemantics(source, FACTS_FILE, {
    vocabulary: ROUTER_MODULE_VOCABULARY,
  });
  expect(facts.pageComponentName).toEqual('AboutPage');
  expect(facts.serverFunctionComponents).toEqual(['AboutPage']);
});

test('pageComponentName is spread-conditional: absent for class pages and plain modules', () => {
  const classPage = [
    "import { definePage } from '@openelement/router';",
    'export default definePage(HomePage);',
  ].join('\n');
  expect(
    analyzeModuleSemantics(classPage, FACTS_FILE, { vocabulary: ROUTER_MODULE_VOCABULARY })
      .pageComponentName,
  ).toEqual(undefined);
  expect(analyzeModuleSemantics('export const x = 1;', FACTS_FILE).pageComponentName).toEqual(
    undefined,
  );
});

test('pageComponentName never records a defineLitPage first argument', () => {
  // The lit factory's first argument is a tag string, not a component.
  const lit = [
    "import { defineLitPage } from '@openelement/router/lit';",
    'export default defineLitPage(pageTag, NotesPage, {});',
  ].join('\n');
  expect(
    analyzeModuleSemantics(lit, FACTS_FILE, { vocabulary: ROUTER_MODULE_VOCABULARY })
      .pageComponentName,
  ).toEqual(undefined);
});

// ─── 3. route-scanner: the functionPage admission ───────────────────────────

const FUNCTION_ROUTE_SOURCE = [
  "import { definePage } from '@openelement/router';",
  '',
  'export const loader = async () => ({ title: "About" });',
  '',
  'export function AboutPage(props: { title: string }) {',
  '  return <main class="about-page"><h1>{props.title}</h1></main>;',
  '}',
  '',
  'export default definePage(AboutPage, { head: { title: "About" } });',
].join('\n');

async function scanOneRoute(fileName: string, source: string) {
  const dir = await mkdtemp(join(tmpdir(), 'oe-function-page-'));
  await writeFile(join(dir, fileName), source, 'utf8');
  const routes = await scanRoutes(dir);
  expect(routes).toHaveLength(1);
  return routes[0];
}

test('the scanner admits export default definePage(ExportedComponent) as a function page', async () => {
  const route = await scanOneRoute('about.tsx', FUNCTION_ROUTE_SOURCE);
  expect(route.functionPage).toEqual('AboutPage');
  expect(route.definePage).toEqual(true);
});

test('an inline-arrow definePage argument is never admitted (no runtime JSX escape)', async () => {
  const route = await scanOneRoute(
    'about.tsx',
    [
      "import { definePage } from '@openelement/router';",
      'export default definePage((props) => <main>{props.title}</main>);',
    ].join('\n'),
  );
  expect(route.functionPage).toEqual(undefined);
});

test('an unexported component argument is never admitted', async () => {
  const route = await scanOneRoute(
    'about.tsx',
    [
      "import { definePage } from '@openelement/router';",
      'function Local(props: { title: string }) { return <main>{props.title}</main>; }',
      'export default definePage(Local);',
    ].join('\n'),
  );
  expect(route.functionPage).toEqual(undefined);
});

test('a definePage route over an imported class keeps its class-page shape', async () => {
  const route = await scanOneRoute(
    'about.tsx',
    [
      "import { definePage } from '@openelement/router';",
      "import { AboutPage } from '../components/about-page.tsx';",
      'export default definePage(AboutPage, { head: { title: "About" } });',
    ].join('\n'),
  );
  expect(route.functionPage).toEqual(undefined);
  expect(route.definePage).toEqual(true);
});

// ─── 4. descriptor + generated entry wiring ─────────────────────────────────

const functionRoute: RouteEntry = {
  path: '/about',
  filePath: 'about.tsx',
  type: 'page',
  varName: 'pageAbout',
  definePage: true,
  functionPage: 'AboutPage',
};

test('buildEntryDescriptor carries functionPage into the page route declaration', () => {
  const desc = buildEntryDescriptor([functionRoute], { ssg: true });
  expect(desc.pageRoutes[0].functionPage).toEqual('AboutPage');
});

test('the generated entry registers nothing for a function page (zero element classes)', () => {
  const entry = renderEntry(buildEntryDescriptor([functionRoute], { ssg: true }));
  expect(entry).not.toContain('__registerSsrComponent(__resolvePageTag($pageAbout)');
  // The handler renders through the descriptor render via the one runtime seam.
  expect(entry).toContain('__renderFunctionPage(__page,');
});

test('the function-page GET handler emits no __ssr call for its route', () => {
  const desc = buildEntryDescriptor([functionRoute], {});
  const lines: string[] = [];
  renderPageRoute(
    lines,
    desc.pageRoutes[0],
    desc.renderers,
    { title: 't', lang: 'en', headExtras: '', allowHeadExtrasScripts: false },
    false,
  );
  const handler = lines.join('\n');
  expect(handler).toContain('__renderFunctionPage(__page,');
  expect(handler).not.toContain('__ssr(');
});

test('an island-free function page ships no client entry (hasClientEntry false)', () => {
  const entry = renderEntry(buildEntryDescriptor([functionRoute], { ssg: true }));
  // The dev client-script descriptor is compile-time-disabled for this entry.
  expect(entry).toContain('devClientScriptSrc: import.meta.env.DEV && false ?');
});

test('a function page composing an island keeps island delivery wiring (true)', () => {
  const desc = buildEntryDescriptor([functionRoute], {
    ssg: true,
    islandTagNames: ['open-counter'],
    islandFiles: ['open-counter.ts'],
  });
  const entry = renderEntry(desc);
  expect(entry).toContain('devClientScriptSrc: import.meta.env.DEV && true ?');
  expect(entry).toContain('"open-counter": "/app/islands/open-counter.ts"');
});

// ─── 5. The real pipeline harness: compiled fixture → executed entry ────────

const ROUTE_FILE = '/proj/app/routes/about.tsx';

let scratch: string;
let serial = 0;

beforeAll(async () => {
  // The generated harness imports the same BARE specifiers a compiled route
  // module does ('@openelement/router', '@openelement/router/server-runtime',
  // '@openelement/element/server'), which resolve by walking node_modules
  // from the importing file. No ancestor link can be relied on: the repo
  // root links only its own devDependencies (compiler/element/ui — see the
  // lockfile's root importer) and packages/router carries no self-link, so a
  // scratch dir under either one cannot resolve '@openelement/router' in a
  // clean install. This machine happened to carry a hand-made absolute
  // `node_modules/@openelement/router` link, which is why a repo-root
  // invocation passed locally while the canonical one
  // (`vp run @openelement/router#test` → vitest from packages/router) failed
  // on CI with `Cannot find package '@openelement/router'` for all eight
  // harness-driven tests.
  //
  // The scratch dir therefore carries its OWN node_modules with links to the
  // workspace packages, so resolution is identical under any cwd and any
  // install layout. The anchor is this file's location, never
  // `process.cwd()`.
  const repoRoot = join(import.meta.dirname, '..', '..', '..');
  scratch = join(repoRoot, 'node_modules', '.oe-function-page');
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
 * `renderFunctionPage` seam and the true props projector are imported; only
 * pure wrapping/document helpers are miniatured (the html-page.test pattern).
 */
const HARNESS_RUNTIME = `
import { renderFunctionPage as __renderFunctionPage, createPagePropsRuntime, pageDefinition as __pageDefinition, routeMeta as __routeMeta } from '@openelement/router/server-runtime';
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

/** Load the request-time GET handler over the compiled fixture (real runtime seams). */
async function loadRequestTimeHandler(
  routes: RouteEntry[],
  routeModuleFile: string,
  options: { layout?: string | false } = {},
) {
  const desc = buildEntryDescriptor(routes, { layout: options.layout ?? false });
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
${HARNESS_RUNTIME}
import * as $pageAbout from './${routeModuleFile}';
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

/** Load the SSG renderRoute section over the compiled fixture (real runtime seams). */
async function loadSsgRenderRoute(routes: RouteEntry[], routeModuleFile: string) {
  const desc = buildEntryDescriptor(routes, { ssg: true, layout: false });
  const harness = `
const __headExtras = '';
${HARNESS_RUNTIME}
import * as $pageAbout from './${routeModuleFile}';
${renderSsgSection(desc)}
`.replaceAll('import.meta.env.PROD', 'false');
  const file = join(scratch, `ssg-${serial++}.mjs`);
  await writeFile(file, harness);
  const mod = (await import(pathToFileURL(file).href)) as {
    renderRoute: (
      path: string,
      opts?: Record<string, unknown>,
    ) => Promise<{ html: string; status?: number; errors: Array<{ message: string }> }>;
  };
  return mod.renderRoute;
}

/** Write the compiled fixture module and return its scratch file name. */
async function writeCompiledRoute(source: string): Promise<string> {
  const compiled = compileServerComponentModule(source, ROUTE_FILE);
  if (compiled === null) throw new Error('the fixture route compiled to nothing');
  const js = ts.transpileModule(compiled.code, {
    fileName: ROUTE_FILE,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const name = `route-${serial++}.mjs`;
  await writeFile(join(scratch, name), js);
  return name;
}

const XSS_ROUTE = [
  "import { definePage } from '@openelement/router';",
  '',
  "export const loader = async () => ({ bio: '<script>alert(1)</script>' });",
  '',
  'export function BioPage(props: { bio: string }) {',
  '  return <article class="bio"><p>{props.bio}</p></article>;',
  '}',
  '',
  'export default definePage(BioPage, { head: { title: "Bio" } });',
].join('\n');

test('request time: a hostile loader payload is escaped by the compiled constructor (real bytes)', async () => {
  const routeModule = await writeCompiledRoute(XSS_ROUTE);
  const run = await loadRequestTimeHandler([functionRoute], routeModule);
  const { status, html } = await run('/about');
  expect(status).toEqual(200);
  // The compiled function rides the ONE text channel (__t). No raw <script>
  // byte may survive anywhere in the document, and the layout wrap composes.
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script');
  expect(html).toContain('<layout>');
  expect(html).toContain('class="bio"');
});

test('request time: the function page renders through the descriptor render seam', async () => {
  const routeModule = await writeCompiledRoute(FUNCTION_ROUTE_SOURCE);
  const run = await loadRequestTimeHandler([functionRoute], routeModule);
  const { status, html } = await run('/about');
  expect(status).toEqual(200);
  expect(html).toContain('<h1>About</h1>');
});

test('request time: a loader-injected children key is refused with OE_PAGE_FUNCTION_PROPS', async () => {
  // The loader data reaches the props record (children is not a dangerous
  // key), and the render seam refuses BEFORE the render function runs: the
  // compiler-owned composition channel is not a loader channel.
  const routeModule = await writeCompiledRoute(
    [
      "import { definePage } from '@openelement/router';",
      "export const loader = async () => ({ children: '<script>alert(1)</script>' });",
      'export function AboutPage(props: { title: string }) {',
      '  return <main><h1>{props.title}</h1></main>;',
      '}',
      'export default definePage(AboutPage);',
    ].join('\n'),
  );
  const run = await loadRequestTimeHandler([functionRoute], routeModule);
  const response = await run('/about');
  // The render seam fails closed: the hostile markup never reaches the wire.
  expect(response.html).not.toContain('<script');
  expect(response.html).toContain('500');
});

test('request time: the error-boundary channel re-renders through the same function page', async () => {
  const routeModule = await writeCompiledRoute(
    [
      "import { definePage } from '@openelement/router';",
      "export const loader = async () => { throw new Error('loader exploded'); };",
      'export function AboutPage(props: { title: string }) {',
      '  return <main><h1>{props.title}</h1></main>;',
      '}',
      'export default definePage(AboutPage, { error: () => ({ title: "recovered" }) });',
    ].join('\n'),
  );
  const run = await loadRequestTimeHandler([functionRoute], routeModule);
  const { status, html } = await run('/about');
  expect(status).toEqual(500);
  expect(html).toContain('<h1>recovered</h1>');
});

test('request time: redirect out of the function-page loader short-circuits with the authored status', async () => {
  // Parity with the template-page redirect row: the redirect channel is the
  // same catch block. A function page's body is a single JSX return (it
  // cannot throw inline), so the throw comes from the route loader — the
  // realistic spelling — and answers the authored 3xx untouched.
  const routeModule = await writeCompiledRoute(
    [
      "import { definePage } from '@openelement/router';",
      "export const loader = async () => { throw Object.assign(new Error('redirect'), { name: 'OpenElementRedirect', __openRedirect: true, location: '/login', status: 302 }); };",
      'export function AboutPage(props: { title: string }) {',
      '  return <main><h1>{props.title}</h1></main>;',
      '}',
      'export default definePage(AboutPage);',
    ].join('\n'),
  );
  const run = await loadRequestTimeHandler([functionRoute], routeModule);
  const response = await run('/about');
  expect(response.status).toEqual(302);
});

test('SSG renderRoute: the function-page branch renders through the same wraps', async () => {
  const routeModule = await writeCompiledRoute(FUNCTION_ROUTE_SOURCE);
  const renderRoute = await loadSsgRenderRoute([functionRoute], routeModule);
  const result = await renderRoute('/about');
  expect(result.status).toEqual(undefined);
  expect(result.errors).toEqual([]);
  expect(result.html).toEqual(
    '<!DOCTYPE html><html lang="en"><head><title>About</title></head><body><layout><main class="about-page"><h1>About</h1></main></layout></body></html>',
  );
});

test('SSG renderRoute: the hostile payload is escaped on the SSG channel too', async () => {
  const routeModule = await writeCompiledRoute(XSS_ROUTE);
  const renderRoute = await loadSsgRenderRoute([functionRoute], routeModule);
  const result = await renderRoute('/about');
  expect(result.errors).toEqual([]);
  expect(result.html).toContain('&lt;script&gt;');
  expect(result.html).not.toContain('<script');
});

test('SSG renderRoute: the function-page error projector re-renders with status 500', async () => {
  const routeModule = await writeCompiledRoute(
    [
      "import { definePage } from '@openelement/router';",
      "export const loader = async () => { throw new Error('loader exploded'); };",
      'export function AboutPage(props: { title: string }) {',
      '  return <main><h1>{props.title}</h1></main>;',
      '}',
      'export default definePage(AboutPage, { error: () => ({ title: "recovered" }) });',
    ].join('\n'),
  );
  const renderRoute = await loadSsgRenderRoute([functionRoute], routeModule);
  const result = await renderRoute('/about');
  expect(result.status).toEqual(500);
  expect(result.html).toContain('<h1>recovered</h1>');
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].message).toEqual('loader exploded');
});

test('a function-page-only project admits no islands and no static components', () => {
  const desc = buildEntryDescriptor([functionRoute], { ssg: true });
  expect(desc.islands).toEqual([]);
  expect(desc.staticComponents).toEqual([]);
  // No islands and no enhanced forms → no client entry exists to ship.
  expect(desc.islands.length > 0 || desc.hasEnhancedForms === true).toEqual(false);
});

// ─── 6. The render seam: coded fail-closed behavior ─────────────────────────

test('createServerComponentSourceResolver probes relative spellings and fails open-to-null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-function-page-resolve-'));
  try {
    await writeFile(join(dir, 'shell.tsx'), `export function Shell() { return <div></div>; }`);
    await writeFile(join(dir, 'header.ts'), `export function Header() { return <p></p>; }`);
    await mkdir(join(dir, 'parts'), { recursive: true });
    await writeFile(join(dir, 'parts', 'index.tsx'), `export const x = 1;`);
    const resolve = createServerComponentSourceResolver({ root: dir });
    const importer = join(dir, 'about.tsx');
    expect(await resolve('./shell.tsx', importer)).toContain('export function Shell()');
    expect(await resolve('./header', importer)).toContain('export function Header()');
    expect(await resolve('./parts', importer)).toContain('export const x = 1;');
    // Unreadable targets answer null — the compile turns that into its own
    // coded unresolvable-import rejection.
    expect(await resolve('./missing.tsx', importer)).toEqual(null);
    expect(await resolve('not-a-real-package-xyz', importer)).toEqual(null);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('a non-source import (JSON data module) resolves to null — its bytes never reach the parser', async () => {
  // A route module importing a `.json` data module is ordinary authored
  // source shape (www's 404 imports its redirect table). The resolver feeds
  // the compiler, which parses every answer as TSX; handing it the JSON bytes
  // crashed the parse with an unrelated TypeScript emit failure instead of
  // composing nothing. A non-source spelling answers null, so the import is
  // simply not a composition candidate.
  const dir = await mkdtemp(join(tmpdir(), 'oe-function-page-resolve-json-'));
  try {
    await writeFile(join(dir, 'table.json'), `{"redirects":[]}`);
    await writeFile(join(dir, 'page.css'), `.a{}`);
    const resolve = createServerComponentSourceResolver({ root: dir });
    const importer = join(dir, 'about.tsx');
    expect(await resolve('./table.json', importer)).toEqual(null);
    expect(await resolve('./page.css', importer)).toEqual(null);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('an explicit non-source import is never satisfied by a source sibling', async () => {
  // `./table.json` names the JSON data module — never the `table.json.ts`
  // that happens to sit beside it. Suffix probing may only append to a
  // spelling that can carry source: an explicit non-source extension is a
  // different module identity, and inventing a source file for it would hand
  // the parser a module the page never imported. The answer must not depend
  // on which unrelated files exist in the directory.
  const dir = await mkdtemp(join(tmpdir(), 'oe-function-page-resolve-nonsource-'));
  try {
    await writeFile(join(dir, 'table.json'), `{"redirects":[]}`);
    await writeFile(
      join(dir, 'table.json.ts'),
      `export function Ghost(props: { label: string }) { return <b>{props.label}</b>; }`,
    );
    await writeFile(join(dir, 'page.css'), `.a{}`);
    await writeFile(join(dir, 'page.css.ts'), `export const sheet = 1;`);
    await mkdir(join(dir, 'parts.v2'), { recursive: true });
    await writeFile(join(dir, 'parts.v2', 'index.ts'), `export const v2 = 1;`);
    const resolve = createServerComponentSourceResolver({ root: dir });
    const importer = join(dir, 'about.tsx');
    expect(await resolve('./table.json', importer)).toEqual(null);
    expect(await resolve('./page.css', importer)).toEqual(null);
    // The sibling source files are real and reachable through their OWN
    // spellings — the rejection is the identity rule, not a blanket ban.
    expect(await resolve('./table.json.ts', importer)).toContain('export function Ghost');
    // A dotted DIRECTORY keeps its bundler resolution: index probing names
    // another module identity, not a source suffix appended to this spelling.
    expect(await resolve('./parts.v2', importer)).toContain('export const v2');
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('extension resolution still resolves every real source candidate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-function-page-resolve-positive-'));
  try {
    await writeFile(join(dir, 'plain.ts'), `export const kind = 'ts';`);
    await writeFile(join(dir, 'view.tsx'), `export const kind = 'tsx';`);
    await writeFile(join(dir, 'mod.mts'), `export const kind = 'mts';`);
    await writeFile(join(dir, 'legacy.js'), `export const kind = 'js';`);
    await mkdir(join(dir, 'parts'), { recursive: true });
    await writeFile(join(dir, 'parts', 'index.tsx'), `export const kind = 'index-tsx';`);
    const resolve = createServerComponentSourceResolver({ root: dir });
    const importer = join(dir, 'about.tsx');
    // Explicit source spellings read that file.
    expect(await resolve('./plain.ts', importer)).toContain("'ts'");
    expect(await resolve('./view.tsx', importer)).toContain("'tsx'");
    expect(await resolve('./mod.mts', importer)).toContain("'mts'");
    // Extensionless spellings keep probing the whole candidate list.
    expect(await resolve('./mod', importer)).toContain("'mts'");
    expect(await resolve('./legacy', importer)).toContain("'js'");
    // A `.js` spelling whose file is authored `.ts` (the TS ESM import
    // rewrite) still resolves through the stripped stem.
    expect(await resolve('./plain.js', importer)).toContain("'ts'");
    // Directory spellings resolve their index.
    expect(await resolve('./parts', importer)).toContain("'index-tsx'");
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('a page importing ./table.json composes nothing from a neighbouring table.json.ts', async () => {
  // Consumer form: the compile-time composition channel must never adopt a
  // module the page did not import. The real source sibling composes by call;
  // the JSON import is answered with nothing, so its JSX child fails closed
  // with the compiler's own coded rejection instead of the unrelated
  // "Debug Failure. Output generation failed" the sibling's bytes produced.
  const dir = await mkdtemp(join(tmpdir(), 'oe-function-page-compose-json-'));
  try {
    await writeFile(join(dir, 'table.json'), `{"redirects":[]}`);
    await writeFile(
      join(dir, 'table.json.ts'),
      `export function Ghost(props: { label: string }) { return <b>{props.label}</b>; }`,
    );
    await writeFile(
      join(dir, 'shell.tsx'),
      `export function Shell(props: { label: string }) { return <div>{props.label}</div>; }`,
    );
    const importer = join(dir, 'about.tsx');
    const resolve = createServerComponentSourceResolver({ root: dir });
    const compile = (source: string): ReturnType<typeof compileServerComponentModule> =>
      compileServerComponentModule(source, importer, {
        resolveModule: (specifier) => resolve(specifier, importer) ?? undefined,
      });
    const composed = compile(
      [
        "import { Shell } from './shell.tsx';",
        'export function AboutPage(props: { label: string }) {',
        '  return <main><Shell label={props.label}></Shell></main>;',
        '}',
      ].join('\n'),
    );
    expect(composed).not.toEqual(null);
    expect(composed!.code).toContain('Shell(');
    expect(() =>
      compile(
        [
          "import { Ghost } from './table.json';",
          'export function OtherPage(props: { label: string }) {',
          '  return <main><Ghost label={props.label}></Ghost></main>;',
          '}',
        ].join('\n'),
      ),
    ).toThrowError(/OEC9032/);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('renderFunctionPage refuses a page whose render is not a function', () => {
  expect(() => renderFunctionPage({ kind: 'function-page' }, {})).toThrowError(
    /function page render is not a function/,
  );
  expect(codeOf(() => renderFunctionPage({ kind: 'function-page' }, {}))).toEqual(
    PageErrorCode.FUNCTION_RENDER,
  );
  expect(codeOf(() => renderFunctionPage(null, {}))).toEqual(PageErrorCode.FUNCTION_RENDER);
});

test('renderFunctionPage refuses props carrying children — the composition channel is compiler-owned', () => {
  const page = { kind: 'function-page', render: () => '<p>x</p>' };
  expect(codeOf(() => renderFunctionPage(page, { children: '<script>alert(1)</script>' }))).toEqual(
    PageErrorCode.FUNCTION_PROPS,
  );
  // A benign call renders through the descriptor render untouched.
  const benign = { kind: 'function-page', render: (_props?: unknown) => '<p>ok</p>' };
  expect(renderFunctionPage(benign, { title: 'x' })).toEqual('<p>ok</p>');
});

// ─── 7. Resource collection: light-root class candidates ────────────────────

test('the shadow-candidate collection registers a function page module light-root candidates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-function-page-candidates-'));
  try {
    const file = 'about.tsx';
    await writeFile(join(dir, file), FUNCTION_ROUTE_SOURCE, 'utf8');
    const candidates = createClassCandidateRegistry();
    const contributed = await collectShadowClassCandidates({
      root: dir,
      modules: [{ path: file }],
      candidates,
    });
    expect(contributed).toBeGreaterThan(0);
    expect(candidates.forModule(join(dir, file))).toContain('about-page');
    // Light-root registration: the document-sheet view carries the tokens.
    expect(candidates.allLight()).toContain('about-page');
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});
