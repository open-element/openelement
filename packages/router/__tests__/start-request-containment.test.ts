/**
 * Hostile containment test for the standard fetch handler.
 *
 * `dispatchRequest` may throw or reject; the fetch handler must contain an
 * escaping failure as a 500 response, never an unhandled rejection.
 */

import { assertEquals } from '@std/assert';
import { createFetchHandler, type FetchHandlerOptions } from '../src/vite/internal/static-serve.ts';

async function assertContained500(
  dispatch: NonNullable<FetchHandlerOptions['dispatch']>,
): Promise<void> {
  const handler = createFetchHandler({
    distDir: '/nonexistent-dist',
    serverMod: null,
    env: {},
    dispatch,
  });
  const response = await handler(new Request('http://127.0.0.1/hostile'));
  assertEquals(response.status, 500);
  await response.text();
}

Deno.test('start: a rejected dispatch is contained as 500', async () => {
  await assertContained500(() => Promise.reject(new Error('hostile escape')));
});

Deno.test('start: a synchronously throwing dispatch is contained as 500', async () => {
  await assertContained500(() => {
    throw new Error('hostile synchronous escape');
  });
});
