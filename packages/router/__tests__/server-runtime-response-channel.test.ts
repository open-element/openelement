/** Response-header merge, protocol header precedence, and CSP nonce behavior. */

import { expect, test } from 'vitest';
import {
  applyCspNonce,
  createCspNonce,
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
