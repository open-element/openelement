/**
 * Hostile containment test for the dev/start request callback (issue #1220, M8).
 *
 * `dispatchRequest` rethrows non-URIError failures (internal/static-serve.ts),
 * so the node:http callback in cli/start.ts must contain an escaping failure
 * as a 500 response. Before the fix the callback was `async` with no catch,
 * turning any escaping failure into an unhandled rejection that crashes the
 * process (Node default since v15). The generated standalone server already
 * had the correct `.catch` → 500 pattern (internal/ssg/ssg-helpers.ts); this
 * test pins parity.
 */

import { assertEquals } from '@std/assert';
import { createServer } from 'node:http';
import process from 'node:process';
import {
  createStartRequestHandler,
  type StartRequestHandlerOptions,
} from '../src/vite/internal/static-serve.ts';

async function withServer(
  handler: ReturnType<typeof createStartRequestHandler>,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    await run(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function assertContained500(
  dispatch: NonNullable<StartRequestHandlerOptions['dispatch']>,
): Promise<void> {
  const handler = createStartRequestHandler({
    distDir: '/nonexistent-dist',
    serverMod: null,
    env: {},
    host: '127.0.0.1',
    port: 0,
    trustProxy: false,
    dispatch,
  });
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    await withServer(handler, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/hostile`);
      assertEquals(response.status, 500);
      await response.text();
    });
    // Give any stray rejection a chance to surface before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assertEquals(unhandled, [], 'escaping callback failure became an unhandled rejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
}

Deno.test('start: a rejected dispatch is contained as 500, not a process crash', async () => {
  await assertContained500(() => Promise.reject(new Error('hostile escape')));
});

Deno.test('start: a synchronously throwing dispatch is contained as 500, not a process crash', async () => {
  await assertContained500(() => {
    throw new Error('hostile synchronous escape');
  });
});
