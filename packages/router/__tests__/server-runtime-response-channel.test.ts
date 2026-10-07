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
import { expect, test } from 'vitest';
import {
  applyCspNonce,
  createCspNonce,
  createStreamHeaderChannel,
  isSsgPrerenderDispatch,
  mergeChannelHeaders,
  PROTOCOL_HEADERS,
  SSG_PRERENDER_ENV_KEY,
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

test('PROTOCOL_HEADERS is the ADR-0129 §3 protocol set (lowercase wire names)', () => {
  expect([...PROTOCOL_HEADERS].sort()).toEqual([
    'cache-control',
    'content-type',
    'location',
    'vary',
    'x-openelement-action',
  ]);
});

test('mergeChannelHeaders returns the identical Response when the channel is empty', () => {
  const response = textResponse({ headers: { 'Cache-Control': 'no-store' } });
  expect(mergeChannelHeaders(response, new Headers())).toBe(response);
});

test('mergeChannelHeaders appends channel entries after the framework headers', async () => {
  const response = textResponse({ headers: { 'X-Framework': 'set' } });
  const channel = new Headers({ 'X-Channel': 'from-loader' });
  const merged = mergeChannelHeaders(response, channel);
  // vitest toEqual treats Headers as opaque (std assertEquals walked web
  // types), so the rebuild contract asserts identity + the observable header.
  expect(merged, 'a non-empty channel rebuilds the response').not.toBe(response);
  expect(merged.headers.get('X-Channel')).toEqual('from-loader');
  expect(merged.status).toEqual(200);
  expect(merged.headers.get('X-Framework')).toEqual('set');
  expect(merged.headers.get('X-Channel')).toEqual('from-loader');
  expect(await merged.text(), 'the body is carried over').toEqual('<p>ok</p>');
});

test('mergeChannelHeaders keeps every Set-Cookie entry (multi-value accumulation)', () => {
  const response = textResponse({ headers: { 'Set-Cookie': 'framework=1; Path=/' } });
  const channel = new Headers();
  channel.append('Set-Cookie', 'oe_session=stub-ok; HttpOnly; Path=/; SameSite=Lax');
  channel.append('Set-Cookie', 'oe_csrf=ticket; Path=/');
  const merged = mergeChannelHeaders(response, channel);
  const cookies = merged.headers.getSetCookie();
  expect(cookies.length, 'framework + both channel cookies survive').toEqual(3);
  expect(cookies[0]).toEqual('framework=1; Path=/');
  expect(cookies[1]).toEqual('oe_session=stub-ok; HttpOnly; Path=/; SameSite=Lax');
  expect(cookies[2]).toEqual('oe_csrf=ticket; Path=/');
});

test('mergeChannelHeaders: protocol headers win when the response already set them', () => {
  const response = textResponse({
    headers: {
      Location: '/framework',
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'private, no-cache',
      Vary: 'X-OpenElement-Action',
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
  expect(merged.headers.get('Location')).toEqual('/framework');
  expect(merged.headers.get('Content-Type')).toEqual('text/html; charset=UTF-8');
  expect(merged.headers.get('Cache-Control')).toEqual('private, no-cache');
  expect(merged.headers.get('Vary')).toEqual('X-OpenElement-Action');
  expect(merged.headers.get('X-OpenElement-Action')).toEqual('framework');
});

test('mergeChannelHeaders: a protocol header the response lacks is appended', () => {
  const response = textResponse({ headers: { 'X-Framework': 'set' } });
  const channel = new Headers({ Location: '/from-loader' });
  const merged = mergeChannelHeaders(response, channel);
  expect(merged.headers.get('Location')).toEqual('/from-loader');
  expect(merged.headers.get('X-Framework')).toEqual('set');
});

test('mergeChannelHeaders compares protocol names case-insensitively', () => {
  const response = textResponse({ headers: { LOCATION: '/framework' } });
  const channel = new Headers({ location: '/channel' });
  expect(mergeChannelHeaders(response, channel).headers.get('location')).toEqual('/framework');
});

test('createStreamHeaderChannel: pre-commit mutators pass through, reads stay live', () => {
  const { channel, commit } = createStreamHeaderChannel('/stream');
  channel.append('Set-Cookie', 'session=abc; HttpOnly');
  channel.set('X-Pre', 'yes');
  expect(channel.get('Set-Cookie')).toEqual('session=abc; HttpOnly');
  expect(channel.get('X-Pre')).toEqual('yes');
  expect(channel.has('X-Pre')).toEqual(true);
  commit();
  commit(); // idempotent
  expect(channel.get('Set-Cookie')).toEqual('session=abc; HttpOnly');
});

test('createStreamHeaderChannel: post-commit append/set/delete are warn-and-ignore no-ops', () => {
  const { channel, commit } = createStreamHeaderChannel('/stream');
  channel.append('Set-Cookie', 'session=abc; HttpOnly');
  commit();
  const captured = captureWarn(() => {
    channel.append('Set-Cookie', 'late=1');
    channel.set('X-Late', 'discard');
    channel.delete('Set-Cookie');
  });
  expect(channel.get('Set-Cookie')).toEqual('session=abc; HttpOnly');
  expect(channel.get('X-Late')).toEqual(null);
  expect(captured.length, 'each gated write warns once').toEqual(3);
  for (const entry of captured) {
    expect(entry.message).toEqual('[openElement] late response header write');
  }
  expect(captured[0].payload).toEqual({
    route: '/stream',
    header: 'Set-Cookie',
    operation: 'append',
  });
  expect(captured[2].payload).toEqual({
    route: '/stream',
    header: 'Set-Cookie',
    operation: 'delete',
  });
});

test('createStreamHeaderChannel: forEach hands callbacks the gated proxy', () => {
  const { channel, commit } = createStreamHeaderChannel('/stream');
  channel.append('X-One', '1');
  const seen: Array<[string, string, unknown]> = [];
  channel.forEach((value, name, reference) => {
    seen.push([name, value, reference]);
  });
  expect(seen.length).toEqual(1);
  expect(seen[0][0], 'Headers.forEach iterates normalized (lowercase) names').toEqual('x-one');
  expect(seen[0][1]).toEqual('1');
  // vitest compares Headers opaquely, so the identity contract uses toBe:
  // the forEach reference must be the channel's own (gated) instance.
  expect(seen[0][2], 'the callback receives the channel itself').toBe(channel);
  const gated = seen[0][2] as Headers;
  commit();
  const captured = captureWarn(() => gated.append('X-Late', 'discard'));
  expect(captured.length, 'a reference held through forEach is gated too').toEqual(1);
  expect(channel.get('X-Late')).toEqual(null);
});

test('createStreamHeaderChannel: thisArg flows through forEach', () => {
  const { channel } = createStreamHeaderChannel('/stream');
  channel.append('X-One', '1');
  const receiver = { suffix: '!' };
  let received: unknown;
  channel.forEach(function (this: typeof receiver, _value, _name) {
    received = this.suffix;
  }, receiver);
  expect(received).toEqual('!');
});

test('createCspNonce emits 32 lowercase hex characters (a dash-free UUID)', () => {
  const nonce = createCspNonce();
  expect(nonce.length).toEqual(32);
  expect(/^[0-9a-f]{32}$/.test(nonce), `got ${nonce}`).toEqual(true);
  expect(nonce, 'each request gets a fresh nonce').not.toEqual(createCspNonce());
});

test('applyCspNonce substitutes the placeholder in a generated policy template', () => {
  const template = "default-src 'self'; script-src 'nonce-NONCE_PLACEHOLDER' 'strict-dynamic'";
  expect(applyCspNonce(template, 'abc123')).toEqual(
    "default-src 'self'; script-src 'nonce-abc123' 'strict-dynamic'",
  );
});

test('applyCspNonce appends a script-src when the policy declares none', () => {
  const template = "default-src 'self'; script-src 'nonce-NONCE_PLACEHOLDER'";
  expect(applyCspNonce(template, 'n1').includes("'nonce-n1'")).toBeTruthy();
  // The generated template carries exactly one marker; the substitution is a
  // plain first-occurrence replace (a nonce never contains `$` patterns).
  expect(applyCspNonce('NONCE_PLACEHOLDER and NONCE_PLACEHOLDER', 'n1')).toEqual(
    'n1 and NONCE_PLACEHOLDER',
  );
});

test('isSsgPrerenderDispatch matches exactly the SSG prerender env marker', () => {
  // The static generator dispatches every build-time request with this env
  // ({ [SSG_PRERENDER_ENV_KEY]: true } — one dispatch per page, #1560). The
  // constant is the single source: the build side imports it from here.
  expect(isSsgPrerenderDispatch({ [SSG_PRERENDER_ENV_KEY]: true })).toBeTruthy();
  expect(isSsgPrerenderDispatch({ OPEN_ELEMENT_SSG_CONTEXT: true })).toBeTruthy();
  // Request-time dispatches never carry it: no env, the app's deployment
  // bindings, or any other value must keep the per-request nonce bound.
  expect(isSsgPrerenderDispatch(undefined)).toEqual(false);
  expect(isSsgPrerenderDispatch({})).toEqual(false);
  expect(isSsgPrerenderDispatch({ SOME_DEPLOYMENT_VAR: 'x' })).toEqual(false);
  expect(isSsgPrerenderDispatch({ [SSG_PRERENDER_ENV_KEY]: 'true' })).toEqual(false);
  expect(isSsgPrerenderDispatch({ [SSG_PRERENDER_ENV_KEY]: 1 })).toEqual(false);
  expect(isSsgPrerenderDispatch(SSG_PRERENDER_ENV_KEY)).toEqual(false);
  expect(isSsgPrerenderDispatch(null)).toEqual(false);
});
