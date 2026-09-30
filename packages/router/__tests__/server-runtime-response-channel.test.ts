/**
 * Unit tests for @openelement/router/server-runtime response channel
 * (ADR-0160 rule a, #1470 block a): the request-time runtime semantics that
 * generated entries import instead of carrying emitted function bodies —
 * header commitment, the late-mutation Proxy guard, the Set-Cookie
 * channel merge, protocol-header precedence (ADR-0129 §3), and the CSP
 * auto-nonce (ADR-0158 commitment list).
 *
 * The end-to-end behavior stays pinned by the read-only oracles
 * (request-time-parity, stream-manifest) and by stream-handler.test.ts,
 * which drives the real generated handler against this module.
 */
import { assert, assertEquals, assertNotEquals, assertStrictEquals } from '@std/assert';
import {
  applyCspNonce,
  createCspNonce,
  createStreamHeaderChannel,
  isSsgPrerenderDispatch,
  mergeChannelHeaders,
  PROTOCOL_HEADERS,
} from '../src/vite/internal/server-runtime/response-channel.ts';

function textResponse(init?: { headers?: HeadersInit; status?: number }): Response {
  return new Response('<p>ok</p>', {
    status: init?.status ?? 200,
    headers: init?.headers,
  });
}

/** Run fn with console.warn captured; returns the captured payloads. */
function captureWarn(fn: () => void): Array<{ message: string; payload: unknown }> {
  const captured: Array<{ message: string; payload: unknown }> = [];
  const original = console.warn;
  console.warn = (msg?: unknown, ...args: unknown[]) => {
    captured.push({ message: String(msg), payload: args[0] });
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return captured;
}

Deno.test('PROTOCOL_HEADERS is the ADR-0129 §3 protocol set (lowercase wire names)', () => {
  assertEquals(
    [...PROTOCOL_HEADERS].sort(),
    ['cache-control', 'content-type', 'location', 'vary', 'x-openelement-action'],
  );
});

Deno.test('mergeChannelHeaders returns the identical Response when the channel is empty', () => {
  const response = textResponse({ headers: { 'Cache-Control': 'no-store' } });
  assertStrictEquals(mergeChannelHeaders(response, new Headers()), response);
});

Deno.test('mergeChannelHeaders appends channel entries after the framework headers', async () => {
  const response = textResponse({ headers: { 'X-Framework': 'set' } });
  const channel = new Headers({ 'X-Channel': 'from-loader' });
  const merged = mergeChannelHeaders(response, channel);
  assertNotEquals(merged, response, 'a non-empty channel rebuilds the response');
  assertEquals(merged.status, 200);
  assertEquals(merged.headers.get('X-Framework'), 'set');
  assertEquals(merged.headers.get('X-Channel'), 'from-loader');
  assertEquals(await merged.text(), '<p>ok</p>', 'the body is carried over');
});

Deno.test('mergeChannelHeaders keeps every Set-Cookie entry (multi-value accumulation)', () => {
  const response = textResponse({ headers: { 'Set-Cookie': 'framework=1; Path=/' } });
  const channel = new Headers();
  channel.append('Set-Cookie', 'oe_session=stub-ok; HttpOnly; Path=/; SameSite=Lax');
  channel.append('Set-Cookie', 'oe_csrf=ticket; Path=/');
  const merged = mergeChannelHeaders(response, channel);
  const cookies = merged.headers.getSetCookie();
  assertEquals(cookies.length, 3, 'framework + both channel cookies survive');
  assertEquals(cookies[0], 'framework=1; Path=/');
  assertEquals(cookies[1], 'oe_session=stub-ok; HttpOnly; Path=/; SameSite=Lax');
  assertEquals(cookies[2], 'oe_csrf=ticket; Path=/');
});

Deno.test('mergeChannelHeaders: protocol headers win when the response already set them', () => {
  const response = textResponse({
    headers: {
      'Location': '/framework',
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'private, no-cache',
      'Vary': 'X-OpenElement-Action',
      'X-OpenElement-Action': 'framework',
    },
  });
  const channel = new Headers();
  channel.append('Location', '/channel');
  channel.append('Content-Type', 'application/json');
  channel.append('Cache-Control', 'public, max-age=600');
  channel.append('Vary', '*');
  channel.append('X-OpenElement-Action', 'channel');
  const merged = mergeChannelHeaders(response, channel);
  assertEquals(merged.headers.get('Location'), '/framework');
  assertEquals(merged.headers.get('Content-Type'), 'text/html; charset=UTF-8');
  assertEquals(merged.headers.get('Cache-Control'), 'private, no-cache');
  assertEquals(merged.headers.get('Vary'), 'X-OpenElement-Action');
  assertEquals(merged.headers.get('X-OpenElement-Action'), 'framework');
});

Deno.test('mergeChannelHeaders: a protocol header the response lacks is appended', () => {
  const response = textResponse({ headers: { 'X-Framework': 'set' } });
  const channel = new Headers({ Location: '/from-loader' });
  const merged = mergeChannelHeaders(response, channel);
  assertEquals(merged.headers.get('Location'), '/from-loader');
  assertEquals(merged.headers.get('X-Framework'), 'set');
});

Deno.test('mergeChannelHeaders compares protocol names case-insensitively', () => {
  const response = textResponse({ headers: { 'LOCATION': '/framework' } });
  const channel = new Headers({ location: '/channel' });
  assertEquals(mergeChannelHeaders(response, channel).headers.get('location'), '/framework');
});

Deno.test('createStreamHeaderChannel: pre-commit mutators pass through, reads stay live', () => {
  const { channel, commit } = createStreamHeaderChannel('/stream');
  channel.append('Set-Cookie', 'session=abc; HttpOnly');
  channel.set('X-Pre', 'yes');
  assertEquals(channel.get('Set-Cookie'), 'session=abc; HttpOnly');
  assertEquals(channel.get('X-Pre'), 'yes');
  assertEquals(channel.has('X-Pre'), true);
  commit();
  commit(); // idempotent
  assertEquals(channel.get('Set-Cookie'), 'session=abc; HttpOnly');
});

Deno.test('createStreamHeaderChannel: post-commit append/set/delete are warn-and-ignore no-ops', () => {
  const { channel, commit } = createStreamHeaderChannel('/stream');
  channel.append('Set-Cookie', 'session=abc; HttpOnly');
  commit();
  const captured = captureWarn(() => {
    channel.append('Set-Cookie', 'late=1');
    channel.set('X-Late', 'discard');
    channel.delete('Set-Cookie');
  });
  assertEquals(channel.get('Set-Cookie'), 'session=abc; HttpOnly');
  assertEquals(channel.get('X-Late'), null);
  assertEquals(captured.length, 3, 'each gated write warns once');
  for (const entry of captured) {
    assertEquals(entry.message, '[openElement] late response header write');
  }
  assertEquals(captured[0].payload, {
    route: '/stream',
    header: 'Set-Cookie',
    operation: 'append',
  });
  assertEquals(captured[2].payload, {
    route: '/stream',
    header: 'Set-Cookie',
    operation: 'delete',
  });
});

Deno.test('createStreamHeaderChannel: forEach hands callbacks the gated proxy', () => {
  const { channel, commit } = createStreamHeaderChannel('/stream');
  channel.append('X-One', '1');
  const seen: Array<[string, string, unknown]> = [];
  channel.forEach((value, name, reference) => {
    seen.push([name, value, reference]);
  });
  assertEquals(seen.length, 1);
  assertEquals(seen[0][0], 'x-one', 'Headers.forEach iterates normalized (lowercase) names');
  assertEquals(seen[0][1], '1');
  assertEquals(seen[0][2], channel, 'the callback receives the channel itself');
  const gated = seen[0][2] as Headers;
  commit();
  const captured = captureWarn(() => gated.append('X-Late', 'discard'));
  assertEquals(captured.length, 1, 'a reference held through forEach is gated too');
  assertEquals(channel.get('X-Late'), null);
});

Deno.test('createStreamHeaderChannel: thisArg flows through forEach', () => {
  const { channel } = createStreamHeaderChannel('/stream');
  channel.append('X-One', '1');
  const receiver = { suffix: '!' };
  let received: unknown;
  channel.forEach(function (this: typeof receiver, _value, _name) {
    received = this.suffix;
  }, receiver);
  assertEquals(received, '!');
});

Deno.test('createCspNonce emits 32 lowercase hex characters (a dash-free UUID)', () => {
  const nonce = createCspNonce();
  assertEquals(nonce.length, 32);
  assertEquals(/^[0-9a-f]{32}$/.test(nonce), true, `got ${nonce}`);
  assertNotEquals(nonce, createCspNonce(), 'each request gets a fresh nonce');
});

Deno.test('applyCspNonce substitutes the placeholder in a generated policy template', () => {
  const template = "default-src 'self'; script-src 'nonce-NONCE_PLACEHOLDER' 'strict-dynamic'";
  assertEquals(
    applyCspNonce(template, 'abc123'),
    "default-src 'self'; script-src 'nonce-abc123' 'strict-dynamic'",
  );
});

Deno.test('applyCspNonce appends a script-src when the policy declares none', () => {
  const template = "default-src 'self'; script-src 'nonce-NONCE_PLACEHOLDER'";
  assert(applyCspNonce(template, 'n1').includes("'nonce-n1'"));
  // The generated template carries exactly one marker; the substitution is a
  // plain first-occurrence replace (a nonce never contains `$` patterns).
  assertEquals(
    applyCspNonce('NONCE_PLACEHOLDER and NONCE_PLACEHOLDER', 'n1'),
    'n1 and NONCE_PLACEHOLDER',
  );
});

Deno.test('isSsgPrerenderDispatch matches exactly the hono/ssg env marker', () => {
  // hono/ssg dispatches every build-time request with this env (ssg.js
  // passes `{ [SSG_CONTEXT]: true }` — the probe and every page render).
  assert(isSsgPrerenderDispatch({ HONO_SSG_CONTEXT: true }));
  // Request-time dispatches never carry it: no env, the app's deployment
  // bindings, or any other value must keep the per-request nonce bound.
  assertEquals(isSsgPrerenderDispatch(undefined), false);
  assertEquals(isSsgPrerenderDispatch({}), false);
  assertEquals(isSsgPrerenderDispatch({ SOME_DEPLOYMENT_VAR: 'x' }), false);
  assertEquals(isSsgPrerenderDispatch({ HONO_SSG_CONTEXT: 'true' }), false);
  assertEquals(isSsgPrerenderDispatch({ HONO_SSG_CONTEXT: 1 }), false);
  assertEquals(isSsgPrerenderDispatch('HONO_SSG_CONTEXT'), false);
  assertEquals(isSsgPrerenderDispatch(null), false);
});
