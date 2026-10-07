/**
 * Unit tests for the built-in WinterCG middleware (#1560). The observable
 * behavior is pinned against the Hono built-ins they replace: the
 * request-id validation/regeneration and header, the logger line format,
 * the CORS preflight short-circuit and Vary appends, and the security
 * header set with X-Powered-By removal. The logger's status coloring is
 * deliberately absent — the color policy read process.env (P3).
 */
import { expect, test } from 'vitest';
import {
  createCorsMiddleware,
  createLoggerMiddleware,
  createRequestIdMiddleware,
  createSecureHeadersMiddleware,
} from '../src/vite/internal/server-runtime/middleware.ts';
import {
  boundRequestScope,
  createWinterCgApp,
} from '../src/vite/internal/server-runtime/wintercg.ts';
import type { WinterCgApp } from '../src/vite/internal/server-runtime/wintercg.ts';

function appWith(middleware: (app: WinterCgApp) => void, terminal: () => Response): WinterCgApp {
  const app = createWinterCgApp();
  middleware(app);
  app.use('*', () => terminal());
  return app;
}

test('requestId honors a well-formed inbound id and regenerates anything else', async () => {
  const honored = appWith(
    (app) => void app.use('*', createRequestIdMiddleware()),
    () => new Response('ok'),
  );
  const kept = await honored.fetch(
    new Request('https://app.test/', { headers: { 'X-Request-Id': 'client-id_1' } }),
  );
  expect(kept.headers.get('X-Request-Id')).toEqual('client-id_1');

  const regenerated = appWith(
    (app) => void app.use('*', createRequestIdMiddleware()),
    () => new Response('ok'),
  );
  const fresh = await regenerated.fetch(
    new Request('https://app.test/', { headers: { 'X-Request-Id': 'bad id!/path' } }),
  );
  const freshId = fresh.headers.get('X-Request-Id')!;
  expect(freshId).toMatch(/^[\w\-=]{1,255}$/);
  expect(freshId).not.toEqual('bad id!/path');

  const absent = appWith(
    (app) => void app.use('*', createRequestIdMiddleware()),
    () => new Response('ok'),
  );
  const generated = await absent.fetch(new Request('https://app.test/'));
  expect(generated.headers.get('X-Request-Id')).toMatch(/^[\w\-=]{1,255}$/);
});

test('requestId exposes the id as the requestId scope variable', async () => {
  const app = createWinterCgApp();
  let seen: unknown;
  app.use('*', createRequestIdMiddleware());
  app.use('*', (request) => {
    seen = boundRequestScope(request)!.get('requestId');
    return new Response('ok');
  });
  await app.fetch(new Request('https://app.test/', { headers: { 'X-Request-Id': 'probe' } }));
  expect(seen).toEqual('probe');
});

test('logger emits the two-line request format with status and elapsed', async () => {
  const lines: string[] = [];
  const app = appWith(
    (a) => void a.use('*', createLoggerMiddleware({ print: (line) => lines.push(line) })),
    () => new Response('ok'),
  );
  await app.fetch(new Request('https://app.test/some/path?x=1'));
  expect(lines).toHaveLength(2);
  expect(lines[0]).toEqual('<-- GET /some/path?x=1');
  expect(lines[1]).toMatch(/^--> GET \/some\/path\?x=1 200 (\d+ms|\d+s)$/);
});

test('cors reflects allowed origins and appends Vary on non-wildcard responses', async () => {
  const app = appWith(
    (a) =>
      void a.use(
        '*',
        createCorsMiddleware({
          origin: ['https://allowed.test'],
          allowMethods: ['GET', 'POST'],
          allowHeaders: ['Content-Type'],
          credentials: true,
          maxAge: 600,
        }),
      ),
    () => new Response('ok'),
  );
  const allowed = await app.fetch(
    new Request('https://app.test/', { headers: { origin: 'https://allowed.test' } }),
  );
  expect(allowed.headers.get('Access-Control-Allow-Origin')).toEqual('https://allowed.test');
  expect(allowed.headers.get('Access-Control-Allow-Credentials')).toEqual('true');
  expect(allowed.headers.get('Vary')).toEqual('Origin');

  const denied = await app.fetch(
    new Request('https://app.test/', { headers: { origin: 'https://other.test' } }),
  );
  expect(denied.headers.get('Access-Control-Allow-Origin')).toEqual(null);
});

test('cors answers an OPTIONS preflight with 204 and the full allow set', async () => {
  const app = appWith(
    (a) =>
      void a.use(
        '*',
        createCorsMiddleware({
          origin: 'https://allowed.test',
          allowMethods: ['GET', 'POST'],
          allowHeaders: ['Content-Type', 'Authorization'],
          credentials: true,
          maxAge: 600,
        }),
      ),
    () => {
      throw new Error('the preflight must short-circuit before the terminal');
    },
  );
  const preflight = await app.fetch(
    new Request('https://app.test/', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://allowed.test',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, x-custom',
      },
    }),
  );
  expect(preflight.status).toEqual(204);
  expect(preflight.statusText).toEqual('No Content');
  expect(preflight.headers.get('Access-Control-Allow-Origin')).toEqual('https://allowed.test');
  expect(preflight.headers.get('Access-Control-Allow-Methods')).toEqual('GET,POST');
  expect(preflight.headers.get('Access-Control-Allow-Headers')).toEqual(
    'Content-Type,Authorization',
  );
  expect(preflight.headers.get('Access-Control-Max-Age')).toEqual('600');
  expect(preflight.headers.get('Access-Control-Allow-Credentials')).toEqual('true');
  expect(preflight.headers.get('Vary')).toContain('Origin');
  expect(preflight.headers.get('Vary')).toContain('Access-Control-Request-Headers');
  expect(preflight.headers.get('Content-Type')).toEqual(null);
});

test('secureHeaders set the security set post-response and strip X-Powered-By', async () => {
  const app = appWith(
    (a) => void a.use('*', createSecureHeadersMiddleware()),
    () =>
      new Response('ok', {
        headers: { 'X-Powered-By': 'something', 'Content-Type': 'text/plain' },
      }),
  );
  const response = await app.fetch(new Request('https://app.test/'));
  expect(response.headers.get('X-Powered-By')).toEqual(null);
  expect(response.headers.get('X-Content-Type-Options')).toEqual('nosniff');
  expect(response.headers.get('X-Frame-Options')).toEqual('SAMEORIGIN');
  expect(response.headers.get('Referrer-Policy')).toEqual('no-referrer');
  expect(response.headers.get('Strict-Transport-Security')).toEqual(
    'max-age=15552000; includeSubDomains',
  );
  expect(response.headers.get('Cross-Origin-Resource-Policy')).toEqual('same-origin');
  expect(response.headers.get('Cross-Origin-Opener-Policy')).toEqual('same-origin');
  expect(response.headers.get('Origin-Agent-Cluster')).toEqual('?1');
  expect(response.headers.get('X-DNS-Prefetch-Control')).toEqual('off');
  expect(response.headers.get('X-Download-Options')).toEqual('noopen');
  expect(response.headers.get('X-Permitted-Cross-Domain-Policies')).toEqual('none');
  expect(response.headers.get('X-XSS-Protection')).toEqual('0');
  // The previous built-in's default: COEP off.
  expect(response.headers.get('Cross-Origin-Embedder-Policy')).toEqual(null);
});

test('cors/requestId headers land on the terminal response through the scope channel', async () => {
  const app = createWinterCgApp();
  app.use('*', createRequestIdMiddleware());
  app.use('*', createCorsMiddleware({ origin: 'https://allowed.test', credentials: true }));
  app.all('/', () => new Response('ok'));
  const response = await app.fetch(
    new Request('https://app.test/', { headers: { origin: 'https://allowed.test' } }),
  );
  // The terminal built its own new Response — the channel headers must ride
  // the scope's boundary merge (the prepared-headers behavior of the
  // replaced stack).
  expect(response.headers.get('X-Request-Id')).toMatch(/^[\w\-=]+$/);
  expect(response.headers.get('Access-Control-Allow-Origin')).toEqual('https://allowed.test');
});
