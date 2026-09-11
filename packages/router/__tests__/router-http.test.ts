import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import { Hono } from 'hono';
import { createRouteMiddleware } from '../src/router-http.ts';

Deno.test('Request chooses one URL before methods; Hono retains context, middleware and response', async () => {
  const events: string[] = [];
  const app = new Hono<{ Variables: { host: string } }>();
  app.use('*', async (c, next) => {
    events.push('before');
    c.set('host', 'ok');
    await next();
    events.push('after');
    c.header('x-host', 'yes');
  });
  app.get('/host', (c) => c.text('host'));
  app.all(
    '*',
    createRouteMiddleware([
      { id: 'new', path: '/products/new', handlers: { GET: (c) => c.text(c.get('host')) } },
      {
        id: 'item',
        path: '/products/:id',
        handlers: { POST: (c) => c.json({ params: c.get('routeResolution').params }) },
      },
      {
        path: '/explicit-head',
        handlers: {
          GET: (c) => c.text('get'),
          HEAD: (c) => c.text('body', 202, { 'x-explicit': 'yes' }),
        },
      },
    ]),
  );
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

Deno.test('HTTP records reject ambiguous duplicate methods and preserve thrown handler errors', async () => {
  assertThrows(
    () =>
      createRouteMiddleware([{
        path: '/',
        handlers: { get: (c) => c.text('a'), GET: (c) => c.text('b') },
      }]),
    TypeError,
  );
  const app = new Hono<{ Variables: { host: string } }>();
  app.onError(() => {
    throw new Error('host error boundary');
  });
  app.all(
    '*',
    createRouteMiddleware([{
      path: '/',
      handlers: {
        GET: () => {
          throw new Error('handler');
        },
      },
    }]),
  );
  await assertRejects(() => Promise.resolve(app.request('/')), Error, 'host error boundary');
});
