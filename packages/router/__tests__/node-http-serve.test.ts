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

import { createServer as createHttpServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import process from 'node:process';
import { expect, test } from 'vitest';
import { serveFetch, type FetchHandler } from '../src/internal/node-http.ts';
import {
  runActionProtocol,
  ACTION_FETCH_HEADER,
} from '../src/vite/internal/server-runtime/action-runtime.ts';
import { createRequestScope } from '../src/vite/internal/server-runtime/wintercg.ts';

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

/**
 * The request origin the bridge hands the standard fetch handler decides
 * whether a same-origin browser action is admitted, because the action
 * protocol compares `Origin` against the request URL's own origin.
 *
 * Behind a TLS-terminating proxy the scheme the browser used is not the scheme
 * the node server sees, so a hardcoded `http://` made every legitimate
 * same-origin POST look cross-site. These rows drive the REAL action protocol
 * through a REAL node server — nothing is stubbed between the socket and the
 * CSRF comparison — and they pin both directions: the explicit policies
 * recover the origin, and the CSRF floor still rejects a genuine cross-site
 * post and a forged forwarded header.
 */
const FORWARDED_SAME_ORIGIN_POST = {
  'content-type': 'application/x-www-form-urlencoded',
  host: 'example.test',
  origin: 'https://example.test',
  'sec-fetch-site': 'same-origin',
  'x-forwarded-proto': 'https',
};

/** Boot a node server whose handler runs the real action protocol. */
async function bootActionServer(policy: {
  publicOrigin?: string;
  trustProxy?: boolean;
}): Promise<{ server: Server; port: number }> {
  const handler: FetchHandler = async (request) => {
    const state = { isFetch: false };
    const execution = await runActionProtocol(
      createRequestScope(request, {}),
      { action: () => ({ ok: true }) },
      { env: {} },
      (title, message, status) => new Response(`${title}|${message}`, { status }),
      state,
    );
    return execution.response ?? new Response('no response', { status: 500 });
  };
  const server = serveFetch({ hostname: '127.0.0.1', port: 0, handler, ...policy });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { server, port: (server.address() as AddressInfo).port };
}

/** POST with explicit Host/Origin/Sec-Fetch headers, which fetch would override. */
async function postRaw(
  port: number,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/',
        headers: { ...headers, 'content-length': '3' },
      },
      (answer) => {
        const chunks: Buffer[] = [];
        answer.on('data', (chunk: Buffer) => chunks.push(chunk));
        answer.on('end', () =>
          resolve({ status: answer.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    request.on('error', reject);
    request.end('a=1');
  });
}

test('node-http: a trusted public origin admits a same-origin action behind TLS termination', async () => {
  const { server, port } = await bootActionServer({ publicOrigin: 'https://example.test' });
  try {
    const answered = await postRaw(port, FORWARDED_SAME_ORIGIN_POST);
    expect(answered.status, 'the proxied same-origin POST is admitted').toEqual(303);
  } finally {
    await close(server);
  }
});

test('node-http: a declared trusted proxy reads the forwarded scheme', async () => {
  const { server, port } = await bootActionServer({ trustProxy: true });
  try {
    const answered = await postRaw(port, FORWARDED_SAME_ORIGIN_POST);
    expect(answered.status, 'the proxied same-origin POST is admitted').toEqual(303);
  } finally {
    await close(server);
  }
});

test('node-http: without a policy the origin is the plain http one, and the proxy case fails closed', async () => {
  const { server, port } = await bootActionServer({});
  try {
    const proxied = await postRaw(port, FORWARDED_SAME_ORIGIN_POST);
    expect(proxied.status, 'an undeclared proxy is not trusted').toEqual(403);
    // The same server still admits the deployment it actually is: a plain
    // http same-origin POST is what the hardcoded origin describes.
    const direct = await postRaw(port, {
      ...FORWARDED_SAME_ORIGIN_POST,
      origin: 'http://example.test',
      'x-forwarded-proto': 'http',
    });
    expect(direct.status, 'a genuine http same-origin POST is admitted').toEqual(303);
  } finally {
    await close(server);
  }
});

test('node-http: the CSRF floor still rejects a cross-site POST under every policy', async () => {
  for (const policy of [{}, { publicOrigin: 'https://example.test' }, { trustProxy: true }]) {
    const { server, port } = await bootActionServer(policy);
    try {
      const answered = await postRaw(port, {
        ...FORWARDED_SAME_ORIGIN_POST,
        origin: 'https://evil.test',
        'sec-fetch-site': 'cross-site',
      });
      expect(answered.status, `${JSON.stringify(policy)} must reject a cross-site POST`).toEqual(
        403,
      );
      // The native form channel answers the plain-text copy; the fetch channel
      // the problem+json detail. Both name the rejection.
      expect(
        answered.body.includes('Forbidden') ||
          answered.body.includes('Cross-site form submission rejected'),
        answered.body,
      ).toBe(true);
    } finally {
      await close(server);
    }
  }
});

test('node-http: the fetch channel reports the cross-site rejection as problem+json', async () => {
  // The structured detail is the half a client can act on, so it is pinned
  // separately from the native channel's plain-text copy.
  const { server, port } = await bootActionServer({ publicOrigin: 'https://example.test' });
  try {
    const answered = await postRaw(port, {
      ...FORWARDED_SAME_ORIGIN_POST,
      origin: 'https://evil.test',
      'sec-fetch-site': 'cross-site',
      [ACTION_FETCH_HEADER]: 'true',
    });
    expect(answered.status, 'a cross-site fetch action is rejected').toEqual(403);
    expect(answered.body.includes('Cross-site form submission rejected'), answered.body).toBe(true);
  } finally {
    await close(server);
  }
});

test('node-http: an undeclared proxy cannot forge the scheme through forwarded headers', async () => {
  // No policy: the client controls every forwarded header, so none of them may
  // move the origin. The assertion is the same 403 the audit's repro hit — it
  // is the CORRECT answer for a deployment that has not declared a proxy.
  const { server, port } = await bootActionServer({});
  try {
    const answered = await postRaw(port, {
      ...FORWARDED_SAME_ORIGIN_POST,
      'x-forwarded-host': 'example.test',
      forwarded: 'for=203.0.113.7;proto=https;host=example.test',
    });
    expect(answered.status, 'a forged forwarded header is not trusted').toEqual(403);
  } finally {
    await close(server);
  }
});

test('node-http: a cross-site Origin beats a same-origin Sec-Fetch-Site under trustProxy', async () => {
  const { server, port } = await bootActionServer({ trustProxy: true });
  try {
    const answered = await postRaw(port, {
      ...FORWARDED_SAME_ORIGIN_POST,
      origin: 'https://evil.test',
    });
    expect(answered.status, 'the Origin comparison is not relaxed by trustProxy').toEqual(403);
  } finally {
    await close(server);
  }
});
