/**
 * node-http serve-surface regressions beyond disconnect propagation:
 *   - sendResponse's bodyless answers (HEAD, 204, 304) must cancel a fetch
 *     Response body that still carries a stream, instead of parking it
 *     unconsumed forever; a cancel() rejection must be swallowed, not left
 *     as an unhandled rejection;
 *   - serveFetch keeps node's listen-error contract: a failed bind surfaces
 *     on the returned Server's 'error' event for the embedder to handle
 *     (the start CLI attaches that handler).
 */

import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import process from 'node:process';
import { expect, test } from 'vitest';
import { serveFetch, type FetchHandler } from '../src/internal/node-http.ts';

async function boot(handler: FetchHandler): Promise<{ server: Server; port: number }> {
  const server = serveFetch({ hostname: '127.0.0.1', port: 0, handler });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address() as AddressInfo;
  return { server, port };
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Reject with a pointed message when the observed event never lands. */
function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 2000);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** A stream that never produces or completes on its own: only cancel() ends it. */
function pendingBody(onCancel: (reason: unknown) => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull() {
      // Never enqueues: the stream stays pending until cancelled.
    },
    cancel(reason) {
      onCancel(reason);
    },
  });
}

test('node-http: a HEAD answer cancels an unconsumed response body', async () => {
  const cancelled = Promise.withResolvers<unknown>();
  const { server, port } = await boot(() => new Response(pendingBody(cancelled.resolve)));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' });
    expect(response.status, 'answered status').toEqual(200);
    await withTimeout(cancelled.promise, 'the HEAD answer left the response body uncancelled');
  } finally {
    await close(server);
  }
});

for (const status of [204, 304]) {
  test(`node-http: a ${status} answer cancels an unconsumed response body`, async () => {
    const cancelled = Promise.withResolvers<unknown>();
    // The Response constructor refuses a body for null-body statuses, but
    // the adapter must stay defensive: shadow the status on a body-carrying
    // Response to exercise the exact branch sendResponse guards.
    const response = new Response(pendingBody(cancelled.resolve));
    Object.defineProperty(response, 'status', { value: status });
    const { server, port } = await boot(() => response);
    try {
      const answered = await fetch(`http://127.0.0.1:${port}/`);
      expect(answered.status, 'answered status').toEqual(status);
      await withTimeout(cancelled.promise, `the ${status} answer left the body uncancelled`);
    } finally {
      await close(server);
    }
  });
}

test('node-http: a body whose cancel() rejects never escapes as an unhandled rejection', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  const rejecting = new ReadableStream<Uint8Array>({
    cancel() {
      return Promise.reject(new Error('cancel exploded'));
    },
  });
  const { server, port } = await boot(() => new Response(rejecting));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' });
    expect(response.status, 'answered status').toEqual(200);
    // Give the rejected cancel() a macrotask to surface before asserting.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(unhandled, 'no unhandled rejection may escape').toEqual([]);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await close(server);
  }
});

test('node-http: a taken port surfaces EADDRINUSE on the returned server error event', async () => {
  const occupier = createHttpServer(() => {});
  await new Promise<void>((resolve) => occupier.listen(0, '127.0.0.1', resolve));
  const { port } = occupier.address() as AddressInfo;
  const failed = Promise.withResolvers<NodeJS.ErrnoException>();
  const server = serveFetch({
    hostname: '127.0.0.1',
    port,
    handler: () => Promise.resolve(new Response('unused')),
  });
  server.on('error', (error) => failed.resolve(error as NodeJS.ErrnoException));
  try {
    const error = await withTimeout(failed.promise, 'the listen failure never surfaced');
    expect(error.code, 'listen failure errno').toEqual('EADDRINUSE');
  } finally {
    await close(server);
    await new Promise<void>((resolve) => occupier.close(() => resolve()));
  }
});
