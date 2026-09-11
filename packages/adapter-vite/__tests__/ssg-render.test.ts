/**
 * @openelement/adapter-vite - ssg-render.ts tests
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from '@std/assert';
import { Hono } from 'hono';
import { ssgRender } from '../src/internal/ssg/index.ts';
import { resolveDynamicRoutePath } from '../src/internal/ssg/ssg-helpers.ts';
import { generateSitemap } from '../src/internal/content/sitemap/generator.ts';
import type { SsgPageOutput, SsgRenderOptions, SsrBundle } from '../src/internal/ssg/index.ts';

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
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
  root: Deno.cwd(),
  outDir: './dist-test-ssg-render',
};

Deno.test('resolveDynamicRoutePath encodes safe params', () => {
  assertEquals(
    resolveDynamicRoutePath('/blog/:slug', ['slug'], { slug: 'hello world' }),
    '/blog/hello%20world',
  );
});

Deno.test('resolveDynamicRoutePath rejects path traversal params', () => {
  assertThrows(
    () => resolveDynamicRoutePath('/blog/:slug', ['slug'], { slug: '../evil' }),
    Error,
    'Unsafe value',
  );
  assertThrows(
    () => resolveDynamicRoutePath('/blog/:slug', ['slug'], { slug: '..' }),
    Error,
    'Unsafe value',
  );
  assertThrows(
    () => resolveDynamicRoutePath('/blog/:slug', ['slug'], { slug: 'a/b' }),
    Error,
    'Unsafe value',
  );
});

Deno.test('resolveDynamicRoutePath rejects missing params', () => {
  assertThrows(
    () => resolveDynamicRoutePath('/blog/:slug', ['slug'], {}),
    Error,
    'Missing value',
  );
});

Deno.test('ssgRender - rejects when module has no default export', async () => {
  const bundle = createMockBundle({ default: undefined });
  await assertRejects(
    () => ssgRender(bundle as SsrBundle, defaultOptions),
    Error,
    'no Hono app found',
  );
});

Deno.test('ssgRender - throws when routeInfo is empty', async () => {
  const bundle = createMockBundle({ routeInfo: [] });
  await assertRejects(
    () => ssgRender(bundle, defaultOptions),
    Error,
    'routeInfo is empty',
  );
});

Deno.test('ssgRender - never emits an ISR manifest (#1217: ISR removed in v0.44)', async () => {
  const outDir = './dist-test-ssg-render-no-isr';
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/', tagName: 'index-page', isDynamic: false, paramNames: [] },
    ],
  });

  await ssgRender(bundle, { ...defaultOptions, outDir });

  assertEquals(await pathExists(`${outDir}/isr-manifest.json`), false);
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
});

Deno.test('ssgRender - handles dynamic routes with no getStaticPaths', async () => {
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/blog/:slug', tagName: 'blog-page', isDynamic: true, paramNames: ['slug'] },
    ],
    renderRoute: undefined,
    getStaticPaths: undefined,
  });
  await ssgRender(bundle, defaultOptions);
});

Deno.test('ssgRender - getStaticPaths failure aborts build under fail policy (default)', async () => {
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/blog/:slug', tagName: 'blog-page', isDynamic: true, paramNames: ['slug'] },
    ],
    renderRoute: (() =>
      Promise.resolve(
        {
          html: '<html><body>test</body></html>',
          errors: [],
          componentCount: 0,
          renderTimeMs: 0,
        } as SsgPageOutput,
      )) as SsrBundle['renderRoute'],
    getStaticPaths: (() => Promise.reject(new Error('fail'))) as SsrBundle['getStaticPaths'],
  });
  await assertRejects(
    () => ssgRender(bundle, defaultOptions),
    Error,
    'getStaticPaths for /blog/:slug failed',
  );
});

Deno.test('ssgRender - getStaticPaths failure logs and continues under warn policy', async () => {
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/blog/:slug', tagName: 'blog-page', isDynamic: true, paramNames: ['slug'] },
    ],
    renderRoute: (() =>
      Promise.resolve(
        {
          html: '<html><body>test</body></html>',
          errors: [],
          componentCount: 0,
          renderTimeMs: 0,
        } as SsgPageOutput,
      )) as SsrBundle['renderRoute'],
    getStaticPaths: (() => Promise.reject(new Error('fail'))) as SsrBundle['getStaticPaths'],
  });
  await ssgRender(bundle, { ...defaultOptions, dynamicRouteFailure: 'warn' });
});

Deno.test('ssgRender - handles empty getStaticPaths gracefully', async () => {
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/blog/:slug', tagName: 'blog-page', isDynamic: true, paramNames: ['slug'] },
    ],
    renderRoute: (() =>
      Promise.resolve(
        {
          html: '<html><body>test</body></html>',
          errors: [],
          componentCount: 0,
          renderTimeMs: 0,
        } as SsgPageOutput,
      )) as SsrBundle['renderRoute'],
    getStaticPaths: (() => Promise.resolve([])) as SsrBundle['getStaticPaths'],
  });
  await ssgRender(bundle, defaultOptions);
});

Deno.test('ssgRender - handles options with viewTransition disabled', async () => {
  const bundle = createMockBundle();
  await ssgRender(bundle, { ...defaultOptions, viewTransition: false });
});

Deno.test('ssgRender - handles options with speculation enabled', async () => {
  const bundle = createMockBundle();
  await ssgRender(bundle, { ...defaultOptions, speculation: true });
});

// ─── #674: output mkdir failures must propagate, not be swallowed ───

Deno.test('ssgRender - output mkdir failure aborts the build with the fs error (#674)', async () => {
  const root = await Deno.makeTempDir();
  try {
    // A regular file sits where the output directory must be created, so the
    // recursive mkdir fails (ENOTDIR). Previously this was swallowed and the
    // build misreported the root cause downstream.
    await Deno.writeTextFile(`${root}/dist`, 'blocker');
    const bundle = createMockBundle();

    const error = await assertRejects(
      () => ssgRender(bundle, { root, outDir: './dist' }),
      Error,
    );
    assertStringIncludes(String(error), 'dist');
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

// ─── alpha.18 R2-H3: static-route non-200 outcomes ─────────────

Deno.test('ssgRender - static non-200 routes fail the build (#600)', async () => {
  const outDir = './dist-test-ssg-render-non200';
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
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
  assert(err instanceof Error, 'expected SSG to throw on static non-200');
  assert(String(err).includes('non-200'), 'error must mention non-200');
  assert(String(err).includes('/missing'), 'error must list failing paths');
  assert(String(err).includes('/boom'));
  assert(String(err).includes('/moved'));

  // Non-200 pages are not persisted; the 200 page may already be written.
  assertEquals(await pathExists(`${outDir}/missing.html`), false);
  assertEquals(await pathExists(`${outDir}/missing/index.html`), false);
  assertEquals(await pathExists(`${outDir}/boom.html`), false);
  assertEquals(await pathExists(`${outDir}/boom/index.html`), false);
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
});

Deno.test('ssgRender - dynamic-route defined 500 output fails the pipeline and writes nothing', async () => {
  const outDir = './dist-test-ssg-render-dyn500';
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
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
        errors: [{
          code: 'OPEN_ELEMENT_RENDER_RENDER_FAILED',
          severity: 'error',
          phase: 'render',
          tagName: 'blog-page',
          message: 'render exploded',
          recoverable: false,
        }],
        componentCount: 0,
        renderTimeMs: 0,
      } as SsgPageOutput)) as SsrBundle['renderRoute'],
    getStaticPaths: (() => Promise.resolve([{ slug: 'a' }])) as SsrBundle['getStaticPaths'],
  });

  await assertRejects(
    () => ssgRender(bundle, { ...defaultOptions, outDir }),
    Error,
    '/blog/a',
  );
  assertEquals(await pathExists(`${outDir}/blog/a/index.html`), false);
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
});

Deno.test('ssgRender - dynamic-route failure in warn mode skips the failed page', async () => {
  const outDir = './dist-test-ssg-render-dynwarn';
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
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
          ? {
            html: '<html><body>ok</body></html>',
            errors: [],
            componentCount: 0,
            renderTimeMs: 0,
          } as SsgPageOutput
          : {
            html: '<html><body>500 Internal Server Error</body></html>',
            status: 500,
            errors: [{
              code: 'OPEN_ELEMENT_RENDER_RENDER_FAILED',
              severity: 'error',
              phase: 'render',
              tagName: 'blog-page',
              message: 'render exploded',
              recoverable: false,
            }],
            componentCount: 0,
            renderTimeMs: 0,
          } as SsgPageOutput,
      );
    }) as SsrBundle['renderRoute'],
    getStaticPaths: (() =>
      Promise.resolve([{ slug: 'a' }, { slug: 'b' }])) as SsrBundle['getStaticPaths'],
  });

  await ssgRender(bundle, { ...defaultOptions, outDir, dynamicRouteFailure: 'warn' });
  assertEquals(await pathExists(`${outDir}/blog/a/index.html`), true);
  assertEquals(await pathExists(`${outDir}/blog/b/index.html`), false);
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
});

// ─── 0.42.0-alpha.1 (ADR-0120): request-time route partition ──────────────

Deno.test('ssgRender - request-time routes skip prerender and emit server artifacts', async () => {
  const outDir = './dist-test-ssg-render-request-time';
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
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
  assert(await pathExists(`${outDir}/index.html`), 'static route should be prerendered');
  assert(
    !(await pathExists(`${outDir}/live/index.html`)) && !(await pathExists(`${outDir}/live.html`)),
    'request-time route must not be prerendered',
  );

  // Server artifacts land next to the SSR bundle.
  const manifest = JSON.parse(await Deno.readTextFile(`${outDir}/server/server-manifest.json`));
  assertEquals(manifest, {
    version: 1,
    requestTimeRoutes: [{ path: '/live', paramNames: [], hasAction: true }],
  });
  const serverEntry = await Deno.readTextFile(`${outDir}/server/index.js`);
  assert(serverEntry.includes('openElementHandler'));
  assert(serverEntry.includes('const nitroHandler'));
  assert(serverEntry.includes("from './entry.js'"));

  // #959: the standalone server entry is emitted alongside the request-time
  // entry so the build output runs without the CLI or Nitro wiring.
  const serveEntry = await Deno.readTextFile(`${outDir}/server/serve.mjs`);
  // Dynamic import is load-bearing (#969): the URLPattern floor check must run
  // before ./index.js builds its route patterns.
  assert(
    serveEntry.includes("await import('./index.js')"),
    'serve.mjs must mount the generated entry',
  );
  assert(serveEntry.includes("from 'node:http'"), 'serve.mjs must be runtime-self-contained');

  await Deno.remove(outDir, { recursive: true }).catch(() => {});
});

Deno.test('ssgRender - index route under a directory prefix gets a clean URL and sitemap entry (#956)', async () => {
  const outDir = './dist-test-ssg-render-blog-index';
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
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

  await ssgRender(bundle, { ...defaultOptions, outDir }, {
    onGenerateSitemap: (outputDir) => {
      generateSitemap(outputDir, { hostname: 'https://example.com' });
    },
  });

  // /blog must become blog/index.html even though blog/ already exists for
  // the article pages — before #956 the flat blog.html survived, which kept
  // /blog out of the sitemap while /blog/* articles were listed.
  assert(await pathExists(`${outDir}/blog/index.html`), 'blog index must use a clean URL');
  assert(!(await pathExists(`${outDir}/blog.html`)), 'flat blog.html must be moved');
  assert(
    await pathExists(`${outDir}/blog/first-post/index.html`),
    'article page must use a clean URL',
  );

  const sitemap = await Deno.readTextFile(`${outDir}/sitemap.xml`);
  assertStringIncludes(sitemap, '<loc>https://example.com/blog</loc>');
  assertStringIncludes(sitemap, '<loc>https://example.com/blog/first-post</loc>');
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
});

Deno.test('ssgRender - pages with actions cannot be prerendered (hard rule)', async () => {
  const outDir = './dist-test-ssg-render-action-rule';
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
  const bundle = createMockBundle({
    routeInfo: [
      { path: '/', tagName: 'index-page', isDynamic: false, paramNames: [] },
      {
        path: '/form',
        tagName: 'form-page',
        isDynamic: false,
        paramNames: [],
        hasAction: true,
      },
    ],
  });

  await assertRejects(
    () => ssgRender(bundle, { ...defaultOptions, outDir }),
    Error,
    'Pages with actions cannot be prerendered',
  );
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
});

Deno.test('ssgRender - pure-static projects emit no server artifacts', async () => {
  const outDir = './dist-test-ssg-render-pure-static';
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
  const bundle = createMockBundle();

  await ssgRender(bundle, { ...defaultOptions, outDir });

  assert(
    !(await pathExists(`${outDir}/server/server-manifest.json`)),
    'pure-static build must not emit a server manifest',
  );
  assert(
    !(await pathExists(`${outDir}/server/index.js`)),
    'pure-static build must not emit a server entry',
  );
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
});

// ─── 🟡-A: sitemap generation failure observability ────────────

Deno.test('ssgRender - sitemap failure is surfaced as a warning when sitemapFailure: warn (no throw)', async () => {
  const outDir = './dist-test-ssg-render-sitemap-warn';
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
  const bundle = createMockBundle();

  const summary = await ssgRender(
    bundle,
    {
      ...defaultOptions,
      outDir,
      // 🟡-A fix: explicit 'warn' downgrades the failure to a recorded warning
      sitemapFailure: 'warn',
    },
    {
      onGenerateSitemap: () => {
        throw new Error('boom');
      },
    },
  );

  assertEquals(summary.warnings.length, 1);
  assertStringIncludes(summary.warnings[0], 'Sitemap generation failed');
  assertStringIncludes(summary.warnings[0], 'boom');
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
});

Deno.test('ssgRender - sitemap failure aborts the build by default (sitemapFailure defaults to fail)', async () => {
  const outDir = './dist-test-ssg-render-sitemap-fail';
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
  const bundle = createMockBundle();

  await assertRejects(
    () =>
      ssgRender(
        bundle,
        { ...defaultOptions, outDir },
        {
          onGenerateSitemap: () => {
            throw new Error('boom');
          },
        },
      ),
    Error,
    'Sitemap generation failed',
  );
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
});

Deno.test('ssgRender - successful sitemap run records no warnings', async () => {
  const outDir = './dist-test-ssg-render-sitemap-ok';
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
  const bundle = createMockBundle();

  const summary = await ssgRender(
    bundle,
    { ...defaultOptions, outDir },
    { onGenerateSitemap: () => {} },
  );

  assertEquals(summary.warnings, []);
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
});

// ─── 0.42.0-alpha.1 (ADR-0120): generated request-time server entry ───────

Deno.test('request-time server entry serves the SSR bundle at request time', async () => {
  const { renderRequestTimeServerModule } = await import(
    '../src/internal/ssg/ssg-helpers.ts'
  );
  const { join, toFileUrl } = await import('@std/path');

  const dir = await Deno.makeTempDir();
  try {
    // A minimal stand-in for the built SSR bundle: one request-time route
    // whose output depends on the live request (unlike a prerendered page).
    // The openElementHandler named export mirrors the real entry's handler
    // contract (#858) that the generated server module imports.
    await Deno.writeTextFile(
      join(dir, 'entry.js'),
      `import { Hono } from 'hono';
const app = new Hono();
app.get('/live', (c) => c.html('<h1>live ' + new URL(c.req.url).searchParams.get('x') + '</h1>'));
export const openElementHandler = (request, context = {}) =>
  app.fetch(request, context.env || {}, context.platform);
export default app;
`,
    );
    await Deno.writeTextFile(join(dir, 'index.js'), renderRequestTimeServerModule());
    await Deno.writeTextFile(join(dir, 'client-script.js'), `export const clientScriptSrc = '';\n`);

    const mod = await import(toFileUrl(join(dir, 'index.js')).href) as {
      default: (event: { req: Request }) => Promise<Response>;
    };
    const response = await mod.default({ req: new Request('http://localhost/live?x=42') });
    assertEquals(response.status, 200);
    const html = await response.text();
    assert(html.includes('live 42'));
    assert(!html.includes('type="module"'), 'no client script when none was recorded');
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test('request-time server entry injects the island client script into HTML responses', async () => {
  const { renderRequestTimeServerModule } = await import(
    '../src/internal/ssg/ssg-helpers.ts'
  );
  const { join, toFileUrl } = await import('@std/path');

  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, 'entry.js'),
      `import { Hono } from 'hono';
const app = new Hono();
app.get('/live', (c) => c.html('<html><body><h1>live</h1></body></html>'));
export const openElementHandler = (request, context = {}) =>
  app.fetch(request, context.env || {}, context.platform);
export default app;
`,
    );
    await Deno.writeTextFile(join(dir, 'index.js'), renderRequestTimeServerModule());
    await Deno.writeTextFile(
      join(dir, 'client-script.js'),
      `export const clientScriptSrc = '/client/entry-abc123.js';\n`,
    );

    const mod = await import(toFileUrl(join(dir, 'index.js')).href + '?with-script') as {
      default: (event: { req: Request }) => Promise<Response>;
    };
    const response = await mod.default({ req: new Request('http://localhost/live') });
    const html = await response.text();
    assert(
      html.includes('<script type="module" src="/client/entry-abc123.js"></script>'),
      'request-time HTML must carry the island client script like static pages',
    );
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test('request-time server entry isRequestTimePath admits request-time paths (#556, narrowed #1215)', async () => {
  const { renderRequestTimeServerModule } = await import(
    '../src/internal/ssg/ssg-helpers.ts'
  );
  const { join, toFileUrl } = await import('@std/path');

  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, 'entry.js'),
      `import { Hono } from 'hono';
const app = new Hono();
export const openElementHandler = (request, context = {}) =>
  app.fetch(request, context.env || {}, context.platform);
export default app;
`,
    );
    await Deno.writeTextFile(
      join(dir, 'index.js'),
      renderRequestTimeServerModule([
        { path: '/item/:id' },
        { path: '/form' },
        { path: '/docs/:path{.+}' },
      ]),
    );
    await Deno.writeTextFile(join(dir, 'client-script.js'), `export const clientScriptSrc = '';\n`);

    const mod = await import(toFileUrl(join(dir, 'index.js')).href + '?admission') as {
      isRequestTimePath: (pathname: string) => boolean;
    };
    // Admission is a boolean predicate — no winner, no params (#1215).
    assertEquals(mod.isRequestTimePath('/form'), true);
    assertEquals(mod.isRequestTimePath('/item/42'), true);
    // '/item' alone matches no request-time pattern.
    assertEquals(mod.isRequestTimePath('/item'), false);
    // Encoded values admit without decoding (params stay canonical).
    assertEquals(mod.isRequestTimePath('/item/hello%20world'), true);
    // Catch-all admits across segments.
    assertEquals(mod.isRequestTimePath('/docs/a/b/c'), true);
    assertEquals(mod.isRequestTimePath('/nope'), false);
    // #823 after #1215: admission never decodes, so a malformed escape cannot
    // throw here — the static layer still answers 400 for non-admitted paths.
    assertEquals(mod.isRequestTimePath('/item/%zz'), true);
    // The generated module no longer exports a route winner (#1215).
    assertEquals('matchRequestTimeRoute' in mod, false);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test('SSG discovers static pages from route records behind the unified HTTP middleware', async () => {
  const { createRouteMiddleware } = await import('@openelement/router/router/http');
  const root = await Deno.makeTempDir({ prefix: 'oe-record-ssg-' });
  const app = new Hono();
  let dynamicCalls = 0;
  app.all(
    '*',
    createRouteMiddleware([
      { id: 'index.tsx', path: '/', handlers: { GET: (c) => c.html('<main>record home</main>') } },
      {
        id: 'live.tsx',
        path: '/live',
        handlers: {
          GET: (c) => {
            dynamicCalls++;
            return c.html('live');
          },
        },
      },
    ]),
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
    assertStringIncludes(await Deno.readTextFile(`${root}/dist/index.html`), 'record home');
    assertEquals(dynamicCalls, 0);
    assertEquals(await pathExists(`${root}/dist/live/index.html`), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// #1343 review (P2): exact-path middleware and method-only host registrations
// are filtered out of hono/ssg discovery (method ALL + arity 2, or non-GET),
// so they must not suppress the canonical GET discovery entry for the same
// path — otherwise the page silently vanishes from a successful build.
Deno.test('SSG keeps canonical pages discoverable behind exact-path host middleware (#1343)', async () => {
  const { createRouteMiddleware } = await import('@openelement/router/router/http');
  const root = await Deno.makeTempDir({ prefix: 'oe-mw-ssg-' });
  const app = new Hono();
  let middlewareCalls = 0;
  // Host middleware on the exact canonical path: preserved as host behavior,
  // but not an SSG-discoverable page entry.
  app.use('/about', async (_c, next) => {
    middlewareCalls++;
    await next();
  });
  app.all(
    '*',
    createRouteMiddleware([
      { id: 'index.tsx', path: '/', handlers: { GET: (c) => c.html('<main>home</main>') } },
      {
        id: 'about.tsx',
        path: '/about',
        handlers: { GET: (c) => c.html('<main>canonical about</main>') },
      },
    ]),
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
    assertStringIncludes(
      await Deno.readTextFile(`${root}/dist/about/index.html`),
      'canonical about',
    );
    // Host behavior is preserved: the middleware really ran for the page fetch.
    assert(middlewareCalls > 0, 'host middleware must execute for /about');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('SSG keeps canonical pages discoverable behind method-only host routes (#1343)', async () => {
  const { createRouteMiddleware } = await import('@openelement/router/router/http');
  const root = await Deno.makeTempDir({ prefix: 'oe-postonly-ssg-' });
  const app = new Hono();
  // A POST-only host route on the canonical path is not a GET page entry.
  app.post('/contact', (c) => c.json({ ok: true }));
  app.all(
    '*',
    createRouteMiddleware([
      { id: 'index.tsx', path: '/', handlers: { GET: (c) => c.html('<main>home</main>') } },
      {
        id: 'contact.tsx',
        path: '/contact',
        handlers: { GET: (c) => c.html('<main>canonical contact</main>') },
      },
    ]),
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
    assertStringIncludes(
      await Deno.readTextFile(`${root}/dist/contact/index.html`),
      'canonical contact',
    );
    // The host POST route still answers through the real dispatcher.
    const posted = await app.request('/contact', { method: 'POST' });
    assertEquals(posted.status, 200);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
