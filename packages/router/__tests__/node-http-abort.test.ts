/**
 * Disconnect propagation for the node:http ↔ fetch adapter (ADR-0158,
 * "Flow control and cancellation": `Request.signal` and stream `cancel()`
 * converge on one idempotent cleanup). These tests pin the adapter-owned
 * half of that convergence:
 *   - a client socket destroyed mid-exchange aborts `request.signal` while
 *     the handler is still pending — driven over a real node:net socket,
 *     because the disconnect is a socket event no fetch client can observe;
 *   - a fully received request is not a disconnect: IncomingMessage 'close'
 *     also fires once the body completes (before the handler consumes it),
 *     so a complete POST with a slow handler must answer with an intact
 *     signal, while a disconnect landing after completion — during the
 *     pending handler — is still caught on the response side.
 */

import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
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
function withTimeout(promise: Promise<void>, message: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 2000);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * A raw socket exchange: send `raw`, then destroy the socket as soon as the
 * server-side handler reports it is pending (`entered`) — so the disconnect
 * always lands mid-handler, never before the signal wiring is observable.
 */
function destroyAfterEntered(port: number, raw: string, entered: Promise<void>): void {
  const socket = connect(port, '127.0.0.1', () => {
    socket.write(raw);
    void entered.then(() => socket.destroy());
  });
  socket.on('error', () => {
    // The server may reset a socket this test already destroyed; the
    // disconnect itself is what is under test, not the client-side I/O.
  });
}

test('node-http: a client socket destroyed mid-handler aborts request.signal', async () => {
  const entered = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  let observed: AbortSignal | undefined;
  const { server, port } = await boot((request) => {
    observed = request.signal;
    request.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    entered.resolve();
    // Hang: the handler never answers, so only the disconnect can end it.
    return new Promise<Response>(() => {});
  });
  try {
    destroyAfterEntered(
      port,
      'GET /hang HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
      entered.promise,
    );
    await withTimeout(
      aborted.promise,
      'request.signal did not abort within 2s of the client socket destroy',
    );
    expect(observed?.aborted, 'signal observed aborted mid-handler').toEqual(true);
  } finally {
    await close(server);
  }
});

test('node-http: a client destroyed mid-POST-upload aborts request.signal', async () => {
  const entered = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  let observed: AbortSignal | undefined;
  const { server, port } = await boot((request) => {
    observed = request.signal;
    request.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    entered.resolve();
    // Hang: the handler never answers, so only the disconnect can end it.
    return new Promise<Response>(() => {});
  });
  try {
    // Declares 64 body bytes but sends 4: the server dispatches on the
    // headers, so the disconnect lands with the upload still in flight.
    destroyAfterEntered(
      port,
      'POST /hang HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 64\r\n\r\nhalf',
      entered.promise,
    );
    await withTimeout(
      aborted.promise,
      'request.signal did not abort within 2s of the mid-upload destroy',
    );
    expect(observed?.aborted, 'signal observed aborted mid-upload').toEqual(true);
  } finally {
    await close(server);
  }
});

test('node-http: a fully answered exchange never aborts request.signal', async () => {
  let observed: AbortSignal | undefined;
  const { server, port } = await boot((request) => {
    observed = request.signal;
    return Promise.resolve(new Response('ok'));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status, 'answered status').toEqual(200);
    expect(await response.text(), 'answered body').toEqual('ok');
    expect(observed?.aborted, 'not aborted while answering').toEqual(false);
    // Tear the keep-alive socket down the same way the disconnect path
    // would: IncomingMessage 'close' fires here too (after the response
    // flush), and the guarded wiring must not abort an answered exchange.
    server.closeAllConnections();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(observed?.aborted, 'not aborted after the connection closed').toEqual(false);
  } finally {
    await close(server);
  }
});

test('node-http: a fully received POST body with a slow handler never aborts request.signal', async () => {
  let observed: AbortSignal | undefined;
  let handlerSaw: boolean | undefined;
  const { server, port } = await boot(async (request) => {
    observed = request.signal;
    const body = await request.text();
    // IncomingMessage 'close' lands in this window (the body completed on
    // the wire) — the regression this test pins: it must not be read as a
    // disconnect, which the pre-fix wiring did, aborting right here.
    await new Promise((resolve) => setTimeout(resolve, 100));
    handlerSaw = request.signal.aborted;
    return new Response(`echo:${body}`);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      body: 'ping',
    });
    expect(response.status, 'answered status').toEqual(200);
    expect(await response.text(), 'answered body').toEqual('echo:ping');
    expect(handlerSaw, 'signal intact during the slow handler').toEqual(false);
    expect(observed?.aborted, 'not aborted while answering').toEqual(false);
    // Tear the keep-alive socket down the same way the disconnect path
    // would: a completed request must keep its non-abort verdict.
    server.closeAllConnections();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(observed?.aborted, 'not aborted after the connection closed').toEqual(false);
  } finally {
    await close(server);
  }
});

test('node-http: a client destroyed after the POST body completed aborts request.signal', async () => {
  const entered = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  let observed: AbortSignal | undefined;
  const { server, port } = await boot(async (request) => {
    observed = request.signal;
    request.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    // Consume the whole upload first: the disconnect must land after the
    // request completed, past the request-side 'close' guard.
    await request.text();
    entered.resolve();
    // Hang: the handler never answers, so only the disconnect can end it.
    return new Promise<Response>(() => {});
  });
  try {
    // A complete POST (Content-Length matches the body): with the request
    // whole, only the response-side listener can observe the disconnect.
    destroyAfterEntered(
      port,
      'POST /hang HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 4\r\n\r\nbody',
      entered.promise,
    );
    await withTimeout(
      aborted.promise,
      'request.signal did not abort within 2s of the post-upload destroy',
    );
    expect(observed?.aborted, 'signal observed aborted mid-handler').toEqual(true);
  } finally {
    await close(server);
  }
});
