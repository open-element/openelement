import { assertEquals } from '@std/assert';
import { createRequestContext } from '@openelement/router';
import { createOpenElementNitroHandler } from '../src/nitro-mount.ts';

Deno.test('nitro mount: passes the event req through to the handler and returns its Response', async () => {
  let seen: Request | undefined;
  const handler = createOpenElementNitroHandler({
    handler: async (request, context) => {
      seen = request;
      const body = await request.text();

      return new Response(
        JSON.stringify({
          url: request.url,
          method: request.method,
          contentType: request.headers.get('content-type'),
          body,
          envName: context?.env?.name,
          platform: context?.platform,
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      );
    },
    env: { name: 'test-env' },
    platform: 'node',
  });

  // Nitro v3 (h3 v2) events carry a srvx ServerRequest, which IS a standard
  // Request — the mount must not reconstruct it (#857).
  const req = new Request('https://example.test/api/hello?x=1', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'payload',
  });
  const response = await handler({ req });

  assertEquals(seen, req);
  assertEquals(response.status, 201);
  assertEquals(response.headers.get('content-type'), 'application/json');
  assertEquals(await response.json(), {
    url: 'https://example.test/api/hello?x=1',
    method: 'POST',
    contentType: 'text/plain',
    body: 'payload',
    envName: 'test-env',
    platform: 'node',
  });
});

Deno.test('nitro mount: event env/platform override the mount options', async () => {
  const handler = createOpenElementNitroHandler({
    handler: (_request, context) =>
      new Response(JSON.stringify({ env: context?.env, platform: context?.platform })),
    env: { name: 'option-env' },
    platform: 'option-platform',
  });

  const response = await handler({
    req: new Request('https://worker.test/from-request'),
    env: { name: 'event-env' },
    platform: 'event-platform',
  });

  assertEquals(await response.json(), { env: { name: 'event-env' }, platform: 'event-platform' });
});

Deno.test('nitro mount: exposes h3 v2 context.params through runtime and request contexts', async () => {
  const contexts: Array<{
    path: string;
    method: string;
    params: Record<string, string>;
    envName?: unknown;
    platform?: unknown;
  }> = [];
  const handler = createOpenElementNitroHandler({
    handler: (_request, context) => new Response(context?.params?.slug ?? 'missing'),
    onBeforeRequestContext: (context) => {
      contexts.push({
        path: context.path,
        method: context.method,
        params: context.params,
        envName: context.env?.name,
        platform: context.platform,
      });
    },
    env: { name: 'nitro-env' },
    platform: 'workers',
  });

  const response = await handler({
    req: new Request('https://deploy.test/reader/notes?draft=1', { method: 'PUT' }),
    context: { params: { slug: 'notes' } },
  });

  assertEquals(await response.text(), 'notes');

  assertEquals(contexts, [{
    path: '/reader/notes',
    method: 'PUT',
    params: { slug: 'notes' },
    envName: 'nitro-env',
    platform: 'workers',
  }]);
});

Deno.test('nitro mount: extracts the Cloudflare Workers env from req.runtime.cloudflare.env', async () => {
  // Nitro v3 (h3 v2) delivers worker bindings on req.runtime.cloudflare.env;
  // the h3 event has no env field, so the mount must read the runtime channel
  // (spike evidence, #981).
  const handler = createOpenElementNitroHandler({
    handler: (_request, context) => new Response(JSON.stringify({ env: context?.env })),
    env: { name: 'option-env' },
  });

  const req = new Request('https://worker.test/form') as Request & {
    runtime?: { cloudflare?: { env?: unknown } };
  };
  req.runtime = { cloudflare: { env: { OPEN_ELEMENT_DISABLE_CSRF: '1' } } };

  const response = await handler({ req: req as Request });

  assertEquals(await response.json(), { env: { OPEN_ELEMENT_DISABLE_CSRF: '1' } });
});

Deno.test('nitro mount: runtime cloudflare env wins over event.env and mount options', async () => {
  const handler = createOpenElementNitroHandler({
    handler: (_request, context) => new Response(JSON.stringify({ env: context?.env })),
    env: { name: 'option-env' },
  });

  const req = new Request('https://worker.test/form') as Request & {
    runtime?: { cloudflare?: { env?: unknown } };
  };
  req.runtime = { cloudflare: { env: { source: 'runtime' } } };

  const response = await handler({
    req: req as Request,
    env: { name: 'event-env' },
  });

  assertEquals(await response.json(), { env: { source: 'runtime' } });
});

// Shape-parity contract (#657): nitro-mount.ts intentionally does NOT reuse
// createRequestContext as a value import. Generated Nitro server output bundles
// nitro-mount.ts directly (see createNitroRequestContext's comment), and the
// bundling hosts resolve bare imports Node-style — the nitro-proof fixture has
// no node_modules entry for @openelement/router, so a value import would fail at
// bundle time. The type-only import there pins the shape; this test is the
// behavioral backstop. If it fails, one side of the contract drifted — fix the
// drift, do not relax this test.
Deno.test('nitro mount: request context shape matches app/model createRequestContext contract', async () => {
  let nitroContext: ReturnType<typeof createRequestContext> | undefined;

  const handler = createOpenElementNitroHandler({
    onBeforeRequestContext: (context) => {
      nitroContext = context;
    },
    handler: () => new Response('ok'),
  });

  await handler({
    req: new Request('https://shape.test/a/b?x=1&y=2'),
    context: { params: { b: 'b-value' } },
    env: { name: 'env' },
    platform: 'node',
  });

  const appContext = createRequestContext({
    request: new Request('https://shape.test/a/b?x=1&y=2'),
    params: { b: 'b-value' },
    env: { name: 'env' },
    platform: 'node',
  });

  const pick = (ctx: ReturnType<typeof createRequestContext>) => ({
    request: ctx.request.url,
    url: ctx.url.href,
    path: ctx.path,
    method: ctx.method,
    params: ctx.params,
    searchParams: [...ctx.searchParams.entries()],
    env: ctx.env,
    platform: ctx.platform,
  });

  assertEquals(pick(nitroContext!), pick(appContext));
});
