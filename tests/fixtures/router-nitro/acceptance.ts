import assert from 'node:assert/strict';

export type FetchLike = (request: Request) => Promise<Response>;
export const NODE_TOKEN = 'fixture-node-token';
export const WORKER_TOKEN = 'fixture-worker-token';

export function asRequest(origin: string, path: string, init: RequestInit = {}): Request {
  return new Request(new URL(path, origin), { redirect: 'manual', ...init });
}

export async function assertIdentity(
  response: Response,
  identity: 'bearer' | 'session' | 'anonymous',
  token: string,
): Promise<void> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-cache');
  assert.equal(response.headers.get('set-cookie'), null);
  const html = await response.text();
  const rendered = html.replaceAll(/<!--oe:\/?t:\d+-->/g, '');
  assert.ok(rendered.includes(`<p id="identity">${identity}</p>`), `Expected identity ${identity}`);
  assert.ok(!html.includes(token), 'Runtime proof token was serialized');
}

interface StaticArtifact {
  path: string;
  html?: string;
}

export async function assertRuntime(
  fetchRuntime: FetchLike,
  origin: string,
  token: string,
  home: StaticArtifact,
  guestbook: StaticArtifact,
): Promise<void> {
  const get = (path: string, init?: RequestInit) => fetchRuntime(asRequest(origin, path, init));
  const post = (path: string, form: Record<string, string>, enhanced = false) =>
    get(path, {
      method: 'POST',
      headers: { origin, ...(enhanced ? { 'x-openelement-action': 'true' } : {}) },
      body: new URLSearchParams(form),
    });

  const checkStatic = async (artifact: StaticArtifact, marker: string) => {
    const response = await get(artifact.path);
    assert.equal(response.status, 200, artifact.path);
    assert.equal(response.headers.get('x-fixture-middleware'), null, artifact.path);
    const html = await response.text();
    assert.ok(html.includes(marker), artifact.path);
    if (artifact.html !== undefined) assert.equal(html, artifact.html, artifact.path);
  };
  await checkStatic(home, 'request-time fixture home');
  await checkStatic(guestbook, 'hybrid guestbook');
  const guestbookHead = await get(guestbook.path, { method: 'HEAD' });
  assert.equal(guestbookHead.status, 200);
  assert.equal(guestbookHead.headers.get('x-fixture-middleware'), null);
  assert.equal(await guestbookHead.text(), '');

  const [first, second] = await Promise.all([
    get('/live?x=nitro-first'),
    get('/live?x=nitro-second'),
  ]);
  const [firstHtml, secondHtml] = await Promise.all([first.text(), second.text()]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-cache');
  assert.match(firstHtml, /x=nitro-first/);
  assert.match(secondHtml, /x=nitro-second/);
  assert.doesNotMatch(secondHtml, /x=nitro-first/);
  assert.match(firstHtml, /src="\/client\/islands\/client\.js"/);
  assert.match(firstHtml, /<live-counter>/);

  const client = await get('/client/islands/client.js');
  assert.equal(client.status, 200);
  assert.match(await client.text(), /open:ready/);
  const marker = await get('/publish-proof.txt');
  assert.equal(marker.status, 200);
  assert.match(await marker.text(), /request-time fixture public marker/);

  const failed = await post('/guestbook', { note: '' });
  assert.equal(failed.status, 422);
  assert.equal(failed.headers.get('cache-control'), 'no-store');
  assert.match(await failed.text(), /note is required/);
  const valid = await post('/guestbook', { note: 'nitro' });
  assert.equal(valid.status, 303);
  assert.equal(valid.headers.get('location'), '/guestbook?posted=nitro');
  assert.equal(valid.headers.get('cache-control'), 'no-store');
  await valid.body?.cancel();
  await checkStatic({ ...guestbook, path: `${guestbook.path}?posted=nitro` }, 'hybrid guestbook');

  const enhanced = await post('/form', { message: '' }, true);
  assert.equal(enhanced.status, 422);
  assert.match(enhanced.headers.get('vary') ?? '', /x-openelement-action/i);
  assert.deepEqual(await enhanced.json(), {
    type: 'failure',
    status: 422,
    data: { error: 'message is required', message: '' },
  });
  const enhancedSuccess = await post('/form', { message: 'nitro' }, true);
  assert.equal(enhancedSuccess.status, 200);
  assert.equal(enhancedSuccess.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await enhancedSuccess.json(), {
    type: 'redirect',
    status: 303,
    location: '/form?echoed=nitro',
  });

  const cookie = await post('/set-header', { mode: 'go' });
  assert.equal(cookie.status, 303);
  assert.equal(cookie.headers.get('location'), '/set-header?done=1');
  assert.equal(cookie.headers.get('cache-control'), 'no-store');
  assert.deepEqual(cookie.headers.getSetCookie(), [
    'oe_session=stub-ok; HttpOnly; Path=/; SameSite=Lax',
  ]);
  await cookie.body?.cancel();
  const samePath = '/set-header?done=1';
  const [session, guest, bearer] = await Promise.all([
    get(samePath, { headers: { cookie: 'oe_session=stub-ok' } }),
    get(samePath),
    get(samePath, { headers: { authorization: `Bearer ${token}` } }),
  ]);
  await assertIdentity(session, 'session', token);
  await assertIdentity(guest, 'anonymous', token);
  await assertIdentity(bearer, 'bearer', token);

  const awaited = await get('/awaited');
  assert.equal(awaited.status, 200);
  const awaitedHtml = await awaited.text();
  assert.match(awaitedHtml, /id="awaited-marker">awaited-settled-value<\/p>/);
  assert.match(awaitedHtml, /id="awaited-prop-marker">awaited-prop-settled-value<\/p>/);
  assert.doesNotMatch(awaitedHtml, /\[object Promise\]/);

  const notFound = await get('/generated-missing');
  assert.equal(notFound.status, 404);
  assert.match(await notFound.text(), /404 Not Found/);
  const error = await get('/generated-boom');
  assert.equal(error.status, 500);
  assert.match(await error.text(), /error projector rendered/);

  for (const path of [
    '/server/index.js',
    '/%73erver/entry.js',
    '/server/index.mjs',
    '/fixture-build-note.txt',
    '/publish-manifest.json',
    '/nitro.json',
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await get(path, { method });
      assert.equal(response.status, 404, `${method} ${path}`);
      await response.body?.cancel();
    }
  }
}

export async function assertTransport(fetchRuntime: FetchLike, origin: string): Promise<void> {
  const stream = await fetchRuntime(asRequest(origin, '/stream'));
  assert.equal(stream.status, 200);
  assert.equal(stream.headers.get('cache-control'), 'private, no-cache');
  assert.match(stream.headers.get('set-cookie') ?? '', /stream-proof=1/);
  assert.match(
    await stream.text(),
    /data-route="stream"><!--oe:p0--><!--oe:\/p0-->.*<template data-oe-transport-proof>Loaded<\/template><noscript>Loaded<\/noscript>/,
  );

  const cached = await fetchRuntime(asRequest(origin, '/cached'));
  assert.equal(cached.status, 200);
  assert.equal(cached.headers.get('x-open-element-cache-intent'), 'host-cache; max-age=60');
  assert.equal(cached.headers.get('cache-control'), 'public, max-age=60, s-maxage=60');
  assert.match(await cached.text(), /data-route="cached"/);
}
