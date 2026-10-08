/**
 * Unit tests for the internal WinterCG composition layer (#1560): the
 * per-request scope contract, the middleware onion and its Hono-compatible
 * scope matching, the fn-form API mounts (params, precedence, any-method),
 * the 404 terminal, and the never-rejecting dispatch.
 */
import { expect, test } from 'vitest';
import {
  boundRequestScope,
  createRequestScope,
  createWinterCgApp,
  matchesMiddlewareScope,
} from '../src/vite/internal/server-runtime/wintercg.ts';
import type { WinterCgApp } from '../src/vite/internal/server-runtime/wintercg.ts';

const TEXT_PLAIN = 'text/plain; charset=UTF-8';

function getApp(): WinterCgApp {
  return createWinterCgApp();
}

test('the app binds one scope per dispatch, by request identity', async () => {
  const app = getApp();
  const first = new Request('https://app.test/');
  const second = new Request('https://app.test/');
  app.use('*', () => new Response('ok'));
  await app.fetch(first);
  await app.fetch(second);
  // Identity comparisons stay off expect()'s structural inspection: the
  // scope carries a throwing executionCtx getter, which a deep diff would
  // trip over.
  const scope = boundRequestScope(first);
  expect(Boolean(scope)).toEqual(true);
  expect(boundRequestScope(second) === scope).toEqual(false);
  expect(app.requestScope(first) === scope).toEqual(true);
});

test('the scope folds channel headers into every constructed response', () => {
  const request = new Request('https://app.test/');
  const scope = createRequestScope(request);
  scope.header('Cache-Control', 'no-store');
  const page = scope.html('<p>x</p>', 404);
  expect(page.status).toEqual(404);
  expect(page.headers.get('Content-Type')).toEqual('text/html; charset=UTF-8');
  expect(page.headers.get('Cache-Control')).toEqual('no-store');
  const redirect = scope.redirect('/next', 303);
  expect(redirect.headers.get('Location')).toEqual('/next');
  expect(redirect.headers.get('Cache-Control')).toEqual('no-store');
  const json = scope.json({ ok: true }, 200, { 'Content-Type': 'application/problem+json' });
  expect(json.headers.get('Content-Type')).toEqual('application/problem+json');
  const body = scope.body('raw', 201);
  expect(body.status).toEqual(201);
  expect(body.headers.get('Cache-Control')).toEqual('no-store');
});

test('the scope exposes the request view and the execution context contract', () => {
  const request = new Request('https://app.test/p?a=1', {
    headers: { 'x-probe': 'yes' },
  });
  const scope = createRequestScope(request, { DEPLOY: '1' }, { waitUntil() {} });
  expect(scope.req.url).toEqual('https://app.test/p?a=1');
  expect(scope.req.path).toEqual('/p');
  expect(scope.req.header('x-probe')).toEqual('yes');
  expect(scope.req.param()).toEqual({});
  expect(scope.env).toEqual({ DEPLOY: '1' });
  expect(scope.executionCtx).toBeTruthy();
  scope.set('cspNonce', 'n1');
  expect(scope.get('cspNonce')).toEqual('n1');

  const bare = createRequestScope(new Request('https://app.test/'));
  expect(() => bare.executionCtx).toThrow(/execution context/);
});

test('middleware run in registration order, outside the route terminal', async () => {
  const app = getApp();
  const order: string[] = [];
  app.use('*', async (_request, next) => {
    order.push('one:in');
    const response = await next();
    order.push('one:out');
    return response;
  });
  app.use('*', async (_request, next) => {
    order.push('two:in');
    const response = await next();
    order.push('two:out');
    return response;
  });
  app.use('*', () => new Response('terminal'));
  const response = await app.fetch(new Request('https://app.test/'));
  expect(await response.text()).toEqual('terminal');
  expect(order).toEqual(['one:in', 'two:in', 'two:out', 'one:out']);
});

test('use-scoped middleware match Hono-style: /p/* covers /p and below, bare /p is exact', async () => {
  const app = getApp();
  const hits: string[] = [];
  app.use('/api/*', (_request, next) => {
    hits.push('star');
    return next();
  });
  app.use('/mid', (_request, next) => {
    hits.push('bare');
    return next();
  });
  app.use('*', () => new Response('ok'));
  for (const path of ['/api', '/api/x', '/mid', '/mid/deep']) {
    hits.length = 0;
    await app.fetch(new Request('https://app.test' + path));
    expect(hits, path).toEqual(
      path.startsWith('/api') ? ['star'] : path === '/mid' ? ['bare'] : [],
    );
  }
});

test('matchesMiddlewareScope covers the generated scope forms', () => {
  expect(matchesMiddlewareScope('/*', '/anything')).toEqual(true);
  expect(matchesMiddlewareScope('/api/*', '/api')).toEqual(true);
  expect(matchesMiddlewareScope('/api/*', '/api/x')).toEqual(true);
  expect(matchesMiddlewareScope('/api/*', '/apiography')).toEqual(false);
  expect(matchesMiddlewareScope('/mid', '/mid')).toEqual(true);
  expect(matchesMiddlewareScope('/mid', '/mid/deep')).toEqual(false);
});

test('fn-form mounts answer every method with route params and precedence', async () => {
  const app = getApp();
  app.all('/api/hello', (_request, scope) => scope.json({ params: scope.req.param() }));
  app.all('/api/:id', (_request, scope) => scope.json({ id: scope.req.param().id }));
  // The fallback is the route layer (app.route) — the shape the generated
  // entry emits; use('*') middleware would wrap the mounts, not sit below.
  app.route(() => new Response('fallback'));

  const got = await app.fetch(new Request('https://app.test/api/hello'));
  expect(await got.json()).toEqual({ params: {} });

  const posted = await app.fetch(new Request('https://app.test/api/hello', { method: 'POST' }));
  expect(posted.status).toEqual(200);

  const parammed = await app.fetch(new Request('https://app.test/api/42'));
  expect(await parammed.json()).toEqual({ id: '42' });

  // Most specific wins: the static mount beats the param mount.
  expect(app.routes).toEqual([
    { method: 'ALL', path: '/api/hello' },
    { method: 'ALL', path: '/api/:id' },
  ]);

  const missed = await app.fetch(new Request('https://app.test/api/hello/extra'));
  expect(await missed.text()).toEqual('fallback');
});

test('middleware wrap the mounts; a short-circuit wins, a pass-through reaches them', async () => {
  const app = getApp();
  app.all('/api', () => new Response('api'));
  let shortCircuitRan = false;
  app.use('*', () => {
    shortCircuitRan = true;
    return new Response('short-circuited');
  });
  const short = await app.fetch(new Request('https://app.test/api'));
  expect(await short.text()).toEqual('short-circuited');
  expect(shortCircuitRan).toEqual(true);

  // A second app whose middleware passes through: the mount answers and the
  // middleware observed the request.
  const passing = getApp();
  let middlewareRan = false;
  passing.use('*', (_request, next) => {
    middlewareRan = true;
    return next();
  });
  passing.all('/api', () => new Response('api'));
  passing.route(() => new Response('route-layer'));
  const response = await passing.fetch(new Request('https://app.test/api'));
  expect(await response.text()).toEqual('api');
  expect(middlewareRan).toEqual(true);

  // A path no mount claims falls through the mounts to the route layer.
  const missed = await passing.fetch(new Request('https://app.test/other'));
  expect(await missed.text()).toEqual('route-layer');
});

test('an unmatched request falls to the notFound terminal; missing terminal answers 404 text', async () => {
  const bare = getApp();
  const missing = await bare.fetch(new Request('https://app.test/none'));
  expect(missing.status).toEqual(404);
  expect(missing.headers.get('Content-Type')).toEqual(TEXT_PLAIN);

  const app = getApp();
  app.notFound((_request, scope) => {
    scope.header('Cache-Control', 'no-store');
    return scope.html('<main>styled 404</main>', 404);
  });
  const styled = await app.fetch(new Request('https://app.test/none'));
  expect(styled.status).toEqual(404);
  expect(styled.headers.get('Cache-Control')).toEqual('no-store');
  expect(await styled.text()).toContain('styled 404');
});

test('a chain rejection answers plain-text 500 — the host never sees a rejected fetch', async () => {
  const app = getApp();
  app.use('*', () => {
    throw new Error('exploded');
  });
  const response = await app.fetch(new Request('https://app.test/'));
  expect(response.status).toEqual(500);
  expect(await response.text()).toEqual('Internal Server Error');
});

test('request() resolves relative paths and threads env', async () => {
  const app = getApp();
  let seenEnv: Record<string, unknown> | undefined;
  app.use('*', (request, next) => {
    seenEnv = boundRequestScope(request)!.env;
    return next();
  });
  app.all('/', () => new Response('ok'));
  const response = await app.request('/?probe=1', { method: 'GET' }, { A: '1' });
  expect(response.status).toEqual(200);
  expect(seenEnv).toEqual({ A: '1' });
});

test('channel set-cookie accumulates over the response cookies (no replace)', async () => {
  const app = getApp();
  app.use('*', async (_request, next) => {
    const scope = boundRequestScope(_request as Request);
    scope.header('Set-Cookie', 'mw1=1; Path=/', { append: true });
    scope.header('Set-Cookie', 'mw2=2; Path=/', { append: true });
    return await next();
  });
  app.all(
    '/',
    () =>
      new Response('logged in', {
        headers: { 'Set-Cookie': 'session=logged-in; HttpOnly' },
      }),
  );
  const response = await app.request('/');
  // The regression: applyChannelHeaders deleted the accumulated set-cookie
  // once per channel cookie, so only the LAST middleware cookie survived and
  // the route's session cookie vanished. All three must ride the response.
  const cookies = response.headers.getSetCookie();
  expect(cookies).toEqual(['session=logged-in; HttpOnly', 'mw1=1; Path=/', 'mw2=2; Path=/']);
});
