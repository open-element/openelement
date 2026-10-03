import { expect, test } from 'vitest';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { Hono } from 'hono';
import { createRouteMiddleware, type HttpHandler } from '../src/http.ts';

test('Request chooses one URL before methods; WinterCG middleware composes with the host chain', async () => {
  const events: string[] = [];
  const app = new Hono();
  app.use('*', async (c, next) => {
    events.push('before');
    await next();
    events.push('after');
    c.header('x-host', 'yes');
  });
  app.get('/host', (c) => c.text('host'));
  // The internal composition adapter: mount the WinterCG route middleware on a
  // Hono host (the same shape the generated server entry emits).
  const routeMiddleware = createRouteMiddleware([
    {
      id: 'new',
      path: '/products/new',
      handlers: { GET: () => new Response('new', { headers: { 'Content-Type': 'text/plain' } }) },
    },
    {
      id: 'item',
      path: '/products/:id',
      handlers: {
        POST: (_request, context) => Response.json({ params: context.params }),
      },
    },
    {
      path: '/explicit-head',
      handlers: {
        GET: () => new Response('get', { headers: { 'Content-Type': 'text/plain' } }),
        HEAD: () => new Response('body', { status: 202, headers: { 'x-explicit': 'yes' } }),
      },
    },
  ]);
  app.all('*', (c, next) =>
    routeMiddleware(c.req.raw, async () => {
      await next();
      return c.res;
    }),
  );
  let response = await app.request('/products/new', { method: 'POST' });
  expect(response.status).toEqual(405);
  expect(response.headers.get('Allow')).toEqual('GET, HEAD');
  expect(response.headers.get('x-host')).toEqual('yes');
  response = await app.request('/products/new', { method: 'HEAD' });
  expect(response.status).toEqual(200);
  expect(await response.text()).toEqual('');
  response = await app.request('/explicit-head', { method: 'HEAD' });
  expect(response.status).toEqual(202);
  expect(response.headers.get('x-explicit')).toEqual('yes');
  expect(await response.text()).toEqual('');
  response = await app.request('/products/a%252Fb?q=x', { method: 'POST' });
  expect(await response.json()).toEqual({ params: { id: 'a%2Fb' } });
  expect(await (await app.request('/host')).text()).toEqual('host');
  expect((await app.request('/missing')).status).toEqual(404);
  expect((await app.request('/products/new', { method: 'OPTIONS' })).status).toEqual(405);
  expect(events).toEqual(Array.from({ length: 7 }, () => ['before', 'after']).flat());
});

test('Handler chains run in onion order: short-circuit, pass-down and outer next', async () => {
  const events: string[] = [];
  const wrap =
    (name: string, handler: HttpHandler): HttpHandler =>
    async (request, context, next) => {
      events.push(`${name}:in`);
      const response = await handler(request, context, next);
      events.push(`${name}:out`);
      return response;
    };
  const routeMiddleware = createRouteMiddleware([
    {
      path: '/short',
      handlers: {
        GET: [
          wrap('a', () => new Response('short-circuited')),
          wrap('b', () => new Response('unreachable')),
        ],
      },
    },
    {
      path: '/deep',
      handlers: {
        GET: [
          wrap('a', (_request, _context, next) => next()),
          wrap('b', async (_request, context, next) => {
            const response = await next();
            response.headers.set('x-params', JSON.stringify(context.params));
            return response;
          }),
        ],
      },
    },
  ]);
  const outerNext = () => {
    events.push('outer');
    return Promise.resolve(new Response('outer host'));
  };
  let response = await routeMiddleware(new Request('https://example.test/short'), outerNext);
  expect(await response.text()).toEqual('short-circuited');
  expect(events).toEqual(['a:in', 'a:out']);
  events.length = 0;
  // The last handler's next is the host chain's own next.
  response = await routeMiddleware(new Request('https://example.test/deep'), outerNext);
  expect(await response.text()).toEqual('outer host');
  expect(response.headers.get('x-params')).toEqual('{}');
  expect(events).toEqual(['a:in', 'b:in', 'outer', 'b:out', 'a:out']);
});

test('HTTP records reject ambiguous duplicate methods and preserve thrown handler errors', async () => {
  assertThrowsIncludes(
    () =>
      createRouteMiddleware([
        {
          path: '/',
          handlers: { get: () => new Response('a'), GET: () => new Response('b') },
        },
      ]),
    TypeError,
  );
  const app = new Hono();
  app.onError(() => {
    throw new Error('host error boundary');
  });
  const routeMiddleware = createRouteMiddleware([
    {
      path: '/',
      handlers: {
        GET: () => {
          throw new Error('handler');
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
  await assertRejectsIncludes(
    () => Promise.resolve(app.request('/')),
    Error,
    'host error boundary',
  );
});
