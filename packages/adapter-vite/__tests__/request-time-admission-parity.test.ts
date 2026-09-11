/**
 * @openelement/adapter-vite — request-time admission parity (#1215, A10.7).
 *
 * Canonical application routing semantics live in the app RouteTable
 * (declaration-index priority, method semantics, query merging, safe params)
 * with URLPattern as the path grammar. The generated dist/server/index.js
 * must NOT own a second winner: it exports a DERIVED admission predicate
 * (`isRequestTimePath(pathname): boolean`) that is a conservative superset of
 * request-time paths. Winner selection at request time stays with the
 * canonical path (the entry's Hono app, registered in declaration order).
 *
 * This suite runs one adversarial corpus across all three surfaces and proves:
 *   1. Exactly one observable winner: RouteTable (client) and the Hono entry
 *      semantics (server) agree on the winner for every probe.
 *   2. Admission never false-negatives: whenever the canonical winner is a
 *      request-time route, isRequestTimePath(pathname) is true.
 *   3. Admission is exactly the derived OR over request-time URLPatterns —
 *      no precedence, no params, no decoding, no method/query/slash logic.
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { join } from '@std/path';
import { Hono } from 'hono';
import { createRouteMiddleware } from '../../router/src/router-http.ts';
import { RouteTable } from '../../router/src/internal/router/route-table.ts';
import { normalizeRoutePatternForURLPattern } from '@openelement/router/router';
import { renderRequestTimeServerModule } from '../src/internal/ssg/ssg-helpers.ts';

interface CorpusRoute {
  /** Framework route path (Hono dialect, e.g. '/item/:id', '/docs/:path{.+}'). */
  path: string;
  /** renderIntent: { mode: 'dynamic' } — served at request time. */
  requestTime: boolean;
  /** Defaults to ['GET']; POST implies the action route + defined 405 (#572). */
  methods?: readonly string[];
}

interface Probe {
  pathname: string;
  search?: string;
  method?: string;
  /** Canonical winning route path, or null when no route wins (404/405). */
  winner: string | null;
  /** Expected canonical path params (query collisions: path params win). */
  params?: Record<string, string>;
}

interface CorpusCase {
  name: string;
  routes: CorpusRoute[];
  probes: Probe[];
}

const CORPUS: CorpusCase[] = [
  {
    name: 'param declared before static, param is request-time',
    routes: [
      { path: '/:slug', requestTime: true },
      { path: '/about', requestTime: false },
    ],
    probes: [
      // Declaration order wins over specificity: '/:slug' takes '/about'.
      { pathname: '/about', winner: '/:slug', params: { slug: 'about' } },
      { pathname: '/contact', winner: '/:slug', params: { slug: 'contact' } },
    ],
  },
  {
    name: 'static declared before param, param is request-time',
    routes: [
      { path: '/about', requestTime: false },
      { path: '/:slug', requestTime: true },
    ],
    probes: [
      { pathname: '/about', winner: '/about', params: {} },
      { pathname: '/contact', winner: '/:slug', params: { slug: 'contact' } },
      { pathname: '/', winner: null },
    ],
  },
  {
    // BASE_SHA divergence (#1215): the old generated matcher sorted exact
    // paths first and picked '/about' here; the canonical table picks
    // '/:slug' by declaration index. One winner now: '/:slug'.
    name: 'overlapping request-time routes, param declared first',
    routes: [
      { path: '/:slug', requestTime: true },
      { path: '/about', requestTime: true },
    ],
    probes: [
      { pathname: '/about', winner: '/:slug', params: { slug: 'about' } },
      { pathname: '/other', winner: '/:slug', params: { slug: 'other' } },
    ],
  },
  {
    name: 'overlapping request-time routes, static declared first',
    routes: [
      { path: '/about', requestTime: true },
      { path: '/:slug', requestTime: true },
    ],
    probes: [
      { pathname: '/about', winner: '/about', params: {} },
      { pathname: '/other', winner: '/:slug', params: { slug: 'other' } },
    ],
  },
  {
    name: 'optional segment vs static',
    routes: [
      { path: '/item/new', requestTime: false },
      { path: '/item/:id?', requestTime: true },
    ],
    probes: [
      { pathname: '/item', winner: '/item/:id?', params: {} },
      { pathname: '/item/new', winner: '/item/new', params: {} },
      { pathname: '/item/42', winner: '/item/:id?', params: { id: '42' } },
    ],
  },
  {
    name: 'catch-all vs static prefix',
    routes: [
      { path: '/docs', requestTime: false },
      { path: '/docs/:path{.+}', requestTime: true },
    ],
    probes: [
      { pathname: '/docs', winner: '/docs', params: {} },
      { pathname: '/docs/a/b/c', winner: '/docs/:path{.+}', params: { path: 'a/b/c' } },
      // The `.+` catch-all needs at least one segment; '/docs/' is no hit.
      { pathname: '/docs/', winner: null },
    ],
  },
  {
    name: 'method-specific routes, GET/HEAD and defined 405',
    routes: [
      { path: '/form', requestTime: true, methods: ['GET', 'POST'] },
      { path: '/live', requestTime: true },
    ],
    probes: [
      { pathname: '/form', winner: '/form', params: {} },
      // HEAD rides the GET route on both canonical surfaces.
      { pathname: '/form', method: 'HEAD', winner: '/form', params: {} },
      // No PUT winner anywhere: canonical method-not-allowed, Hono 405.
      { pathname: '/form', method: 'PUT', winner: null },
      { pathname: '/live', method: 'POST', winner: null },
    ],
  },
  {
    name: 'percent-encoded, malformed and unsafe params',
    routes: [
      { path: '/item/:id', requestTime: true },
      { path: '/x/:__proto__', requestTime: true },
    ],
    probes: [
      {
        pathname: '/item/hello%20world',
        winner: '/item/:id',
        params: { id: 'hello world' },
      },
      // Malformed percent-encoding is a raw param on the canonical surfaces
      // (no decode crash), so admission must not throw or false-negative.
      { pathname: '/item/%zz', winner: '/item/:id', params: { id: '%zz' } },
      // Unsafe param names match the route but are dropped from params.
      { pathname: '/x/boom', winner: '/x/:__proto__', params: {} },
    ],
  },
  {
    name: 'query collisions: path params win, query never changes admission',
    routes: [{ path: '/item/:id', requestTime: true }],
    probes: [
      {
        pathname: '/item/42',
        search: '?id=query-loses&extra=query-wins',
        winner: '/item/:id',
        params: { id: '42' },
      },
    ],
  },
];

/** Import isRequestTimePath from a generated server entry for `routes`. */
async function loadAdmissionPredicate(
  routes: CorpusRoute[],
  caseIndex: number,
): Promise<(pathname: string) => boolean> {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, 'entry.js'),
      "export const openElementHandler = () => new Response('stub');\n",
    );
    await Deno.writeTextFile(
      join(dir, 'client-script.js'),
      "export const clientScriptSrc = '';\n",
    );
    await Deno.writeTextFile(
      join(dir, 'index.js'),
      // Mirrors ssg-render.ts: only request-time routes reach the module.
      renderRequestTimeServerModule(
        routes.filter((route) => route.requestTime).map(({ path }) => ({ path })),
      ),
    );
    const mod = await import(
      `file://${join(dir, 'index.js')}?case=${caseIndex}`
    ) as { isRequestTimePath?: unknown };
    assertEquals(
      typeof mod.isRequestTimePath,
      'function',
      'generated entry must export isRequestTimePath (admission only, #1215)',
    );
    assertEquals(
      'matchRequestTimeRoute' in mod,
      false,
      'generated entry must not export a route winner (#1215)',
    );
    const predicate = mod.isRequestTimePath as (pathname: string) => boolean;
    return (pathname) => {
      const admitted = predicate(pathname);
      assertEquals(typeof admitted, 'boolean', 'admission answers a boolean only');
      return admitted;
    };
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** The derived contract: OR over the request-time URLPatterns, nothing else. */
function derivedAdmission(routes: CorpusRoute[], pathname: string): boolean {
  return routes
    .filter((route) => route.requestTime)
    .some((route) =>
      new URLPattern({ pathname: normalizeRoutePatternForURLPattern(route.path) })
        .exec({ protocol: 'https', hostname: 'localhost', pathname }) !== null
    );
}

/**
 * Hono mirror of the generated entry (entry-codegen.ts): method handlers in
 * declaration order; action routes add the defined 405 fallback (#572). The
 * handler answers its own route path plus params so the winner is observable.
 */
function honoEntryFor(routes: CorpusRoute[]): Hono {
  const app = new Hono();
  app.all(
    '*',
    createRouteMiddleware(routes.map((route) => ({
      path: route.path,
      handlers: Object.fromEntries(
        (route.methods ?? ['GET']).map((
          method,
        ) => [
          method,
          (c: import('hono').Context) =>
            c.json({ path: route.path, params: c.get('routeResolution').params }),
        ]),
      ),
    }))),
  );
  return app;
}

Deno.test({
  name: 'request-time admission parity: one observable winner across the corpus (#1215)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    for (const [index, corpusCase] of CORPUS.entries()) {
      await t.step(corpusCase.name, async () => {
        const table = new RouteTable(
          corpusCase.routes.map(({ path, methods }) => ({ path, methods })),
        );
        const admission = await loadAdmissionPredicate(corpusCase.routes, index);
        const hono = honoEntryFor(corpusCase.routes);

        for (const probe of corpusCase.probes) {
          const method = probe.method ?? 'GET';
          const label = `${method} ${probe.pathname}${probe.search ?? ''}`;

          // 1. Canonical client semantics: RouteTable owns the winner.
          const resolution = table.resolve(probe.pathname, probe.search ?? '', method);
          const canonicalWinner = resolution.kind === 'match' ? resolution.route.path : null;
          assertEquals(canonicalWinner, probe.winner, `RouteTable winner for ${label}`);
          if (resolution.kind === 'match' && probe.params) {
            const params: Record<string, string> = {};
            for (const key of Object.keys(resolution.params)) {
              params[key] = resolution.params[key];
            }
            assertEquals(params, probe.params, `RouteTable params for ${label}`);
          }

          // 2. Server semantics: the entry's Hono app picks the SAME winner.
          const response = await hono.request(
            `http://parity.test${probe.pathname}${probe.search ?? ''}`,
            { method },
          );
          if (probe.winner === null) {
            assert(
              response.status === 404 || response.status === 405,
              `Hono must not produce a winner for ${label} (got ${response.status})`,
            );
          } else {
            assertEquals(response.status, 200, `Hono status for ${label}`);
            if (method !== 'HEAD') {
              const body = await response.json() as {
                path: string;
                params: Record<string, string>;
              };
              assertEquals(body.path, probe.winner, `Hono winner for ${label}`);
              if (probe.params) {
                for (const [key, value] of Object.entries(probe.params)) {
                  if (key in (table.match(probe.pathname)?.params ?? {})) {
                    assertEquals(body.params[key], value, `Hono param ${key} for ${label}`);
                  }
                }
              }
            }
          }

          // 3. Admission is derived only: exact OR over request-time patterns…
          const admitted = admission(probe.pathname);
          assertEquals(
            admitted,
            derivedAdmission(corpusCase.routes, probe.pathname),
            `admission is the derived predicate for ${label}`,
          );
          // …and never excludes a path the canonical table routes request-time.
          const winnerRecord = corpusCase.routes.find((route) => route.path === probe.winner);
          if (winnerRecord?.requestTime) {
            assertEquals(
              admitted,
              true,
              `admission false-negative for request-time winner ${probe.winner} at ${label}`,
            );
          }
        }
      });
    }
  },
});

Deno.test('generated request-time module owns admission only — no winner semantics (#1215)', () => {
  const code = renderRequestTimeServerModule([
    { path: '/:slug' },
    { path: '/about' },
    { path: '/docs/:path{.+}' },
  ]);
  assertStringIncludes(code, 'export function isRequestTimePath(pathname)');
  // No winner selection, precedence sorting, params, or percent-decoding.
  assertEquals(code.includes('matchRequestTimeRoute'), false);
  assertEquals(code.includes('.sort('), false);
  assertEquals(code.includes('paramNames'), false);
  assertEquals(code.includes('decodeURIComponent'), false);
  // The predicate body itself carries no method/basePath/trailing-slash
  // logic — those stay with the canonical path (Hono entry / RouteTable).
  const fnStart = code.indexOf('export function isRequestTimePath');
  const predicateBody = code.slice(fnStart, code.indexOf('\n}', fnStart));
  assertEquals(predicateBody.includes('method'), false);
  assertEquals(predicateBody.includes('basePath'), false);
  assertEquals(predicateBody.includes('trailingSlash'), false);
});

Deno.test('canonical-only semantics stay canonical: basePath and trailingSlash (#1215)', () => {
  // The generated predicate never re-implements these; pin them on the
  // canonical RouteTable so any drift is caught where the semantics live.
  const table = new RouteTable([{ path: '/live' }], undefined, {
    basePath: '/app',
    trailingSlash: 'ignore',
  });
  assertEquals(table.match('/app/live/')?.route.path, '/live');
  assertEquals(table.match('/live'), null);
});
