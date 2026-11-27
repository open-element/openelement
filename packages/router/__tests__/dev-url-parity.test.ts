/**
 * Dev/build URL-set parity: trailing slashes and i18n locale prefixes.
 *
 * The built site's URL set is the emitted document tree: one document per page
 * route at its canonical path, one prefixed copy per non-default locale
 * (`expandI18nLocales`), and `staticFileCandidates` answers each document at
 * both its clean-URL spelling and its trailing-slash spelling. The dev server
 * used to resolve a narrower set — only canonical, exactly-spelled paths — so
 * `/docs/`, `/zh` and `/zh/docs/` answered 404 in dev while the built site
 * served them. These tests would have caught that:
 *
 *   - unit: the locale route aliases the generated request-time route layer
 *     registers, the page URL count the startup line reports, and the emitted
 *     strict and page-only route layers;
 *   - integration: a real dev server over a two-locale fixture, probing both
 *     spellings of a path, the locale-prefixed forms, and direct and
 *     unmatched URLs for the styled 404 document, along with API and action
 *     requests that must keep their original paths.
 *
 * The fixture lives under __test_fixtures__ (gitignored) and is written per
 * run.
 */

import { createServer as createHttpServer } from 'node:http';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import type { ViteDevServer } from 'vite';
import type { RouteEntry } from '@openelement/protocol/framework';
import { openElement } from '../src/vite/app-vite.ts';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderEntry } from '../src/vite/internal/ssg/entry-orchestrator.ts';
import { localeRouteAliases, pageUrlCount } from '../src/vite/internal/ssg/page-url-forms.ts';

// ─── Shared fixture data (unit) ────────────────────────────────────────────

/** The canonical page URL set: root, nested route, dynamic route, 404 page. */
const pageRoutes: RouteEntry[] = [
  { path: '/', filePath: 'index.tsx', type: 'page', varName: 'pageIndex' },
  { path: '/docs', filePath: 'docs/index.tsx', type: 'page', varName: 'pageDocs' },
  { path: '/blog/:slug', filePath: 'blog/[slug].tsx', type: 'page', varName: 'pageBlog' },
  { path: '/404', filePath: '404.tsx', type: 'page', varName: 'page404' },
];

const I18N = { locales: ['en', 'zh'], defaultLocale: 'en' };

function localizedDescriptor() {
  return buildEntryDescriptor(pageRoutes, { i18n: I18N });
}

// ─── Unit: the URL forms the route layer must answer ───────────────────────

test('locale aliases register the prefixed page URLs the build emits', () => {
  const aliases = localeRouteAliases(localizedDescriptor());
  expect(aliases).toEqual([
    {
      id: 'index.tsx::locale:zh',
      path: '/zh',
      canonicalPath: '/',
      locale: 'zh',
    },
    {
      id: 'docs/index.tsx::locale:zh',
      path: '/zh/docs',
      canonicalPath: '/docs',
      locale: 'zh',
    },
    {
      id: 'blog/[slug].tsx::locale:zh',
      path: '/zh/blog/:slug',
      canonicalPath: '/blog/:slug',
      locale: 'zh',
    },
  ]);
  // The default locale is served unprefixed only, and the not-found URL is
  // the error document (404), never a 200 page — the terminal answers it.
  const aliased = aliases.map((alias) => alias.path);
  expect(aliased.includes('/en')).toEqual(false);
  expect(aliased.includes('/zh/404')).toEqual(false);
});

test('locale aliases follow the declared default locale, not declaration order', () => {
  const desc = buildEntryDescriptor(pageRoutes, {
    i18n: { locales: ['fr', 'en'], defaultLocale: 'fr' },
  });
  expect(localeRouteAliases(desc).map((alias) => alias.path)).toEqual([
    '/en',
    '/en/docs',
    '/en/blog/:slug',
  ]);
});

test('single-locale projects register no locale aliases', () => {
  expect(localeRouteAliases(buildEntryDescriptor(pageRoutes))).toEqual([]);
  expect(
    localeRouteAliases(
      buildEntryDescriptor(pageRoutes, { i18n: { locales: ['en'], defaultLocale: 'en' } }),
    ),
  ).toEqual([]);
});

test('a route already declared under a locale prefix is not prefixed again', () => {
  // expandI18nLocales skips such paths (`locales.includes(pathSegment)`), so
  // the build serves `/zh/docs` from the canonical pass — an alias would
  // invent a `/zh/zh/docs` URL the built site does not have.
  const prefixed: RouteEntry[] = [
    { path: '/zh/docs', filePath: 'zh/docs.tsx', type: 'page', varName: 'pageZhDocs' },
  ];
  const desc = buildEntryDescriptor(prefixed, { i18n: I18N });
  expect(localeRouteAliases(desc)).toEqual([]);
  expect(pageUrlCount(desc.pageRoutes, I18N)).toEqual(1);
});

test('the startup page count reports URL forms, not route modules', () => {
  const desc = localizedDescriptor();
  // 4 canonical documents + 4 prefixed copies: the 68/34 ratio the Site build
  // emits, applied to this fixture's route set.
  expect(pageUrlCount(desc.pageRoutes, I18N)).toEqual(8);
  expect(pageUrlCount(desc.pageRoutes, undefined)).toEqual(4);
  expect(pageUrlCount(desc.pageRoutes, { locales: ['en'] })).toEqual(4);
});

test('only the GET/HEAD page fallback ignores trailing slashes', () => {
  const apiRoutes: RouteEntry[] = [
    { path: '/api/probe', filePath: 'api/probe.ts', type: 'api', varName: 'apiProbe' },
    { path: '/api/probe/', filePath: 'api/probe-slash.ts', type: 'api', varName: 'apiProbeSlash' },
  ];
  const code = renderEntry(buildEntryDescriptor([...pageRoutes, ...apiRoutes], { i18n: I18N }));
  const strictTable = code
    .split('const __routeMiddleware = ')[1]!
    .split('const __pageUrlMiddleware')[0];
  const pageTable = code.split('const __pageUrlMiddleware = ')[1]!.split('app.route(')[0];
  expect(strictTable).toContain('...__apiRouteRecords');
  expect(strictTable).toContain('path: "/docs", handlers: __pageHandlers["/docs"]');
  expect(strictTable).toContain('], { methodNotAllowed: __methodNotAllowed });');
  expect(strictTable).not.toContain('trailingSlash');
  expect(strictTable).not.toContain('path: "/zh/docs"');
  expect(code).toContain('id: "api/probe.ts", path: "/api/probe", handlers:');
  expect(code).toContain('id: "api/probe-slash.ts", path: "/api/probe/", handlers:');
  expect(pageTable).toContain('path: "/docs", handlers: { GET: __pageHandlers["/docs"].GET }');
  expect(pageTable).not.toContain('__apiRouteRecords');
  expect(pageTable).toContain('], { trailingSlash: "ignore" });');
  expect(code).toContain('app.route((request, next) => __routeMiddleware(request, () =>');
  expect(code).toContain(
    'request.method === "GET" || request.method === "HEAD" ? __pageUrlMiddleware(request, next) : next()',
  );
  expect(code).toContain(
    '{ id: "docs/index.tsx::locale:zh", path: "/zh/docs", handlers: { GET: __pageHandlers["/docs"].GET } }',
  );
  expect(code).toContain(
    '{ id: "index.tsx::locale:zh", path: "/zh", handlers: { GET: __pageHandlers["/"].GET } }',
  );
  expect(code.includes('"/zh/404"'), 'the error document is not a page record').toEqual(false);
  expect(code).not.toContain('{ id: "404.tsx", path: "/404", handlers:');
  expect(code).toContain('app.notFound(');
  expect(code).toContain('__renderLayout(__content, "/404", { locale: __pageContext.locale,');
  const ssg = renderEntry(buildEntryDescriptor(pageRoutes, { i18n: I18N, ssg: true }));
  expect(ssg).toContain('{ id: "404.tsx", path: "/404", handlers: __pageHandlers["/404"] }');
  expect(ssg).not.toContain('path: "/zh/404", handlers:');
  expect(code.includes('"/en/docs"'), 'the default locale is unprefixed').toEqual(false);
  // A single-locale entry supports the same page slash spelling without locale aliases.
  const singleLocale = renderEntry(buildEntryDescriptor(pageRoutes));
  expect(singleLocale.includes('::locale:')).toEqual(false);
  expect(singleLocale).toContain('trailingSlash: "ignore"');
});

// ─── Integration: a real dev server over a two-locale fixture ──────────────

const FIXTURE_DIR = join(import.meta.dirname!, '../__test_fixtures__/dev-url-parity');

const HOME_ROUTE = `import { definePage } from '@openelement/router';

export function HomePage() {
  return <main id='probe-home'>home</main>;
}

export default definePage(HomePage, { head: { title: 'url parity home' } });
`;

const DOCS_ROUTE = `import { definePage, fail } from '@openelement/router';

export function DocsPage() {
  return <main id='probe-docs'>docs</main>;
}

export function action() {
  return fail(422, { message: 'probe-docs-action' });
}

export default definePage(DocsPage, { head: { title: 'url parity docs' } });
`;

const API_ROUTE = `export default {
  GET: () => new Response('probe-api-get'),
  POST: () => new Response('probe-api-post'),
};
`;

const NOT_FOUND_ROUTE = `import { definePage } from '@openelement/router';

export function NotFoundPage() {
  return <main id='probe-404'>not found</main>;
}

export default definePage(NotFoundPage, { head: { title: 'url parity 404' } });
`;

const LAYOUT = `import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'app-layout',
  properties: {
    locale: { default: '' },
    homeHref: { default: '' },
  },
});

export default function Layout(props: { locale: string; homeHref: string }) {
  return (
    <div data-layout-locale={props.locale}>
      <a id='layout-home' href={props.homeHref}>Home</a>
      <slot></slot>
    </div>
  );
}
`;

/** Write the fixture app; idempotent so a re-run reuses the same tree. */
function writeFixture(): void {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  for (const dir of ['app/routes/docs', 'app/routes/api', 'node_modules/@openelement']) {
    mkdirSync(join(FIXTURE_DIR, dir), { recursive: true });
  }
  writeFileSync(join(FIXTURE_DIR, 'app/routes/index.tsx'), HOME_ROUTE, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/routes/docs/index.tsx'), DOCS_ROUTE, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/routes/api/probe.ts'), API_ROUTE, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/routes/404.tsx'), NOT_FOUND_ROUTE, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/layout.tsx'), LAYOUT, 'utf8');
  writeFileSync(
    join(FIXTURE_DIR, 'package.json'),
    JSON.stringify({ name: 'dev-url-parity-fixture', private: true, type: 'module' }),
    'utf8',
  );
  // The generated entry imports `@openelement/router` by package name; the
  // fixture sits inside the router package, so it needs its own resolution
  // edge to it (every fixture under __test_fixtures__ carries this symlink).
  symlinkSync('../../../..', join(FIXTURE_DIR, 'node_modules/@openelement/router'), 'dir');
}

interface DevHandle {
  base: string;
  server: ViteDevServer;
  close: () => Promise<void>;
}

/** Boot a real dev server over the fixture, loopback-only (the parity harness). */
async function bootDev(): Promise<DevHandle> {
  const { createServer } = await import('vite');
  const previousCwd = process.cwd();
  process.chdir(FIXTURE_DIR);
  // Vite derives `import.meta.env.DEV` from NODE_ENV at config resolution; an
  // ambient production value would serve the PROD branches of the generated
  // entry and make every probe meaningless.
  const ambientNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  let server: ViteDevServer;
  try {
    server = await createServer({
      root: FIXTURE_DIR,
      logLevel: 'silent',
      configFile: false,
      // The generated entry compiles .tsx route modules, so the dev pipeline
      // must lower JSX the same way an app's vite.config does.
      oxc: { jsx: { runtime: 'automatic', importSource: '@openelement/element' } },
      server: { middlewareMode: true, ws: false },
      plugins: openElement({
        routesDir: 'app/routes',
        islandsDir: 'app/islands',
        i18n: I18N,
      }),
    });
  } catch (error) {
    process.chdir(previousCwd);
    throw error;
  } finally {
    if (ambientNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ambientNodeEnv;
  }
  const httpServer = createHttpServer((request, response) => {
    server.middlewares(request, response, () => {
      response.statusCode = 404;
      response.end('not found');
    });
  });
  const restoreCwd = (): void => process.chdir(previousCwd);
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', () => {
      restoreCwd();
      reject(new Error('dev server did not bind'));
    });
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (address === null || typeof address !== 'object') {
    restoreCwd();
    throw new Error('dev server did not bind');
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    server,
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      } finally {
        await server.close();
        restoreCwd();
      }
    },
  };
}

interface Probe {
  status: number;
  body: string;
}

async function get(handle: DevHandle, path: string): Promise<Probe> {
  const response = await fetch(`${handle.base}${path}`);
  return { status: response.status, body: await response.text() };
}

let handle: DevHandle | undefined;

beforeAll(() => {
  writeFixture();
});

afterAll(async () => {
  if (handle) await handle.close();
  handle = undefined;
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

test('dev resolves the same page URL set the build emits', async () => {
  // The startup data line must report the URL forms the route layer answers
  // (3 page routes × 2 locales), not the canonical route-module count. boot
  // and one request (buildStart runs lazily in a middleware-mode server) are
  // inside the capture window so the line is observed wherever it fires.
  const logLines: string[] = [];
  const consoleInfo = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
    logLines.push(args.map(String).join(' '));
  });
  try {
    handle = await bootDev();
    await get(handle, '/');
  } finally {
    consoleInfo.mockRestore();
  }
  expect(
    logLines.filter((line) => line.includes('Routes: 6 page(s)')),
    `startup line reports the URL-form count; captured: ${logLines.join(' | ')}`,
  ).toHaveLength(1);

  // Trailing slash: the static dispatch answers both spellings of every
  // document, so dev must also render the same page for both forms.
  const docs = await get(handle, '/docs');
  const docsSlash = await get(handle, '/docs/');
  expect(docs.status, 'GET /docs').toEqual(200);
  expect(docsSlash.status, 'GET /docs/ (trailing slash)').toEqual(200);
  expect(docs.body).toContain('probe-docs');
  expect(docsSlash.body).toEqual(docs.body);

  // Locale prefix: the build writes /zh/index.html and /zh/docs/index.html;
  // the alias answers them with the canonical page rendered for locale `zh`.
  const zhRoot = await get(handle, '/zh');
  const zhRootSlash = await get(handle, '/zh/');
  expect(zhRoot.status, 'GET /zh').toEqual(200);
  expect(zhRootSlash.status, 'GET /zh/').toEqual(200);
  expect(zhRoot.body).toContain('probe-home');
  expect(zhRoot.body).toContain('<html lang="zh"');

  const zhDocs = await get(handle, '/zh/docs');
  const zhDocsSlash = await get(handle, '/zh/docs/');
  expect(zhDocs.status, 'GET /zh/docs').toEqual(200);
  expect(zhDocsSlash.status, 'GET /zh/docs/').toEqual(200);
  expect(zhDocs.body).toContain('probe-docs');
  expect(zhDocs.body).toContain('<html lang="zh"');
  expect(zhDocsSlash.body).toEqual(zhDocs.body);
  for (const path of ['/docs/', '/zh/docs/']) {
    const head = await fetch(`${handle.base}${path}`, { method: 'HEAD' });
    expect(head.status, `HEAD ${path}`).toEqual(200);
    expect(await head.text()).toEqual('');
  }
  // The default locale stays unprefixed, exactly as the build emits it.
  expect(docs.body).toContain('<html lang="en"');
  expect((await get(handle, '/en/docs')).status, 'GET /en/docs').toEqual(404);

  // Both direct and unmatched paths have the status and locale of the
  // styled error document the static dispatch serves.
  for (const [locale, prefix] of [
    ['en', ''],
    ['zh', '/zh'],
  ]) {
    for (const suffix of ['/404', '/404/', '/404.html', '/definitely-not-a-page']) {
      const path = prefix + suffix;
      const response = await get(handle, path);
      expect(response.status, `GET ${path}`).toEqual(404);
      expect(response.body, `GET ${path} renders the 404 page`).toContain('probe-404');
      expect(response.body, `GET ${path} selects the request locale`).toContain(
        `<html lang="${locale}"`,
      );
      expect(response.body, `GET ${path} localizes shared layout`).toContain(
        `data-layout-locale="${locale}"`,
      );
      expect(response.body, `GET ${path} localizes the layout's home link`).toContain(
        `id="layout-home" href="${prefix || '/'}"`,
      );
    }
  }
});

test('dev keeps API methods and page actions on their exact paths', async () => {
  handle ??= await bootDev();
  const origin = handle.base;
  for (const [method, body] of [
    ['GET', 'probe-api-get'],
    ['POST', 'probe-api-post'],
  ]) {
    const exact = await fetch(`${origin}/api/probe`, { method });
    expect(exact.status, `${method} /api/probe`).toEqual(200);
    expect(await exact.text()).toEqual(body);
    for (const path of ['/api/probe/', '/zh/api/probe', '/zh/api/probe/']) {
      const response = await fetch(`${origin}${path}`, { method });
      expect(response.status, `${method} ${path}`).toEqual(404);
      expect(await response.text()).toContain('probe-404');
    }
  }

  const methodMismatch = await fetch(`${origin}/api/probe`, { method: 'PATCH' });
  expect(methodMismatch.status).toEqual(405);
  expect(methodMismatch.headers.get('allow')).toEqual('GET, HEAD, POST');

  const action = (path: string) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'x-openelement-action': 'true' },
      body: new URLSearchParams({ value: 'probe' }),
    });
  const canonicalAction = await action('/docs');
  expect(canonicalAction.status).toEqual(422);
  expect(await canonicalAction.text()).toContain('probe-docs-action');
  for (const path of ['/docs/', '/zh/docs', '/zh/docs/']) {
    const response = await action(path);
    expect(response.status, `POST ${path} must fall through to the 404 terminal`).toEqual(404);
    expect(await response.text()).toContain('probe-404');
  }
});
