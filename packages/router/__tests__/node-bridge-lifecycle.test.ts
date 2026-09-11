/**
 * @openelement/router — adversarial lifecycle audit for the node:http ↔
 * Fetch bridge (#1146 area 1 + area 6, ADR-0141 "tests lock request abort,
 * response cancellation, drain, listener cleanup, keep-alive reuse and
 * repeated-run resource behavior" — this file supplies the missing unit
 * vectors).
 *
 * EventEmitter-simulated requests/responses pin, per terminal path:
 *  - 1a: listener cleanup — req ('aborted'/'error'/'data'/'end'), socket
 *    ('close') and res ('finish'/'close'/'error'/'drain') listener counts
 *    return to baseline after completion AND after abort/disconnect paths
 *    (impl removes them at node-bridge.ts:157-165, 238-243, 288-292);
 *  - 1b: Fetch request-body cancellation destroys the node request
 *    (node-bridge.ts:178-181);
 *  - 6a (unit half): 5x100 aborted cycles — zero listener growth on a shared
 *    keep-alive socket, zero unhandled rejections;
 *  - 6c: the bridge and both server entry points set no timers (inspection,
 *    pinned in code).
 *
 * Live-socket twins of these vectors live in
 * node-bridge-adversarial-http.test.ts; live round-trip parity lives in
 * node-bridge-http.test.ts.
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import process from 'node:process';
import {
  type NodeBridgeListen,
  nodeRequestToWeb,
  writeWebResponse,
} from '../src/vite/internal/node-bridge.ts';
import { renderStandaloneServerModule } from '../src/vite/internal/ssg/ssg-helpers.ts';

const direct: NodeBridgeListen = { host: '127.0.0.1', port: 4000, trustProxy: false };

const REQ_EVENTS = ['aborted', 'error', 'data', 'end'] as const;
const SOCKET_EVENTS = ['close'] as const;
const RES_EVENTS = ['finish', 'close', 'error', 'drain'] as const;

function listenerSnapshot(
  emitter: EventEmitter,
  events: readonly string[],
): Record<string, number> {
  const snapshot: Record<string, number> = {};
  for (const event of events) snapshot[event] = emitter.listenerCount(event);
  return snapshot;
}

const ZERO_REQ = { aborted: 0, error: 0, data: 0, end: 0 };
const ZERO_SOCKET = { close: 0 };
const ZERO_RES = { finish: 0, close: 0, error: 0, drain: 0 };

/** Flush the microtask/macrotask queues so async bridge cleanup settles. */
async function flush(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface FakeReq {
  req: IncomingMessage;
  emitter: EventEmitter;
  socket: EventEmitter;
  destroyCalls: unknown[];
}

function fakeReq(options: { method?: string; url?: string } = {}): FakeReq {
  const emitter = new EventEmitter();
  const socket = new EventEmitter();
  const destroyCalls: unknown[] = [];
  const req = Object.assign(emitter, {
    url: options.url ?? '/',
    method: options.method ?? 'POST',
    headers: {},
    socket,
    destroy(reason?: unknown) {
      destroyCalls.push(reason);
      // Real node tears the socket down after req.destroy(); 'close' follows.
      queueMicrotask(() => socket.emit('close'));
      return req;
    },
  });
  return { req: req as unknown as IncomingMessage, emitter, socket, destroyCalls };
}

interface FakeRes {
  res: ServerResponse;
  emitter: EventEmitter;
  written: Uint8Array[];
  ended: boolean;
  /** Script the next write() return values; default (empty) is `true`. */
  writeResults: boolean[];
}

function fakeRes(): FakeRes {
  const emitter = new EventEmitter();
  const out: FakeRes = {
    emitter,
    written: [],
    ended: false,
    writeResults: [],
    res: undefined as unknown as ServerResponse,
  };
  const res = Object.assign(emitter, {
    statusCode: 0,
    destroyed: false,
    writableEnded: false,
    setHeader() {},
    write(chunk: Uint8Array) {
      out.written.push(chunk);
      return out.writeResults.length > 0 ? out.writeResults.shift()! : true;
    },
    end() {
      out.ended = true;
      this.writableEnded = true;
      emitter.emit('finish');
    },
  });
  out.res = res as unknown as ServerResponse;
  return out;
}

/** A response body that yields `chunks` one-byte chunks then never closes. */
function hangingBody(
  chunks = 3,
): { stream: ReadableStream<Uint8Array>; state: { cancelled: number } } {
  const state = { cancelled: 0 };
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced++ < chunks) controller.enqueue(new Uint8Array([produced]));
    },
    cancel() {
      state.cancelled++;
    },
  });
  return { stream, state };
}

// ── 1a: listener cleanup on every terminal path ──────────────────────

Deno.test('1a: completed POST cycle returns req/socket/res listener counts to baseline', async () => {
  const { req, emitter, socket } = fakeReq({ method: 'POST' });
  const res = fakeRes();
  const request = nodeRequestToWeb(req, direct);
  // The bridge attached exactly its own listeners.
  assertEquals(listenerSnapshot(emitter, REQ_EVENTS), { aborted: 1, error: 1, data: 1, end: 1 });
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), { close: 1 });

  queueMicrotask(() => {
    emitter.emit('data', Buffer.from('payload'));
    emitter.emit('end');
  });
  assertEquals(await request.text(), 'payload');

  writeWebResponse(new Response('ok'), res.res, request);
  await flush();
  assert(res.ended, 'response must complete');
  assertEquals(listenerSnapshot(emitter, REQ_EVENTS), ZERO_REQ);
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), ZERO_SOCKET);
  assertEquals(listenerSnapshot(res.emitter, RES_EVENTS), ZERO_RES);
});

Deno.test('1a: completed GET cycle (no body) returns listener counts to baseline', async () => {
  const { req, emitter, socket } = fakeReq({ method: 'GET' });
  const res = fakeRes();
  const request = nodeRequestToWeb(req, direct);
  assertEquals(request.body, null);
  // GET attaches the abort trio only — never data/end.
  assertEquals(listenerSnapshot(emitter, REQ_EVENTS), { aborted: 1, error: 1, data: 0, end: 0 });
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), { close: 1 });

  writeWebResponse(new Response('ok'), res.res, request);
  await flush();
  assertEquals(listenerSnapshot(emitter, REQ_EVENTS), ZERO_REQ);
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), ZERO_SOCKET);
  assertEquals(listenerSnapshot(res.emitter, RES_EVENTS), ZERO_RES);
});

Deno.test('1a: client abort mid-upload, handler still responds — listeners cleaned on finish', async () => {
  const { req, emitter, socket } = fakeReq({ method: 'POST' });
  const res = fakeRes();
  const request = nodeRequestToWeb(req, direct);
  emitter.emit('data', Buffer.from('partial'));
  socket.emit('close'); // the client connection dies mid-upload
  assert(request.signal.aborted, 'socket close must abort the Fetch request');
  await assertRejects(() => request.text());

  writeWebResponse(new Response('late'), res.res, request);
  await flush();
  assertEquals(listenerSnapshot(emitter, REQ_EVENTS), ZERO_REQ);
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), ZERO_SOCKET);
  assertEquals(listenerSnapshot(res.emitter, RES_EVENTS), ZERO_RES);
});

Deno.test('1a: response close before finish cancels the body and cleans every listener', async () => {
  const { req, emitter, socket } = fakeReq({ method: 'POST' });
  const res = fakeRes();
  const request = nodeRequestToWeb(req, direct);
  const { stream, state } = hangingBody();
  writeWebResponse(new Response(stream), res.res, request);
  await flush();

  res.emitter.emit('close'); // client disconnects mid-response
  await flush();
  assertEquals(state.cancelled, 1, 'the web body must be cancelled exactly once');
  assertEquals(listenerSnapshot(emitter, REQ_EVENTS), ZERO_REQ);
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), ZERO_SOCKET);
  assertEquals(listenerSnapshot(res.emitter, RES_EVENTS), ZERO_RES);
});

Deno.test('1a: disconnect while parked in waitForDrain removes the drain trio too', async () => {
  const { req, emitter, socket } = fakeReq({ method: 'POST' });
  const res = fakeRes();
  res.writeResults = [false]; // first write back-pressures the pump
  const request = nodeRequestToWeb(req, direct);
  const { stream, state } = hangingBody();
  writeWebResponse(new Response(stream), res.res, request);
  await flush();
  assertEquals(res.emitter.listenerCount('drain'), 1, 'pump must be parked on drain');
  assertEquals(res.written.length, 1);

  res.emitter.emit('close'); // client gone before drain ever comes
  await flush();
  assertEquals(state.cancelled, 1);
  assertEquals(listenerSnapshot(res.emitter, RES_EVENTS), ZERO_RES);
  assertEquals(listenerSnapshot(emitter, REQ_EVENTS), ZERO_REQ);
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), ZERO_SOCKET);
});

Deno.test('1a: a response-stream cancel() that never settles must not pin bridge listeners', async () => {
  // Adversarial: a handler body whose cancel() hangs (e.g. it awaits a dead
  // upstream). The bridge's cancelBody awaits reader.cancel() BEFORE cleanup
  // (node-bridge.ts:249-259), so a hanging cancel would leak the res finish/
  // error listeners and the whole request-side trio forever.
  const { req, emitter, socket } = fakeReq({ method: 'POST' });
  const res = fakeRes();
  const request = nodeRequestToWeb(req, direct);
  let cancelCalls = 0;
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced++ < 3) controller.enqueue(new Uint8Array([produced]));
    },
    cancel() {
      cancelCalls++;
      return new Promise<void>(() => {}); // never settles
    },
  });
  writeWebResponse(new Response(stream), res.res, request);
  await flush();
  res.emitter.emit('close'); // client disconnects mid-response
  await flush();
  assertEquals(cancelCalls, 1, 'the bridge must still attempt cancellation');
  assertEquals(
    listenerSnapshot(res.emitter, RES_EVENTS),
    ZERO_RES,
    'res listeners must be removed even if the body cancel never settles',
  );
  assertEquals(
    listenerSnapshot(emitter, REQ_EVENTS),
    ZERO_REQ,
    'request listeners must be removed even if the body cancel never settles',
  );
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), ZERO_SOCKET);
});

Deno.test('1a: hanging cancel + destroyed response — the pump cannot self-heal via finish', async () => {
  // Harsher variant: parked in waitForDrain, and the socket is already
  // destroyed when 'close' arrives (the realistic disconnect shape). The
  // pump then skips res.end() (node-bridge.ts:321), so 'finish' never fires
  // and cleanup depends on cancelBody alone — which awaits the hanging
  // reader.cancel() at node-bridge.ts:254 before reaching cleanup().
  const { req, emitter, socket } = fakeReq({ method: 'POST' });
  const res = fakeRes();
  res.writeResults = [false]; // park the pump in waitForDrain
  const request = nodeRequestToWeb(req, direct);
  let cancelCalls = 0;
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced++ < 3) controller.enqueue(new Uint8Array([produced]));
    },
    cancel() {
      cancelCalls++;
      return new Promise<void>(() => {}); // never settles
    },
  });
  writeWebResponse(new Response(stream), res.res, request);
  await flush();
  assertEquals(res.emitter.listenerCount('drain'), 1, 'pump must be parked on drain');

  res.res.destroyed = true; // the socket is gone by the time 'close' fires
  res.emitter.emit('close');
  await flush();
  assertEquals(cancelCalls, 1, 'the bridge must still attempt cancellation');
  assertEquals(
    listenerSnapshot(res.emitter, RES_EVENTS),
    ZERO_RES,
    'res listeners must be removed even when the body cancel never settles',
  );
  assertEquals(
    listenerSnapshot(emitter, REQ_EVENTS),
    ZERO_REQ,
    'request listeners must be removed even when the body cancel never settles',
  );
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), ZERO_SOCKET);
});

Deno.test('1a: response already closed before writeWebResponse must still cancel the body', async () => {
  // Unit twin of the live 1d-iii vector in node-bridge-adversarial-http
  // (client disconnects while the handler is still working): the response
  // 'close' event fired BEFORE the bridge subscribed, so once-listeners at
  // node-bridge.ts:274-276 can never observe it. The bridge must detect the
  // already-dead response instead of writing into the void.
  const { req, emitter, socket } = fakeReq({ method: 'GET' });
  const res = fakeRes();
  res.res.destroyed = true; // the socket died before the handler responded
  res.writeResults = [false, false, false]; // a dead socket accepts nothing
  const request = nodeRequestToWeb(req, direct);
  let cancelled = 0;
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced++ < 3) controller.enqueue(new Uint8Array([produced]));
    },
    cancel() {
      cancelled++;
    },
  });
  writeWebResponse(new Response(stream), res.res, request);
  await flush();
  assertEquals(
    cancelled,
    1,
    'the web body must be cancelled when the response is already dead at write time',
  );
  assertEquals(listenerSnapshot(res.emitter, RES_EVENTS), ZERO_RES);
  assertEquals(listenerSnapshot(emitter, REQ_EVENTS), ZERO_REQ);
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), ZERO_SOCKET);
});

Deno.test('1a: response error aborts the request and cleans every listener', async () => {
  const { req, emitter, socket } = fakeReq({ method: 'POST' });
  const res = fakeRes();
  res.writeResults = [false];
  const request = nodeRequestToWeb(req, direct);
  const { stream, state } = hangingBody();
  writeWebResponse(new Response(stream), res.res, request);
  await flush();

  res.emitter.emit('error', new Error('socket blew up'));
  await flush();
  assert(request.signal.aborted, 'res error must abort the Fetch request');
  assertEquals(state.cancelled, 1);
  assertEquals(listenerSnapshot(res.emitter, RES_EVENTS), ZERO_RES);
  assertEquals(listenerSnapshot(emitter, REQ_EVENTS), ZERO_REQ);
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), ZERO_SOCKET);
});

Deno.test('1a: sequential requests on a shared keep-alive socket leave zero close listeners', async () => {
  // One socket emitter plays the keep-alive socket across 25 full cycles —
  // the unit twin of the live single-socket loop in
  // node-bridge-adversarial-http.test.ts.
  const socket = new EventEmitter();
  for (let cycle = 0; cycle < 25; cycle++) {
    const emitter = new EventEmitter();
    const req = Object.assign(emitter, {
      url: '/',
      method: 'GET',
      headers: {},
      socket,
      destroy() {
        return req;
      },
    });
    const res = fakeRes();
    const request = nodeRequestToWeb(req as unknown as IncomingMessage, direct);
    writeWebResponse(new Response('ok'), res.res, request);
    await flush();
    assertEquals(
      socket.listenerCount('close'),
      0,
      `cycle ${cycle} leaked a close listener onto the shared socket`,
    );
    assertEquals(listenerSnapshot(emitter, REQ_EVENTS), ZERO_REQ);
    assertEquals(listenerSnapshot(res.emitter, RES_EVENTS), ZERO_RES);
  }
});

// ── 1b: Fetch request-body cancellation destroys the node request ────

Deno.test('1b: cancelling the request body mid-upload destroys the node request', async () => {
  const { req, emitter, socket, destroyCalls } = fakeReq({ method: 'POST' });
  const request = nodeRequestToWeb(req, direct);
  const reader = request.body!.getReader();
  queueMicrotask(() => emitter.emit('data', Buffer.from('chunk-1')));
  const first = await reader.read();
  assertEquals(new TextDecoder().decode(first.value), 'chunk-1');

  const reason = new Error('reader gave up');
  await reader.cancel(reason);
  assertEquals(destroyCalls.length, 1, 'req.destroy must fire exactly once');
  assertEquals(destroyCalls[0], reason, 'an Error cancel reason must reach req.destroy');
  assert(request.signal.aborted);

  // The destroyed socket closed; a (late) response still cleans everything up.
  const res = fakeRes();
  writeWebResponse(new Response('ok'), res.res, request);
  await flush();
  assertEquals(listenerSnapshot(emitter, REQ_EVENTS), ZERO_REQ);
  assertEquals(listenerSnapshot(socket, SOCKET_EVENTS), ZERO_SOCKET);
  assertEquals(listenerSnapshot(res.emitter, RES_EVENTS), ZERO_RES);
});

Deno.test('1b: non-Error cancel reasons are not passed to req.destroy; double cancel destroys once', async () => {
  const { req, emitter, destroyCalls } = fakeReq({ method: 'POST' });
  const request = nodeRequestToWeb(req, direct);
  queueMicrotask(() => emitter.emit('data', Buffer.from('x')));
  await request.body!.cancel('client gone');
  await request.body!.cancel('client gone again');
  assertEquals(destroyCalls.length, 1, 'the underlying cancel callback fires once');
  assertEquals(
    destroyCalls[0],
    undefined,
    'a non-Error reason must reach req.destroy as undefined (node-bridge.ts:180)',
  );
  assert(request.signal.aborted);
});

// ── 6a (unit half): repeated abort cycles on a shared socket ─────────

Deno.test('6a: 5x100 aborted request/response cycles — no listener growth, no unhandled rejections', async () => {
  const rejections: unknown[] = [];
  const onUnhandled = (reason: unknown) => rejections.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const socket = new EventEmitter(); // one shared keep-alive socket
    for (let iteration = 0; iteration < 5; iteration++) {
      for (let n = 0; n < 100; n++) {
        const emitter = new EventEmitter();
        const req = Object.assign(emitter, {
          url: '/upload',
          method: 'POST',
          headers: {},
          socket,
          destroy() {
            return req;
          },
        });
        const res = fakeRes();
        const request = nodeRequestToWeb(req as unknown as IncomingMessage, direct);
        const { stream } = hangingBody();
        writeWebResponse(new Response(stream), res.res, request);
        emitter.emit('aborted'); // client aborts the request
        res.emitter.emit('close'); // and the connection drops before finish
        // Keep-alive is sequential: settle each cycle before the next so the
        // in-flight listener count models reality (and stays under Node's
        // MaxListeners warning threshold) — the assertion below pins the
        // post-settle return to zero.
        await flush(1);
      }
      await flush();
      assertEquals(
        socket.listenerCount('close'),
        0,
        `iteration ${iteration}: socket close listeners must return to zero`,
      );
    }
    await flush();
    assertEquals(
      rejections.length,
      0,
      `unhandled rejections: ${rejections.map((r) => String(r)).join('; ')}`,
    );
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

// ── 6c: the bridge and servers set no timers (inspection, pinned) ────

Deno.test('6c: bridge, start.ts, dispatch and generated serve.mjs create no timers', async () => {
  const read = (specifier: string) => Deno.readTextFile(new URL(specifier, import.meta.url));
  const sources: Record<string, string> = {
    'internal/node-bridge.ts': await read('../src/vite/internal/node-bridge.ts'),
    'cli/start.ts': await read('../src/cli/start.ts'),
    'internal/static-serve.ts': await read('../src/vite/internal/static-serve.ts'),
    'generated serve.mjs': renderStandaloneServerModule(),
  };
  const timer = /\bsetTimeout\s*\(|\bsetInterval\s*\(|\bsetImmediate\s*\(/;
  for (const [name, source] of Object.entries(sources)) {
    assertEquals(
      timer.test(source),
      false,
      `${name} must not create timers — nothing can accumulate across cycles`,
    );
  }
});
