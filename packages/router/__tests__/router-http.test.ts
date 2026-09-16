import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import { Hono } from 'hono';
import { createRouteMiddleware, type HttpHandler } from '../src/http.ts';

Deno.test('Request chooses one URL before methods; WinterCG middleware composes with the host chain', async () => {
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
    }));
  let response = await app.request('/products/new', { method: 'POST' });
  assertEquals(response.status, 405);
  assertEquals(response.headers.get('Allow'), 'GET, HEAD');
  assertEquals(response.headers.get('x-host'), 'yes');
  response = await app.request('/products/new', { method: 'HEAD' });
  assertEquals(response.status, 200);
  assertEquals(await response.text(), '');
  response = await app.request('/explicit-head', { method: 'HEAD' });
  assertEquals(response.status, 202);
  assertEquals(response.headers.get('x-explicit'), 'yes');
  assertEquals(await response.text(), '');
  response = await app.request('/products/a%252Fb?q=x', { method: 'POST' });
  assertEquals(await response.json(), { params: { id: 'a%2Fb' } });
  assertEquals(await (await app.request('/host')).text(), 'host');
  assertEquals((await app.request('/missing')).status, 404);
  assertEquals((await app.request('/products/new', { method: 'OPTIONS' })).status, 405);
  assertEquals(events, Array.from({ length: 7 }, () => ['before', 'after']).flat());
});

Deno.test('Handler chains run in onion order: short-circuit, pass-down and outer next', async () => {
  const events: string[] = [];
  const wrap =
    (name: string, handler: HttpHandler): HttpHandler => async (request, context, next) => {
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
  assertEquals(await response.text(), 'short-circuited');
  assertEquals(events, ['a:in', 'a:out']);
  events.length = 0;
  // The last handler's next is the host chain's own next.
  response = await routeMiddleware(new Request('https://example.test/deep'), outerNext);
  assertEquals(await response.text(), 'outer host');
  assertEquals(response.headers.get('x-params'), '{}');
  assertEquals(events, ['a:in', 'b:in', 'outer', 'b:out', 'a:out']);
});

Deno.test('HTTP records reject ambiguous duplicate methods and preserve thrown handler errors', async () => {
  assertThrows(
    () =>
      createRouteMiddleware([{
        path: '/',
        handlers: { get: () => new Response('a'), GET: () => new Response('b') },
      }]),
    TypeError,
  );
  const app = new Hono();
  app.onError(() => {
    throw new Error('host error boundary');
  });
  const routeMiddleware = createRouteMiddleware([{
    path: '/',
    handlers: {
      GET: () => {
        throw new Error('handler');
      },
    },
  }]);
  app.all('*', (c, next) =>
    routeMiddleware(c.req.raw, async () => {
      await next();
      return c.res;
    }));
  await assertRejects(() => Promise.resolve(app.request('/')), Error, 'host error boundary');
});
