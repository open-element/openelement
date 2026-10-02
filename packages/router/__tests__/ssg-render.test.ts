/**
 * @openelement/router - ssg-render.ts tests
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { Hono } from 'hono';
import { ssgRender } from '../src/vite/internal/ssg/index.ts';
import { resolveDynamicRoutePath } from '../src/vite/internal/ssg/ssg-helpers.ts';
import type { SsgPageOutput, SsgRenderOptions, SsrBundle } from '../src/vite/internal/ssg/index.ts';

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function createMockBundle(overrides: Partial<SsrBundle> = {}): SsrBundle {
  const app = new Hono();
  app.get('/', (c) => c.text('ok'));
  // Mock dispatcher must serve every static routeInfo path: SSG discovers
  // from routeInfo and renders through the real dispatcher (Beta.2.1), so a
  // routeInfo path missing from the app is a real 404, not a silent skip.
  app.get('/about', (c) => c.text('about ok'));
  return {
    default: app,
    routeInfo: [
      { path: '/', tagName: 'index-page', isDynamic: false, paramNames: [] },
      { path: '/about', tagName: 'about-page', isDynamic: false, paramNames: [] },
    ],
    ...overrides,
  };
}

const defaultOptions: SsgRenderOptions = {
  root: process.cwd(),
  outDir: './dist-test-ssg-render',
};

test('resolveDynamicRoutePath encodes safe params', () => {
  expect(resolveDynamicRoutePath('/blog/:slug', ['slug'], { slug: 'hello world' })).toEqual(
    '/blog/hello%20world',
  );
});

test('resolveDynamicRoutePath rejects path traversal params', () => {
  assertThrowsIncludes(
    () => resolveDynamicRoutePath('/blog/:slug', ['slug'], { slug: '../evil' }),
    Error,
    'Unsafe value',
  );
  assertThrowsIncludes(
    () => resolveDynamicRoutePath('/blog/:slug', ['slug'], { slug: '..' }),
    Error,
    'Unsafe value',
  );
  assertThrowsIncludes(
    () => resolveDynamicRoutePath('/blog/:slug', ['slug'], { slug: 'a/b' }),
    Error,
    'Unsafe value',
  );
});

test('resolveDynamicRoutePath rejects missing params', () => {
  assertThrowsIncludes(
    () => resolveDynamicRoutePath('/blog/:slug', ['slug'], {}),
    Error,
    'Missing value',
  );
});

test('ssgRender - rejects when module has no default export', async () => {
  const bundle = createMockBundle({ default: undefined });
  await assertRejectsIncludes(
    () => ssgRender(bundle as SsrBundle, defaultOptions),
    Error,
    'no Hono app found',
  );
});

test('ssgRender - throws when routeInfo is empty', async () => {
  const bundle = createMockBundle({ routeInfo: [] });
  await assertRejectsIncludes(() => ssgRender(bundle, defaultOptions), Error, 'routeInfo is empty');
});

test('ssgRender - never emits an ISR manifest (#1217: ISR removed in v0.44)', async () => {
  const outDir = './dist-test-ssg-render-no-isr';
  await rm(outDir, { recursive: true }).catch(() => {});
  const bundle = createMockBundle({
    routeInfo: [{ path: '/', tagName: 'index-page', isDynamic: false, paramNames: [] }],
  });

  await ssgRender(bundle, { ...defaultOptions, outDir });

  expect(await pathExists(`${outDir}/isr-manifest.json`)).toEqual(false);
  await rm(outDir, { recursive: true }).catch(() => {});
});

test('ssgRender - handles dynamic routes with no getStaticPaths', async () => {
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/blog/:slug', tagName: 'blog-page', isDynamic: true, paramNames: ['slug'] },
    ],
    renderRoute: undefined,
    getStaticPaths: undefined,
  });
  await ssgRender(bundle, defaultOptions);
});

test('ssgRender - getStaticPaths failure aborts build under fail policy (default)', async () => {
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/blog/:slug', tagName: 'blog-page', isDynamic: true, paramNames: ['slug'] },
    ],
    renderRoute: (() =>
      Promise.resolve({
        html: '<html><body>test</body></html>',
        errors: [],
        componentCount: 0,
        renderTimeMs: 0,
      } as SsgPageOutput)) as SsrBundle['renderRoute'],
    getStaticPaths: (() => Promise.reject(new Error('fail'))) as SsrBundle['getStaticPaths'],
  });
  await assertRejectsIncludes(
    () => ssgRender(bundle, defaultOptions),
    Error,
    'getStaticPaths for /blog/:slug failed',
  );
});

test('ssgRender - getStaticPaths failure logs and continues under warn policy', async () => {
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/blog/:slug', tagName: 'blog-page', isDynamic: true, paramNames: ['slug'] },
    ],
    renderRoute: (() =>
      Promise.resolve({
        html: '<html><body>test</body></html>',
        errors: [],
        componentCount: 0,
        renderTimeMs: 0,
      } as SsgPageOutput)) as SsrBundle['renderRoute'],
    getStaticPaths: (() => Promise.reject(new Error('fail'))) as SsrBundle['getStaticPaths'],
  });
  await ssgRender(bundle, { ...defaultOptions, dynamicRouteFailure: 'warn' });
});

test('ssgRender - handles empty getStaticPaths gracefully', async () => {
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/blog/:slug', tagName: 'blog-page', isDynamic: true, paramNames: ['slug'] },
    ],
    renderRoute: (() =>
      Promise.resolve({
        html: '<html><body>test</body></html>',
        errors: [],
        componentCount: 0,
        renderTimeMs: 0,
      } as SsgPageOutput)) as SsrBundle['renderRoute'],
    getStaticPaths: (() => Promise.resolve([])) as SsrBundle['getStaticPaths'],
  });
  await ssgRender(bundle, defaultOptions);
});

test('ssgRender - handles options with viewTransition disabled', async () => {
  const bundle = createMockBundle();
  await ssgRender(bundle, { ...defaultOptions, viewTransition: false });
});

test('ssgRender - handles options with speculation enabled', async () => {
  const bundle = createMockBundle();
  await ssgRender(bundle, { ...defaultOptions, speculation: true });
});

// ─── #674: output mkdir failures must propagate, not be swallowed ───

test('ssgRender - output mkdir failure aborts the build with the fs error (#674)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    // A regular file sits where the output directory must be created, so the
    // recursive mkdir fails (ENOTDIR). Previously this was swallowed and the
    // build misreported the root cause downstream.
    await writeFile(`${root}/dist`, 'blocker');
    const bundle = createMockBundle();

    const error = await assertRejectsIncludes(
      () => ssgRender(bundle, { root, outDir: './dist' }),
      Error,
    );
    expect(String(error)).toContain('dist');
  } finally {
    await rm(root, { recursive: true }).catch(() => {});
  }
});

// ─── alpha.18 R2-H3: static-route non-200 outcomes ─────────────

test('ssgRender - static non-200 routes fail the build (#600)', async () => {
  const outDir = './dist-test-ssg-render-non200';
  await rm(outDir, { recursive: true }).catch(() => {});
  const app = new Hono();
  app.get('/', (c) => c.html('<html><body>ok</body></html>'));
  app.get('/missing', (c) => c.html('<html><body>not found</body></html>', 404));
  app.get('/boom', (c) => c.html('<html><body>error</body></html>', 500));
  app.get('/moved', (c) => c.redirect('/'));
  const bundle = createMockBundle({
    default: app,
    routeInfo: [
      { path: '/', tagName: 'index-page', isDynamic: false, paramNames: [] },
      { path: '/missing', tagName: 'missing-page', isDynamic: false, paramNames: [] },
      { path: '/boom', tagName: 'boom-page', isDynamic: false, paramNames: [] },
      { path: '/moved', tagName: 'moved-page', isDynamic: false, paramNames: [] },
    ],
  });

  let err: unknown;
  try {
    await ssgRender(bundle, { ...defaultOptions, outDir });
  } catch (e) {
    err = e;
  }
  expect(err instanceof Error, 'expected SSG to throw on static non-200').toBeTruthy();
  expect(String(err).includes('non-200'), 'error must mention non-200').toBeTruthy();
  expect(String(err).includes('/missing'), 'error must list failing paths').toBeTruthy();
  expect(String(err).includes('/boom')).toBeTruthy();
  expect(String(err).includes('/moved')).toBeTruthy();

  // Non-200 pages are not persisted; the 200 page may already be written.
  expect(await pathExists(`${outDir}/missing.html`)).toEqual(false);
  expect(await pathExists(`${outDir}/missing/index.html`)).toEqual(false);
  expect(await pathExists(`${outDir}/boom.html`)).toEqual(false);
  expect(await pathExists(`${outDir}/boom/index.html`)).toEqual(false);
  await rm(outDir, { recursive: true }).catch(() => {});
});

test('ssgRender - dynamic-route defined 500 output fails the pipeline and writes nothing', async () => {
  const outDir = './dist-test-ssg-render-dyn500';
  await rm(outDir, { recursive: true }).catch(() => {});
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/', tagName: 'index-page', isDynamic: false, paramNames: [] },
      {
        path: '/blog/:slug',
        tagName: 'blog-page',
        isDynamic: true,
        paramNames: ['slug'],
      },
    ],
    renderRoute: (() =>
      Promise.resolve({
        html: '<html><body>500 Internal Server Error</body></html>',
        status: 500,
        errors: [
          {
            code: 'OPEN_ELEMENT_RENDER_RENDER_FAILED',
            severity: 'error',
            phase: 'render',
            tagName: 'blog-page',
            message: 'render exploded',
            recoverable: false,
          },
        ],
        componentCount: 0,
        renderTimeMs: 0,
      } as SsgPageOutput)) as SsrBundle['renderRoute'],
    getStaticPaths: (() => Promise.resolve([{ slug: 'a' }])) as SsrBundle['getStaticPaths'],
  });

  await assertRejectsIncludes(
    () => ssgRender(bundle, { ...defaultOptions, outDir }),
    Error,
    '/blog/a',
  );
  expect(await pathExists(`${outDir}/blog/a/index.html`)).toEqual(false);
  await rm(outDir, { recursive: true }).catch(() => {});
});

test('ssgRender - dynamic-route failure in warn mode skips the failed page', async () => {
  const outDir = './dist-test-ssg-render-dynwarn';
  await rm(outDir, { recursive: true }).catch(() => {});
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/', tagName: 'index-page', isDynamic: false, paramNames: [] },
      {
        path: '/blog/:slug',
        tagName: 'blog-page',
        isDynamic: true,
        paramNames: ['slug'],
      },
    ],
    renderRoute: ((_path: string, opts?: Record<string, unknown>) => {
      const slug = (opts?.params as Record<string, string>).slug;
      return Promise.resolve(
        slug === 'a'
          ? ({
              html: '<html><body>ok</body></html>',
              errors: [],
              componentCount: 0,
              renderTimeMs: 0,
            } as SsgPageOutput)
          : ({
              html: '<html><body>500 Internal Server Error</body></html>',
              status: 500,
              errors: [
                {
                  code: 'OPEN_ELEMENT_RENDER_RENDER_FAILED',
                  severity: 'error',
                  phase: 'render',
                  tagName: 'blog-page',
                  message: 'render exploded',
                  recoverable: false,
                },
              ],
              componentCount: 0,
              renderTimeMs: 0,
            } as SsgPageOutput),
      );
    }) as SsrBundle['renderRoute'],
    getStaticPaths: (() =>
      Promise.resolve([{ slug: 'a' }, { slug: 'b' }])) as SsrBundle['getStaticPaths'],
  });

  await ssgRender(bundle, { ...defaultOptions, outDir, dynamicRouteFailure: 'warn' });
  expect(await pathExists(`${outDir}/blog/a/index.html`)).toEqual(true);
  expect(await pathExists(`${outDir}/blog/b/index.html`)).toEqual(false);
  await rm(outDir, { recursive: true }).catch(() => {});
});

// ─── 0.42.0-alpha.1 (ADR-0120): request-time route partition ──────────────

test('ssgRender - request-time routes skip prerender and emit server artifacts', async () => {
  const outDir = './dist-test-ssg-render-request-time';
  await rm(outDir, { recursive: true }).catch(() => {});
  const app = new Hono();
  app.get('/', (c) => c.html('<html><body>static home</body></html>'));
  app.get('/live', (c) => c.html('<html><body>request time</body></html>'));
  const bundle = createMockBundle({
    default: app,
    routeInfo: [
      { path: '/', tagName: 'index-page', isDynamic: false, paramNames: [] },
      {
        path: '/live',
        tagName: 'live-page',
        isDynamic: false,
        paramNames: [],
        rendering: 'dynamic',
        hasAction: true,
      },
    ],
  });

  await ssgRender(bundle, { ...defaultOptions, outDir });

  // The static route is prerendered; the request-time route is not.
  expect(
    await pathExists(`${outDir}/index.html`),
    'static route should be prerendered',
  ).toBeTruthy();
  expect(
    !(await pathExists(`${outDir}/live/index.html`)) && !(await pathExists(`${outDir}/live.html`)),
    'request-time route must not be prerendered',
  ).toBeTruthy();

  // Server artifacts land next to the SSR bundle.
  const manifest = JSON.parse(await readFile(`${outDir}/server/server-manifest.json`, 'utf8'));
  expect(manifest).toEqual({
    version: 1,
    requestTimeRoutes: [{ path: '/live', paramNames: [], hasAction: true }],
  });
  const serverEntry = await readFile(`${outDir}/server/index.js`, 'utf8');
  expect(serverEntry.includes('openElementHandler')).toBeTruthy();
  expect(serverEntry.includes('const nitroHandler')).toBeTruthy();
  expect(serverEntry.includes("from './entry.js'")).toBeTruthy();

  // No second production server is generated: local preview is served by
  // the start CLI from TypeScript source and deploys go through the Nitro
  // mount, so dist/server carries only the portable fetch entry.
  expect(await pathExists(`${outDir}/server/serve.mjs`), 'serve.mjs must not be generated').toEqual(
    false,
  );

  await rm(outDir, { recursive: true }).catch(() => {});
});

test('ssgRender - index route under a directory prefix gets a clean URL (#956)', async () => {
  const outDir = './dist-test-ssg-render-blog-index';
  await rm(outDir, { recursive: true }).catch(() => {});
  const app = new Hono();
  app.get('/', (c) => c.html('<html><body>home</body></html>'));
  app.get('/blog', (c) => c.html('<html><body>blog index</body></html>'));
  app.get('/blog/first-post', (c) => c.html('<html><body>first post</body></html>'));
  const bundle = createMockBundle({
    default: app,
    routeInfo: [
      { path: '/', tagName: 'index-page', isDynamic: false, paramNames: [] },
      { path: '/blog', tagName: 'blog-index-page', isDynamic: false, paramNames: [] },
      { path: '/blog/first-post', tagName: 'blog-post-page', isDynamic: false, paramNames: [] },
    ],
  });

  await ssgRender(bundle, { ...defaultOptions, outDir });

  // /blog must become blog/index.html even though blog/ already exists for
  // the article pages — before #956 the flat blog.html survived, which kept
  // /blog out of the sitemap while /blog/* articles were listed.
  expect(
    await pathExists(`${outDir}/blog/index.html`),
    'blog index must use a clean URL',
  ).toBeTruthy();
  expect(!(await pathExists(`${outDir}/blog.html`)), 'flat blog.html must be moved').toBeTruthy();
  expect(
    await pathExists(`${outDir}/blog/first-post/index.html`),
    'article page must use a clean URL',
  ).toBeTruthy();

  await rm(outDir, { recursive: true }).catch(() => {});
});

test('ssgRender - hybrid pages (static GET + action) prerender and emit server artifacts (ADR-0120 amendment)', async () => {
  const outDir = './dist-test-ssg-render-hybrid';
  await rm(outDir, { recursive: true }).catch(() => {});
  const app = new Hono();
  app.get('/', (c) => c.html('<html><body>static home</body></html>'));
  app.get('/guestbook', (c) => c.html('<html><body>guestbook</body></html>'));
  const bundle = createMockBundle({
    default: app,
    routeInfo: [
      { path: '/', tagName: 'index-page', isDynamic: false, paramNames: [] },
      {
        path: '/guestbook',
        tagName: 'guestbook-page',
        isDynamic: false,
        paramNames: [],
        hasAction: true,
      },
    ],
  });

  await ssgRender(bundle, { ...defaultOptions, outDir });

  // The hybrid route's GET is prerendered like any static page.
  expect(
    await pathExists(`${outDir}/guestbook/index.html`),
    'hybrid route GET must be prerendered',
  ).toBeTruthy();

  // dist/server IS emitted for a static+action-only project so POSTs do not
  // 404 in production; the manifest schema is unchanged and lists no
  // request-time routes (POST admission is method-based).
  const manifest = JSON.parse(await readFile(`${outDir}/server/server-manifest.json`, 'utf8'));
  expect(manifest).toEqual({ version: 1, requestTimeRoutes: [] });
  expect(
    await pathExists(`${outDir}/server/index.js`),
    'server entry must be emitted',
  ).toBeTruthy();
  // The admission table is empty: hybrid GET paths are NOT admitted to the
  // request-time server (they stay on the static artifact).
  const serverEntry = await readFile(`${outDir}/server/index.js`, 'utf8');
  expect(serverEntry).toContain('const requestTimePatterns = [\n\n];');

  await rm(outDir, { recursive: true }).catch(() => {});
});

test('ssgRender - pure-static projects emit no server artifacts', async () => {
  const outDir = './dist-test-ssg-render-pure-static';
  await rm(outDir, { recursive: true }).catch(() => {});
  const bundle = createMockBundle();

  await ssgRender(bundle, { ...defaultOptions, outDir });

  expect(
    !(await pathExists(`${outDir}/server/server-manifest.json`)),
    'pure-static build must not emit a server manifest',
  ).toBeTruthy();
  expect(
    !(await pathExists(`${outDir}/server/index.js`)),
    'pure-static build must not emit a server entry',
  ).toBeTruthy();
  await rm(outDir, { recursive: true }).catch(() => {});
});

// ─── 0.42.0-alpha.1 (ADR-0120): generated request-time server entry ───────

test('request-time server entry serves the SSR bundle at request time', async () => {
  const { renderRequestTimeServerModule } = await import('../src/vite/internal/ssg/ssg-helpers.ts');
  const { join, toFileUrl } = await import('@std/path');

  const dir = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    // The temp fixture sits outside any node_modules tree, so the bare
    // 'hono' specifier the real generated entry uses cannot resolve there;
    // hand the fixture the resolved specifier instead.
    const honoSpecifier = import.meta.resolve('hono');
    // A minimal stand-in for the built SSR bundle: one request-time route
    // whose output depends on the live request (unlike a prerendered page).
    // The openElementHandler named export mirrors the real entry's handler
    // contract (#858), and __setRequestTimeClientScript mirrors the render-
    // time client-script embedding the generated index.js wires up.
    await writeFile(
      join(dir, 'entry.js'),
      `import { Hono } from ${JSON.stringify(honoSpecifier)};
const app = new Hono();
let __clientSrc = null;
export function __setRequestTimeClientScript(src) { __clientSrc = src || null; }
app.get('/live', (c) => c.html('<h1>live ' + new URL(c.req.url).searchParams.get('x') + '</h1>' +
  (__clientSrc ? '<script type="module" src="' + __clientSrc + '"></script>' : '')));
export const openElementHandler = (request, context = {}) =>
  app.fetch(request, context.env || {}, context.platform);
export default app;
`,
    );
    await writeFile(join(dir, 'index.js'), renderRequestTimeServerModule());
    await writeFile(
      join(dir, 'client-assets.js'),
      `export const clientAssets = { entry: '', islands: {}, shared: [] };\n`,
    );

    const mod = (await import(toFileUrl(join(dir, 'index.js')).href)) as {
      default: (event: { req: Request }) => Promise<Response>;
    };
    const response = await mod.default({ req: new Request('http://localhost/live?x=42') });
    expect(response.status).toEqual(200);
    const html = await response.text();
    expect(html.includes('live 42')).toBeTruthy();
    expect(!html.includes('type="module"'), 'no client script when none was recorded').toBeTruthy();
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('request-time server entry wires the island client script into the entry render', async () => {
  const { renderRequestTimeServerModule } = await import('../src/vite/internal/ssg/ssg-helpers.ts');
  const { join, toFileUrl } = await import('@std/path');

  const dir = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    // The temp fixture sits outside any node_modules tree; use the resolved
    // specifier (see the first request-time entry test).
    const honoSpecifier = import.meta.resolve('hono');
    await writeFile(
      join(dir, 'entry.js'),
      `import { Hono } from ${JSON.stringify(honoSpecifier)};
const app = new Hono();
let __clientSrc = null;
export function __setRequestTimeClientScript(src) { __clientSrc = src || null; }
app.get('/live', (c) => c.html('<html><body><h1>live</h1>' +
  (__clientSrc ? '<script type="module" src="' + __clientSrc + '"></script>' : '') +
  '</body></html>'));
export const openElementHandler = (request, context = {}) =>
  app.fetch(request, context.env || {}, context.platform);
export default app;
`,
    );
    await writeFile(join(dir, 'index.js'), renderRequestTimeServerModule());
    await writeFile(
      join(dir, 'client-assets.js'),
      `export const clientAssets = { entry: '/client/entry-abc123.js', islands: {}, shared: [] };\n`,
    );

    const mod = (await import(toFileUrl(join(dir, 'index.js')).href + '?with-script')) as {
      default: (event: { req: Request }) => Promise<Response>;
    };
    const response = await mod.default({ req: new Request('http://localhost/live') });
    const html = await response.text();
    expect(
      html.includes('<script type="module" src="/client/entry-abc123.js"></script>'),
      'request-time HTML must carry the island client script like static pages',
    ).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('request-time server entry isRequestTimePath admits request-time paths (#556, narrowed #1215)', async () => {
  const { renderRequestTimeServerModule } = await import('../src/vite/internal/ssg/ssg-helpers.ts');
  const { join, toFileUrl } = await import('@std/path');

  const dir = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    // The temp fixture sits outside any node_modules tree; use the resolved
    // specifier (see the first request-time entry test).
    const honoSpecifier = import.meta.resolve('hono');
    await writeFile(
      join(dir, 'entry.js'),
      `import { Hono } from ${JSON.stringify(honoSpecifier)};
const app = new Hono();
export function __setRequestTimeClientScript() {}
export const openElementHandler = (request, context = {}) =>
  app.fetch(request, context.env || {}, context.platform);
export default app;
`,
    );
    await writeFile(
      join(dir, 'index.js'),
      renderRequestTimeServerModule([
        { path: '/item/:id' },
        { path: '/form' },
        { path: '/docs/:path{.+}' },
      ]),
    );
    await writeFile(
      join(dir, 'client-assets.js'),
      `export const clientAssets = { entry: '', islands: {}, shared: [] };\n`,
    );

    const mod = (await import(toFileUrl(join(dir, 'index.js')).href + '?admission')) as {
      isRequestTimePath: (pathname: string) => boolean;
    };
    // Admission is a boolean predicate — no winner, no params (#1215).
    expect(mod.isRequestTimePath('/form')).toEqual(true);
    expect(mod.isRequestTimePath('/item/42')).toEqual(true);
    // '/item' alone matches no request-time pattern.
    expect(mod.isRequestTimePath('/item')).toEqual(false);
    // Encoded values admit without decoding (params stay canonical).
    expect(mod.isRequestTimePath('/item/hello%20world')).toEqual(true);
    // Catch-all admits across segments.
    expect(mod.isRequestTimePath('/docs/a/b/c')).toEqual(true);
    expect(mod.isRequestTimePath('/nope')).toEqual(false);
    // #823 after #1215: admission never decodes, so a malformed escape cannot
    // throw here — the static layer still answers 400 for non-admitted paths.
    expect(mod.isRequestTimePath('/item/%zz')).toEqual(true);
    // The generated module no longer exports a route winner (#1215).
    expect('matchRequestTimeRoute' in mod).toEqual(false);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('SSG discovers static pages from route records behind the unified HTTP middleware', async () => {
  const { createRouteMiddleware } = await import('@openelement/router/http');
  const root = await mkdtemp(join(tmpdir(), 'oe-record-ssg-'));
  const app = new Hono();
  let dynamicCalls = 0;
  const html = (body: string) =>
    new Response(body, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  const routeMiddleware = createRouteMiddleware([
    { id: 'index.tsx', path: '/', handlers: { GET: () => html('<main>record home</main>') } },
    {
      id: 'live.tsx',
      path: '/live',
      handlers: {
        GET: () => {
          dynamicCalls++;
          return html('live');
        },
      },
    },
  ]);
  app.all('*', (c, next) =>
    routeMiddleware(c.req.raw, async () => {
      await next();
      return c.res;
    }),
  );
  try {
    await ssgRender(
      createMockBundle({
        default: app,
        routeInfo: [
          { path: '/', tagName: 'home-page', isDynamic: false, paramNames: [] },
          {
            path: '/live',
            tagName: 'live-page',
            isDynamic: false,
            paramNames: [],
            rendering: 'dynamic',
          },
        ],
      }),
      { root, outDir: 'dist' },
    );
    expect(await readFile(`${root}/dist/index.html`, 'utf8')).toContain('record home');
    expect(dynamicCalls).toEqual(0);
    expect(await pathExists(`${root}/dist/live/index.html`)).toEqual(false);
  } finally {
    await rm(root, { recursive: true });
  }
});

// #1343 review (P2): exact-path middleware and method-only host registrations
// are filtered out of hono/ssg discovery (method ALL + arity 2, or non-GET),
// so they must not suppress the canonical GET discovery entry for the same
// path — otherwise the page silently vanishes from a successful build.
test('SSG keeps canonical pages discoverable behind exact-path host middleware (#1343)', async () => {
  const { createRouteMiddleware } = await import('@openelement/router/http');
  const root = await mkdtemp(join(tmpdir(), 'oe-mw-ssg-'));
  const app = new Hono();
  let middlewareCalls = 0;
  // Host middleware on the exact canonical path: preserved as host behavior,
  // but not an SSG-discoverable page entry.
  app.use('/about', async (_c, next) => {
    middlewareCalls++;
    await next();
  });
  const html = (body: string) =>
    new Response(body, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  const routeMiddleware = createRouteMiddleware([
    { id: 'index.tsx', path: '/', handlers: { GET: () => html('<main>home</main>') } },
    {
      id: 'about.tsx',
      path: '/about',
      handlers: { GET: () => html('<main>canonical about</main>') },
    },
  ]);
  app.all('*', (c, next) =>
    routeMiddleware(c.req.raw, async () => {
      await next();
      return c.res;
    }),
  );
  try {
    await ssgRender(
      createMockBundle({
        default: app,
        routeInfo: [
          { path: '/', tagName: 'home-page', isDynamic: false, paramNames: [] },
          { path: '/about', tagName: 'about-page', isDynamic: false, paramNames: [] },
        ],
      }),
      { root, outDir: 'dist' },
    );
    expect(await readFile(`${root}/dist/about/index.html`, 'utf8')).toContain('canonical about');
    // Host behavior is preserved: the middleware really ran for the page fetch.
    expect(middlewareCalls > 0, 'host middleware must execute for /about').toBeTruthy();
  } finally {
    await rm(root, { recursive: true });
  }
});

test('SSG keeps canonical pages discoverable behind method-only host routes (#1343)', async () => {
  const { createRouteMiddleware } = await import('@openelement/router/http');
  const root = await mkdtemp(join(tmpdir(), 'oe-postonly-ssg-'));
  const app = new Hono();
  // A POST-only host route on the canonical path is not a GET page entry.
  app.post('/contact', (c) => c.json({ ok: true }));
  const html = (body: string) =>
    new Response(body, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  const routeMiddleware = createRouteMiddleware([
    { id: 'index.tsx', path: '/', handlers: { GET: () => html('<main>home</main>') } },
    {
      id: 'contact.tsx',
      path: '/contact',
      handlers: { GET: () => html('<main>canonical contact</main>') },
    },
  ]);
  app.all('*', (c, next) =>
    routeMiddleware(c.req.raw, async () => {
      await next();
      return c.res;
    }),
  );
  try {
    await ssgRender(
      createMockBundle({
        default: app,
        routeInfo: [
          { path: '/', tagName: 'home-page', isDynamic: false, paramNames: [] },
          { path: '/contact', tagName: 'contact-page', isDynamic: false, paramNames: [] },
        ],
      }),
      { root, outDir: 'dist' },
    );
    expect(await readFile(`${root}/dist/contact/index.html`, 'utf8')).toContain(
      'canonical contact',
    );
    // The host POST route still answers through the real dispatcher.
    const posted = await app.request('/contact', { method: 'POST' });
    expect(posted.status).toEqual(200);
  } finally {
    await rm(root, { recursive: true });
  }
});
