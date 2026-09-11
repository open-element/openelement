/**
 * @openelement/router — node-bridge contract tests.
 *
 * The node:http ↔ Fetch bridge (internal/node-bridge.ts) is the single
 * source for cli/start.ts and the generated dist/server/serve.mjs
 * (renderStandaloneServerModule embeds the function sources verbatim).
 * These tests pin:
 *  - URL construction: validated Host header, listen-address fallback,
 *    hostile Host rejection, and the OPEN_ELEMENT_TRUST_PROXY=1 opt-in for
 *    X-Forwarded-Proto/Host (never trusted by default) — the ADR-0122 §3
 *    CSRF Origin compare runs against this URL;
 *  - multi Set-Cookie preservation on the response side (getSetCookie →
 *    node header array);
 *  - source parity: serve.mjs embeds exactly these function bodies and
 *    start.ts carries no local copy.
 *
 * Live HTTP round-trips against both servers live in
 * node-bridge-http.test.ts.
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import {
  applyWebResponseHeaders,
  NODE_BRIDGE_EMBEDDED_FUNCTIONS,
  type NodeBridgeListen,
  nodeRequestToWeb,
  resolveRequestUrl,
  writeWebResponse,
} from '../src/vite/internal/node-bridge.ts';
import { renderStandaloneServerModule } from '../src/vite/internal/ssg/ssg-helpers.ts';

const direct: NodeBridgeListen = { host: '0.0.0.0', port: 4173, trustProxy: false };
const proxy: NodeBridgeListen = { host: '0.0.0.0', port: 4173, trustProxy: true };

Deno.test('resolveRequestUrl: validated Host header decides the authority', () => {
  assertEquals(
    resolveRequestUrl('/form?x=1', { host: 'app.example.com' }, direct),
    'http://app.example.com/form?x=1',
  );
  // An explicit Host port survives; a default port is normalized away.
  assertEquals(
    resolveRequestUrl('/', { host: 'app.example.com:8080' }, direct),
    'http://app.example.com:8080/',
  );
  assertEquals(
    resolveRequestUrl('/', { host: 'APP.Example.com:80' }, direct),
    'http://app.example.com/',
  );
  // IPv6 Host values keep their brackets.
  assertEquals(
    resolveRequestUrl('/', { host: '[::1]:4173' }, direct),
    'http://[::1]:4173/',
  );
});

Deno.test('resolveRequestUrl: no Host falls back to the listen address', () => {
  assertEquals(resolveRequestUrl('/a', {}, direct), 'http://localhost:4173/a');
  assertEquals(
    resolveRequestUrl('/a', {}, { host: '127.0.0.1', port: 5000, trustProxy: false }),
    'http://127.0.0.1:5000/a',
  );
});

Deno.test('resolveRequestUrl: malformed or hostile Host is refused, never trusted', () => {
  for (const hostile of ['a@evil.com', 'example.com/x', 'exa mple.com', 'example.com?q=1', '']) {
    assertEquals(
      resolveRequestUrl('/a', { host: hostile }, direct),
      'http://localhost:4173/a',
      `host ${JSON.stringify(hostile)} must fall back to the listen address`,
    );
  }
});

Deno.test('resolveRequestUrl: X-Forwarded-* ignored without the trust-proxy opt-in', () => {
  assertEquals(
    resolveRequestUrl('/', {
      host: 'app.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'evil.example',
    }, direct),
    'http://app.example.com/',
  );
});

Deno.test('resolveRequestUrl: trust-proxy opt-in honors X-Forwarded-Proto/Host', () => {
  assertEquals(
    resolveRequestUrl('/form', {
      host: 'internal:8080',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'app.example.com',
    }, proxy),
    'https://app.example.com/form',
  );
  // Host is the authority fallback when X-Forwarded-Host is absent.
  assertEquals(
    resolveRequestUrl('/', { host: 'app.example.com', 'x-forwarded-proto': 'https' }, proxy),
    'https://app.example.com/',
  );
  // Comma lists: the first (client-facing) value wins; junk proto is ignored.
  assertEquals(
    resolveRequestUrl('/', { host: 'app.example.com', 'x-forwarded-proto': 'https, http' }, proxy),
    'https://app.example.com/',
  );
  assertEquals(
    resolveRequestUrl('/', { host: 'app.example.com', 'x-forwarded-proto': 'gopher' }, proxy),
    'http://app.example.com/',
  );
  // A hostile X-Forwarded-Host falls back to the listen address too.
  assertEquals(
    resolveRequestUrl(
      '/',
      { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'a@evil.com' },
      proxy,
    ),
    'http://localhost:4173/',
  );
});

Deno.test('applyWebResponseHeaders: multiple Set-Cookie go out as a node header array', () => {
  const headers = new Headers({ 'content-type': 'text/plain' });
  headers.append('set-cookie', 'sb-proj-auth-token.0=chunk-zero; Path=/; HttpOnly');
  headers.append('set-cookie', 'sb-proj-auth-token.1=chunk-one; Path=/; HttpOnly');
  const calls: Array<[string, string | string[]]> = [];
  applyWebResponseHeaders(headers, (key, value) => calls.push([key, value]));
  assertEquals(calls, [
    ['content-type', 'text/plain'],
    ['set-cookie', [
      'sb-proj-auth-token.0=chunk-zero; Path=/; HttpOnly',
      'sb-proj-auth-token.1=chunk-one; Path=/; HttpOnly',
    ]],
  ]);
});

Deno.test('nodeRequestToWeb: GET without body; Host-derived URL', () => {
  const req = Object.assign(new EventEmitter(), {
    url: '/form?x=1',
    method: 'GET',
    headers: { host: 'app.example.com' },
    socket: new EventEmitter(),
  });
  const request = nodeRequestToWeb(req as unknown as IncomingMessage, direct);
  assertEquals(request.url, 'http://app.example.com/form?x=1');
  assertEquals(request.method, 'GET');
  assertEquals(request.body, null);
  assertEquals(request.headers.get('host'), 'app.example.com');
});

Deno.test('nodeRequestToWeb: POST streams the body through', async () => {
  const emitter = new EventEmitter();
  const socket = new EventEmitter();
  const req = Object.assign(emitter, { url: '/', method: 'POST', headers: {}, socket });
  const request = nodeRequestToWeb(req as unknown as IncomingMessage, direct);
  queueMicrotask(() => {
    emitter.emit('data', Buffer.from('hello-'));
    emitter.emit('data', Buffer.from('body'));
    emitter.emit('end');
  });
  assertEquals(await request.text(), 'hello-body');
});

Deno.test('nodeRequestToWeb: client abort propagates to Request.signal', () => {
  const emitter = new EventEmitter();
  const socket = new EventEmitter();
  const req = Object.assign(emitter, { url: '/', method: 'GET', headers: {}, socket });
  const request = nodeRequestToWeb(req as unknown as IncomingMessage, direct);
  assertEquals(request.signal.aborted, false);
  emitter.emit('aborted');
  assertEquals(request.signal.aborted, true);
});

Deno.test('writeWebResponse: status, set-cookie array and streamed body reach the node response', async () => {
  const headers = new Headers();
  headers.append('set-cookie', 'a=1');
  headers.append('set-cookie', 'b=2');
  const response = new Response('chunked-body', { status: 201, headers });
  const written: Array<{ key: string; value: string | string[] }> = [];
  const chunks: Uint8Array[] = [];
  let ended = false;
  const resEvents = new EventEmitter();
  const res = Object.assign(resEvents, {
    statusCode: 0,
    destroyed: false,
    writableEnded: false,
    setHeader(key: string, value: string | string[]) {
      written.push({ key, value });
    },
    write(value: Uint8Array) {
      chunks.push(value);
      return true;
    },
    end() {
      ended = true;
      this.writableEnded = true;
      resEvents.emit('finish');
    },
  });
  writeWebResponse(response, res as never);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(res.statusCode, 201);
  // A string body makes the Response auto-set content-type; the load-bearing
  // assertion is that both Set-Cookie values go out as one array.
  assertEquals(written, [
    { key: 'content-type', value: 'text/plain;charset=UTF-8' },
    { key: 'set-cookie', value: ['a=1', 'b=2'] },
  ]);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  assertEquals(new TextDecoder().decode(merged), 'chunked-body');
  assert(ended);
});

Deno.test('writeWebResponse: backpressure pauses pulling until drain', async () => {
  let pulls = 0;
  let cancelled = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array([pulls]));
        if (pulls === 3) controller.close();
      },
      cancel() {
        cancelled++;
      },
    }),
  );
  const resEvents = new EventEmitter();
  const res = Object.assign(resEvents, {
    statusCode: 0,
    destroyed: false,
    writableEnded: false,
    setHeader() {},
    writes: 0,
    write() {
      this.writes++;
      return this.writes !== 1;
    },
    end() {
      this.writableEnded = true;
      resEvents.emit('finish');
    },
  });
  writeWebResponse(response, res as never);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(res.writes, 1);
  assert(pulls <= 2, 'the stream may prefetch one chunk but must stop writing');
  res.emit('drain');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(res.writes, 3);
  assertEquals(cancelled, 0);
});

Deno.test('writeWebResponse: response close cancels the web stream', async () => {
  let cancelled = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled++;
      },
    }),
  );
  const resEvents = new EventEmitter();
  const res = Object.assign(resEvents, {
    statusCode: 0,
    destroyed: false,
    writableEnded: false,
    setHeader() {},
    write() {
      resEvents.emit('close');
      return false;
    },
    end() {},
  });
  writeWebResponse(response, res as never);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(cancelled, 1);
});

Deno.test('serve.mjs embeds the bridge verbatim — the twin is single-sourced', () => {
  const code = renderStandaloneServerModule();
  for (const fn of NODE_BRIDGE_EMBEDDED_FUNCTIONS) {
    assertStringIncludes(code, fn.toString(), `serve.mjs must embed ${fn.name} verbatim`);
  }
  assertStringIncludes(code, 'OPEN_ELEMENT_TRUST_PROXY');
  assertStringIncludes(code, 'nodeRequestToWeb(req, { host: hostname, port, trustProxy })');
  assertStringIncludes(code, 'writeWebResponse(response, res, request)');
  // The old collapsing write path must be gone from the generated server.
  assertEquals(code.includes('response.headers.forEach'), false);
});

Deno.test('cli/start.ts uses the shared bridge — no local copy left', async () => {
  const source = await Deno.readTextFile(
    new URL('../src/cli/start.ts', import.meta.url),
  );
  // #1220 M8: the request callback (with its contained-500 wiring) lives in
  // the shared internal/static-serve.ts; start.ts only delegates to it.
  assertStringIncludes(source, 'createStartRequestHandler');
  assertStringIncludes(source, "from '../vite/internal/static-serve.ts'");
  assertStringIncludes(source, "process.env.OPEN_ELEMENT_TRUST_PROXY === '1'");
  assertEquals(source.includes('response.headers.forEach'), false);
  assertEquals(source.includes('function toWebRequest'), false);
  const serveSource = await Deno.readTextFile(
    new URL('../src/vite/internal/static-serve.ts', import.meta.url),
  );
  assertStringIncludes(serveSource, "from './node-bridge.ts'");
  assertStringIncludes(serveSource, 'nodeRequestToWeb(req, {');
  assertStringIncludes(serveSource, 'writeWebResponse(response, res, request)');
});
