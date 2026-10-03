/**
 * Unit tests for @openelement/router/server-runtime action runtime
 * (ADR-0160 rule a, #1470 block c): the request-time action POST protocol
 * the generated entries import instead of carrying emitted function bodies —
 * the same-origin CSRF floor (#611, #921, #938, #1382), named-action
 * dispatch with its own-key gate (#542), the canonical classification
 * (#541), the fetch/native channel fork, the RFC 9457 problem+json error
 * channel (#863, #549), the PRG flow (#548), the default body limit (#568)
 * bound to the S1c policy constant, the ADR-0121 303 coercion, the 500 error
 * mapping (#558), and the internal Hono↔WinterCG bridge.
 *
 * The generated WIRING stays pinned by entry-renderer.test.ts; the
 * end-to-end behavior stays pinned by the read-only request-time-parity
 * oracle on both the dev and the build runtime.
 */
import { expect, test } from 'vitest';
import { fail } from '../src/authoring.ts';
import {
  ACTION_FETCH_HEADER,
  actionErrorResponse,
  actionRedirectResponse,
  createActionBodyLimit,
  createHonoBridge,
  runActionProtocol,
} from '../src/vite/internal/server-runtime/action-runtime.ts';
import type { ActionHonoContext } from '../src/vite/internal/server-runtime/action-runtime.ts';

const PROBLEM_JSON = 'application/problem+json';

/**
 * A minimal Hono-dialect context: responses are real `Response` objects and
 * the `c.header()` writes are folded into them, mirroring how the generated
 * handler's channel merge would carry them out.
 */
function actionContext(options: {
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  env?: Record<string, unknown>;
}): ActionHonoContext {
  const raw = new Request(options.url, {
    method: 'POST',
    headers: options.headers,
    body: options.body === undefined ? undefined : options.body,
  });
  const extra = new Headers();
  return {
    req: {
      url: options.url,
      raw,
      header: (name) => raw.headers.get(name) ?? undefined,
    },
    header: (name, value) => extra.set(name, value),
    get: () => undefined,
    json: (object, status = 200, headers) =>
      // hono's setDefaultContentType: the application/json default yields to
      // an explicitly passed Content-Type (same key, replaced) — mirror it so
      // problem+json responses carry the exact media type.
      new Response(JSON.stringify(object) ?? '', {
        status,
        headers: new Headers({
          'Content-Type': 'application/json',
          ...headers,
          ...Object.fromEntries(extra),
        }),
      }),
    text: (text, status = 200) => new Response(text, { status, headers: new Headers([...extra]) }),
    redirect: (location, status = 302) => {
      extra.set('Location', location);
      return new Response(null, { status, headers: new Headers([...extra]) });
    },
    res: new Response(null),
  };
}

function statusPage(title: string, message: string, status: number): Response {
  return new Response(`${title}|${message}`, { status });
}

function formPost(options: {
  path?: string;
  origin?: string;
  fetchHeader?: boolean;
  contentType?: string;
  accept?: string;
  upgradeInsecureRequests?: string;
  secFetchSite?: string;
  env?: Record<string, unknown>;
  body?: string;
}): { context: ActionHonoContext; state: { isFetch: boolean } } {
  const headers: Record<string, string> = {
    'content-type': options.contentType ?? 'application/x-www-form-urlencoded',
  };
  if (options.origin !== undefined) headers['origin'] = options.origin;
  if (options.fetchHeader) headers[ACTION_FETCH_HEADER] = 'true';
  if (options.accept !== undefined) headers['accept'] = options.accept;
  if (options.upgradeInsecureRequests !== undefined) {
    headers['upgrade-insecure-requests'] = options.upgradeInsecureRequests;
  }
  if (options.secFetchSite !== undefined) headers['sec-fetch-site'] = options.secFetchSite;
  const context = actionContext({
    url: `https://pages.example.test${options.path ?? '/form'}`,
    headers,
    body: options.body ?? 'message=hello',
    env: options.env,
  });
  return { context, state: { isFetch: false } };
}

test('named action dispatch answers success with PRG 303, marker stripped, search kept', async () => {
  const { context, state } = formPost({
    path: '/form?/save&keep=1',
    origin: 'https://pages.example.test',
  });
  const execution = await runActionProtocol(
    context,
    { actions: { save: () => ({ ok: true }) } },
    { env: {} },
    statusPage,
    state,
  );
  expect(state.isFetch).toEqual(false);
  expect(execution.response, 'success answers a PRG response').toBeTruthy();
  expect(execution.response.status).toEqual(303);
  expect(execution.response.headers.get('Location')).toEqual('/form?keep=1');
});

test('the bare `action` export dispatches when no ?/name is present', async () => {
  const { context, state } = formPost({ origin: 'https://pages.example.test' });
  const execution = await runActionProtocol(
    context,
    { action: () => 'ok' },
    { env: {} },
    statusPage,
    state,
  );
  expect(execution.response?.status).toEqual(303);
});

test('fail() re-render channel: native callers receive the classified outcome at 422', async () => {
  const { context, state } = formPost({ origin: 'https://pages.example.test' });
  const execution = await runActionProtocol(
    context,
    { action: () => fail(422, { message: 'message is required' }) },
    { env: {} },
    statusPage,
    state,
  );
  expect(execution.response).toEqual(undefined);
  expect(execution.actionResult).toEqual({
    kind: 'failure',
    status: 422,
    data: { message: 'message is required' },
  });
});

test('fail() fetch channel answers the ActionResult JSON with degraded unserializable data', async () => {
  for (const data of [
    undefined,
    () => 'nope',
    Symbol('sym'),
    1n,
    (() => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      return circular;
    })(),
  ]) {
    const { context, state } = formPost({
      origin: 'https://pages.example.test',
      fetchHeader: true,
    });
    const execution = await runActionProtocol(
      context,
      { action: () => fail(422, data) },
      { env: {} },
      statusPage,
      state,
    );
    const response = execution.response!;
    expect(response.status, 'the author status survives the fetch channel').toEqual(422);
    expect(response.headers.get('Content-Type')).toEqual('application/json');
    expect(await response.json()).toEqual({ type: 'failure', status: 422, data: null });
  }
});

test('fail() fetch channel keeps serializable data intact', async () => {
  const { context, state } = formPost({
    origin: 'https://pages.example.test',
    fetchHeader: true,
  });
  const execution = await runActionProtocol(
    context,
    { action: () => fail(422, { message: 'echo' }) },
    { env: {} },
    statusPage,
    state,
  );
  expect(await execution.response!.json()).toEqual({
    type: 'failure',
    status: 422,
    data: { message: 'echo' },
  });
});

test('unknown named action: fetch callers get problem+json 404, native callers the status page', async () => {
  const fetchPost = formPost({
    path: '/form?/nope',
    origin: 'https://pages.example.test',
    fetchHeader: true,
  });
  const fetchExecution = await runActionProtocol(
    fetchPost.context,
    { actions: { save: () => 'ok' } },
    { env: {} },
    statusPage,
    fetchPost.state,
  );
  const problem = fetchExecution.response!;
  expect(problem.status).toEqual(404);
  expect(problem.headers.get('Content-Type')).toEqual(PROBLEM_JSON);
  expect(await problem.json()).toEqual({
    type: 'about:blank',
    title: 'Not Found',
    status: 404,
    detail: 'No action named "nope" on this route.',
  });

  const nativePost = formPost({ path: '/form?/nope', origin: 'https://pages.example.test' });
  const nativeExecution = await runActionProtocol(
    nativePost.context,
    { actions: { save: () => 'ok' } },
    { env: {} },
    statusPage,
    nativePost.state,
  );
  expect(nativeExecution.response!.status).toEqual(404);
  expect(await nativeExecution.response!.text()).toContain('404 Not Found|');
});

test('prototype-chain action names are not dispatchable (#542)', async () => {
  const { context, state } = formPost({
    path: '/form?/constructor',
    origin: 'https://pages.example.test',
    fetchHeader: true,
  });
  const execution = await runActionProtocol(
    context,
    { actions: { save: () => 'ok' } },
    { env: {} },
    statusPage,
    state,
  );
  expect(execution.response!.status).toEqual(404);
});

test('a route without any action export is a defined 404, not a render', async () => {
  const { context, state } = formPost({
    origin: 'https://pages.example.test',
    fetchHeader: true,
  });
  const execution = await runActionProtocol(context, {}, { env: {} }, statusPage, state);
  expect(await execution.response!.json()).toEqual({
    type: 'about:blank',
    title: 'Not Found',
    status: 404,
    detail: 'This route does not accept submissions.',
  });
});

test('the CSRF floor rejects cross-site posts: problem+json on fetch, plain text native (#611)', async () => {
  const fetchPost = formPost({
    origin: 'https://evil.example',
    fetchHeader: true,
  });
  const fetchExecution = await runActionProtocol(
    fetchPost.context,
    { action: () => 'ok' },
    { env: {} },
    statusPage,
    fetchPost.state,
  );
  const problem = fetchExecution.response!;
  expect(problem.status).toEqual(403);
  expect(problem.headers.get('Content-Type')).toEqual(PROBLEM_JSON);
  expect(await problem.json()).toEqual({
    type: 'about:blank',
    title: 'Forbidden',
    status: 403,
    detail: 'Cross-site form submission rejected',
  });

  const nativePost = formPost({ origin: 'https://evil.example' });
  const nativeExecution = await runActionProtocol(
    nativePost.context,
    { action: () => 'ok' },
    { env: {} },
    statusPage,
    nativePost.state,
  );
  expect(nativeExecution.response!.status).toEqual(403);
  expect(await nativeExecution.response!.text()).toEqual('Forbidden');
});

test('OPEN_ELEMENT_DISABLE_CSRF=1 turns the floor off', async () => {
  const { context, state } = formPost({
    origin: 'https://evil.example',
    fetchHeader: true,
    env: { OPEN_ELEMENT_DISABLE_CSRF: '1' },
  });
  const execution = await runActionProtocol(
    context,
    { action: () => 'ok' },
    { env: { OPEN_ELEMENT_DISABLE_CSRF: '1' } },
    statusPage,
    state,
  );
  // The fetch redirect outcome rides HTTP 200 with the 303 in the ActionResult
  // body (the shape the request-time-parity oracle pins).
  expect(await execution.response!.json()).toEqual({
    type: 'redirect',
    status: 303,
    location: '/form',
  });
});

test('same-origin posts pass; the http loopback allowance covers host variety (#921)', async () => {
  const raw = new Request('http://127.0.0.1:8000/form', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'http://localhost:3000',
    },
    body: 'message=hello',
  });
  const context: ActionHonoContext = {
    req: { url: raw.url, raw, header: (name) => raw.headers.get(name) ?? undefined },
    header: () => {},
    get: () => undefined,
    json: (object, status = 200) => new Response(JSON.stringify(object), { status }),
    text: (text, status = 200) => new Response(text, { status }),
    redirect: (location, status = 302) =>
      new Response(null, { status, headers: { Location: location } }),
    res: new Response(null),
  };
  const execution = await runActionProtocol(
    context,
    { action: () => 'ok' },
    { env: {} },
    statusPage,
    { isFetch: false },
  );
  expect(execution.response!.status).toEqual(303);
});

test('an Origin of literal null is the no-referrer case and is allowed (#938)', async () => {
  const { context, state } = formPost({
    origin: 'null',
    fetchHeader: true,
  });
  const execution = await runActionProtocol(
    context,
    { action: () => 'ok' },
    { env: {} },
    statusPage,
    state,
  );
  expect((await execution.response!.json()).status).toEqual(303);
});

test('same-site Fetch Metadata without a matching origin fails closed', async () => {
  const { context, state } = formPost({
    fetchHeader: true,
    secFetchSite: 'same-site',
  });
  const execution = await runActionProtocol(
    context,
    { action: () => 'ok' },
    { env: {} },
    statusPage,
    state,
  );
  expect(execution.response!.status).toEqual(403);
});

test('browser-shaped form body without Origin or Fetch Metadata fails closed (#1382)', async () => {
  for (const evidence of [
    { upgradeInsecureRequests: '1' },
    { accept: 'text/html,application/xhtml+xml' },
  ]) {
    const { context, state } = formPost({ fetchHeader: true, ...evidence });
    const execution = await runActionProtocol(
      context,
      { action: () => 'ok' },
      { env: {} },
      statusPage,
      state,
    );
    expect(execution.response!.status).toEqual(403);
  }
});

test('an unparseable body answers 400 per channel', async () => {
  const fetchPost = formPost({
    origin: 'https://pages.example.test',
    fetchHeader: true,
    contentType: 'text/plain',
    body: 'not a form',
  });
  const fetchExecution = await runActionProtocol(
    fetchPost.context,
    { action: () => 'ok' },
    { env: {} },
    statusPage,
    fetchPost.state,
  );
  const problem = fetchExecution.response!;
  expect(problem.status).toEqual(400);
  expect(problem.headers.get('Content-Type')).toEqual(PROBLEM_JSON);
  expect((await problem.json()).detail).toEqual('Could not parse the form body.');

  const nativePost = formPost({
    origin: 'https://pages.example.test',
    contentType: 'text/plain',
    body: 'not a form',
  });
  const nativeExecution = await runActionProtocol(
    nativePost.context,
    { action: () => 'ok' },
    { env: {} },
    statusPage,
    nativePost.state,
  );
  expect(nativeExecution.response!.status).toEqual(400);
});

test('the fetch redirect outcome is the ActionResult shape, not a 303 document (#548)', async () => {
  const { context, state } = formPost({
    path: '/form?/save',
    origin: 'https://pages.example.test',
    fetchHeader: true,
  });
  const execution = await runActionProtocol(
    context,
    { actions: { save: () => 'ok' } },
    { env: {} },
    statusPage,
    state,
  );
  expect(state.isFetch).toEqual(true);
  expect(await execution.response!.json()).toEqual({
    type: 'redirect',
    status: 303,
    location: '/form',
  });
});

test('actionRedirectResponse: native 303, fetch HTTP 200 with the ActionResult body (ADR-0121)', async () => {
  const context = actionContext({ url: 'https://pages.example.test/form' });
  const native = actionRedirectResponse(context, '/elsewhere', false);
  expect(native.status).toEqual(303);
  expect(native.headers.get('Location')).toEqual('/elsewhere');

  // The serialized client executor matches on the body, not the HTTP status:
  // the fetch channel answers 200 with the 303 carried in the redirect shape.
  const fetchResponse = actionRedirectResponse(context, '/elsewhere', true);
  expect(fetchResponse.status).toEqual(200);
  expect(await fetchResponse.json()).toEqual({
    type: 'redirect',
    status: 303,
    location: '/elsewhere',
  });
});

test('actionErrorResponse answers problem+json 500 and scrubs internals in production (#558)', () => {
  const capture: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    capture.push(args);
  };
  try {
    const dev = actionErrorResponse(
      actionContext({ url: 'https://pages.example.test/form' }),
      '/form',
      new Error('secret stack detail'),
      false,
    );
    expect(dev.status).toEqual(500);
    expect(dev.headers.get('Content-Type')).toEqual(PROBLEM_JSON);

    const production = actionErrorResponse(
      actionContext({ url: 'https://pages.example.test/form' }),
      '/form',
      new Error('secret stack detail'),
      true,
    );
    expect(production.status).toEqual(500);
  } finally {
    console.error = originalError;
  }
  expect(capture.length).toEqual(2);
  expect(capture[0][0]).toEqual('[openElement] Action POST failed for /form:');
});

test('createActionBodyLimit answers an oversized body per channel (#568)', async () => {
  const limit = createActionBodyLimit(1024);

  // An oversized body: the fetch channel speaks problem+json with the
  // negotiation headers; the native channel keeps plain text. The negotiation
  // headers must ride the response the way the generated handler's channel
  // merge would carry them out.
  async function oversize(fetchHeader: boolean): Promise<Response> {
    const headers: Record<string, string> = {};
    if (fetchHeader) headers[ACTION_FETCH_HEADER] = 'true';
    const raw = new Request('https://pages.example.test/form', {
      method: 'POST',
      headers,
      body: new Uint8Array(2048),
    });
    const extra = new Headers();
    const context = {
      req: { raw, header: (name: string) => raw.headers.get(name) ?? undefined },
      header: (name: string, value: string) => extra.set(name, value),
      json: (object: unknown, status = 200, responseHeaders?: Record<string, string>) =>
        new Response(JSON.stringify(object), {
          status,
          headers: new Headers({ ...Object.fromEntries(extra), ...responseHeaders }),
        }),
      text: (text: string, status = 200) =>
        new Response(text, { status, headers: new Headers([...extra]) }),
    };
    const response = await (limit as (c: unknown, next: () => Promise<void>) => Promise<unknown>)(
      context,
      () => {
        throw new Error('next() must not run past an oversized body');
      },
    );
    return response as Response;
  }

  const problem = await oversize(true);
  expect(problem.status).toEqual(413);
  expect(problem.headers.get('Content-Type')).toEqual(PROBLEM_JSON);
  expect(problem.headers.get('Cache-Control')).toEqual('no-store');
  expect(problem.headers.get('Vary')).toEqual(ACTION_FETCH_HEADER);
  expect((await problem.json()).detail).toEqual(
    'The request body exceeded the 10 MiB action limit.',
  );

  const plain = await oversize(false);
  expect(plain.status).toEqual(413);
  expect(await plain.text()).toEqual('Payload Too Large');
});

test('createActionBodyLimit passes an under-limit body through to next()', async () => {
  const limit = createActionBodyLimit(1024);
  const raw = new Request('https://pages.example.test/form', {
    method: 'POST',
    headers: { 'content-length': '10' },
    body: 'message=ok',
  });
  let reachedNext = false;
  await (limit as (c: unknown, next: () => unknown) => Promise<unknown>)({ req: { raw } }, () => {
    reachedNext = true;
  });
  expect(reachedNext).toEqual(true);
});

test('the Hono bridge binds contexts by request identity', async () => {
  const bridge = createHonoBridge();
  const request = new Request('https://pages.example.test/');
  const context = actionContext({ url: request.url });
  bridge.contexts.set(request, context);

  const handled: unknown[] = [];
  const handler = bridge.asFetchHandler((c, route) => {
    handled.push(c, route);
    return new Response('handled');
  });
  const response = await handler(request, { params: {} }, () => undefined);
  expect(await (response as Response).text()).toEqual('handled');
  expect(handled[0]).toEqual(context);
  expect(handled[1]).toEqual({ params: {} });
});

test('the Hono bridge middleware keeps onion order and the response fallbacks', async () => {
  const bridge = createHonoBridge();
  const request = new Request('https://pages.example.test/');
  const context = actionContext({ url: request.url });
  bridge.contexts.set(request, context);

  // A middleware that returns its own response wins over the downstream one.
  const own = bridge.asFetchMiddleware((c, next) => {
    expect(c === context).toBeTruthy();
    void next();
    return new Response('own');
  });
  expect(
    await ((await own(request, {}, () => new Response('downstream'))) as Response).text(),
  ).toEqual('own');

  // A pass-through middleware falls back to the downstream response, then to
  // the context's own response.
  const pass = bridge.asFetchMiddleware((_c, next) => next());
  expect(
    await ((await pass(request, {}, () => new Response('downstream'))) as Response).text(),
  ).toEqual('downstream');
  const fallback = (await pass(request, {}, () => undefined)) as Response;
  expect(fallback).toEqual(context.res);
});
