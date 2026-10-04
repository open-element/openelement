/**
 * @openelement/element — fetch middleware contract unit tests
 * (ADR-0123 item 2, #858).
 *
 * Covers the dialect-free `(request, next) => Promise<Response>` middleware
 * shape and the onion-order composition every runtime boundary (dev server,
 * start CLI, e2e fixture server, Nitro entry) shares.
 */

import { expect, test } from 'vitest';
import { composeFetchMiddleware } from '../src/build-utils.ts';
import type { Middleware } from '../src/index.ts';

const okHandler = (request: Request): Promise<Response> =>
  Promise.resolve(new Response(`handled:${new URL(request.url).pathname}`));

test('composeFetchMiddleware: empty chain returns the handler response', async () => {
  const handler = composeFetchMiddleware([], okHandler);
  const response = await handler(new Request('https://example.com/live'));
  expect(response.status).toEqual(200);
  expect(await response.text()).toEqual('handled:/live');
});

test('composeFetchMiddleware: onion order — use[0] is outermost', async () => {
  const order: string[] = [];
  const outer: Middleware = async (_request, next) => {
    order.push('outer-in');
    const response = await next();
    order.push('outer-out');
    return response;
  };
  const inner: Middleware = async (_request, next) => {
    order.push('inner-in');
    const response = await next();
    order.push('inner-out');
    return response;
  };
  const handler = composeFetchMiddleware([outer, inner], okHandler);
  await handler(new Request('https://example.com/live'));
  expect(order).toEqual(['outer-in', 'inner-in', 'inner-out', 'outer-out']);
});

test('composeFetchMiddleware: short-circuit skips the handler and inner middleware', async () => {
  let handlerRan = false;
  let innerRan = false;
  const outer: Middleware = async (_request, next) => {
    const response = await next();
    response.headers.set('x-outer', 'seen');
    return response;
  };
  const shortCircuit: Middleware = (request) => {
    if (new URL(request.url).searchParams.has('stop')) {
      return Promise.resolve(new Response('stopped', { status: 418 }));
    }
    innerRan = true;
    return Promise.resolve(new Response('passed'));
  };
  const handler = composeFetchMiddleware([outer, shortCircuit], (request) => {
    handlerRan = true;
    return okHandler(request);
  });

  const stopped = await handler(new Request('https://example.com/live?stop=1'));
  expect(stopped.status).toEqual(418);
  expect(await stopped.text()).toEqual('stopped');
  // The outer middleware still post-processes the short-circuit response.
  expect(stopped.headers.get('x-outer')).toEqual('seen');
  expect(handlerRan).toEqual(false);

  const passed = await handler(new Request('https://example.com/live'));
  expect(innerRan).toEqual(true);
  expect(handlerRan).toEqual(false); // 'passed' response came from the middleware itself
  expect(await passed.text()).toEqual('passed');
});

test('composeFetchMiddleware: post-processing sees the handler response', async () => {
  const addHeader: Middleware = async (_request, next) => {
    const response = await next();
    response.headers.append('x-chain', 'a');
    return response;
  };
  const addSecondHeader: Middleware = async (_request, next) => {
    const response = await next();
    response.headers.append('x-chain', 'b');
    return response;
  };
  const handler = composeFetchMiddleware([addHeader, addSecondHeader], okHandler);
  const response = await handler(new Request('https://example.com/live'));
  // Inner middleware post-processes first: b is appended before a.
  expect(response.headers.get('x-chain')).toEqual('b, a');
});

test('composeFetchMiddleware: handler errors propagate through the chain', async () => {
  const passthrough: Middleware = (_request, next) => next();
  const handler = composeFetchMiddleware([passthrough], () =>
    Promise.reject(new Error('boom from handler')),
  );
  const error = await handler(new Request('https://example.com/live')).catch((err) => err);
  expect(String(error)).toContain('boom from handler');
});

test('composeFetchMiddleware: runtime context threads past the chain to the handler', async () => {
  type Ctx = { env: Record<string, string | undefined> };
  const seen: string[] = [];
  const middleware: Middleware = async (_request, next) => {
    seen.push('mw');
    return await next();
  };
  const handler = composeFetchMiddleware([middleware], (request: Request, context: Ctx) => {
    seen.push(`handler:${context.env.TARGET ?? 'missing'}`);
    return Promise.resolve(new Response(new URL(request.url).pathname));
  });
  const response = await handler(new Request('https://example.com/live'), {
    env: { TARGET: 'reached' },
  });
  expect(seen).toEqual(['mw', 'handler:reached']);
  expect(await response.text()).toEqual('/live');
});
