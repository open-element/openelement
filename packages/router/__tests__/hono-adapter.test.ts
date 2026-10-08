/**
 * Unit tests for the single Hono adapter (#1560): the one opt-in seam that
 * resolves the optional `hono` peer. The generated entry's default export and
 * `openElementHandler` satisfy WinterCgHandler directly, so mounting must be
 * pure per-request delegation — the raw request, the host env, and (when the
 * host runtime provides one) the execution context, with no dialect
 * translation in either direction.
 */
import { expect, test } from 'vitest';
import { createHonoAdapter } from '../src/hono-adapter.ts';
import type { WinterCgHandler } from '../src/hono-adapter.ts';

/** The Hono app shape the adapter returns, narrowed for the dispatch calls. */
type HonoApp = {
  fetch: (request: Request, env?: unknown, executionCtx?: unknown) => Promise<Response>;
};

test('the adapter mounts the handler for every method and delegates the raw request', async () => {
  const seen: Array<{ method: string; url: string; env: Record<string, unknown> }> = [];
  const handler: WinterCgHandler = (request, env) => {
    seen.push({ method: request.method, url: request.url, env: env ?? {} });
    return Promise.resolve(new Response('delegated', { status: 201 }));
  };
  const app = (await createHonoAdapter(handler)) as HonoApp;

  const got = await app.fetch(new Request('https://app.test/api/hello'));
  expect(got.status).toEqual(201);
  expect(await got.text()).toEqual('delegated');
  expect(seen[0]?.method).toEqual('GET');
  expect(seen[0]?.url).toEqual('https://app.test/api/hello');
  // No host env handed in: the adapter supplies the empty record, never undefined.
  expect(seen[0]?.env).toEqual({});

  const posted = await app.fetch(new Request('https://app.test/api/hello', { method: 'POST' }));
  expect(posted.status).toEqual(201);
  expect(seen[1]?.method).toEqual('POST');
});

test('the adapter threads the host env binding and a missing execution context as undefined', async () => {
  let seenEnv: unknown;
  let seenPlatform: unknown;
  const handler: WinterCgHandler = (_request, env, platform) => {
    seenEnv = env;
    seenPlatform = platform;
    return Promise.resolve(new Response('ok'));
  };
  const app = (await createHonoAdapter(handler)) as HonoApp;

  await app.fetch(new Request('https://app.test/'), { DEPLOY: '1' });
  expect(seenEnv).toEqual({ DEPLOY: '1' });
  // A plain fetch dispatch carries no execution context: the adapter must not
  // fabricate one (the generated handlers guard on undefined).
  expect(seenPlatform).toBeUndefined();
});
