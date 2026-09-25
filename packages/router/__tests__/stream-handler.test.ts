import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  createDeferredDsdExecutor,
  documentStreamParts,
  escapeAttr,
  escapeHtml,
  wrapInDocument,
} from '@openelement/element';
import type { PartProgramV1 } from '../../element/src/internal/protocol/part-program.ts';
import { testProgram } from '../../element/__tests__/compiled-runtime/test-program.ts';
import type { PageRouteDecl, StreamRouteManifest } from '../src/vite/internal/protocol/ssg.ts';
import { renderActionRoute, renderPageRoute } from '../src/vite/internal/ssg/entry-codegen.ts';
import { renderStreamRuntime } from '../src/vite/internal/ssg/entry-stream-runtime.ts';

const program = testProgram({
  tag: 'oe-stream-handler',
  rootMode: 'light',
  template: [{
    k: 'el',
    tag: 'main',
    attrs: [],
    children: [{ k: 'part', index: 0 }, { k: 'part', index: 1 }],
  }],
  parts: [
    { k: 'text', index: 0, signal: 'first' },
    { k: 'text', index: 1, signal: 'second' },
  ],
  properties: ['first', 'second'].map((name) => ({
    name,
    attribute: null,
    type: 'string' as const,
    converter: 'string' as const,
    reflect: false,
    default: '',
  })),
}) as PartProgramV1;

class Page {}
Object.assign(Page, { __partProgram: program, __compiledProperties: program.metadata.properties });

async function manifest(): Promise<StreamRouteManifest> {
  const { sourceMap: _sourceMap, ...wire } = program;
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(wire)),
  );
  return {
    program: {
      version: program.version,
      tag: program.tag,
      sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    },
    fields: ['first', 'second'].map((field, index) => ({
      field,
      signal: field,
      owners: [{ kind: 'part' as const, index, location: `p${index}`, source: {} as never }],
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function handler(timeoutMs?: number, streamManifest?: StreamRouteManifest) {
  const route: PageRouteDecl = {
    kind: 'page',
    path: '/',
    varName: '$Route_Index',
    filePath: 'index.tsx',
    defaultTagName: 'oe-stream-handler',
    tagName: 'oe-stream-handler',
    importPath: '/app/routes/index.tsx',
    streamManifest: streamManifest ?? await manifest(),
  };
  const config = { title: 'Stream', lang: 'en', headExtras: '', allowHeadExtrasScripts: false };
  const lines: string[] = [];
  renderPageRoute(lines, route, [], config, false);
  const post: string[] = [];
  renderActionRoute(post, route, [], config, false);
  assert(!post.join('\n').includes('__streamBody('));
  const source = `
    const { routeModule, manifest, createDeferredDsdExecutor, documentStreamParts,
      escapeAttr, escapeHtml, wrapInDocument } = deps;
    const $Route_Index = routeModule;
    const __streamManifests = { '/': manifest };
    const __pageHandlers = { '/': {} };
    const __asFetchHandler = fn => fn;
    const __bodyLimit = () => () => {};
    const __actionFetchHeader = 'X-OpenElement-Action';
    const __problemJsonMediaType = 'application/problem+json';
    const __isOpenElementRedirect = error => error?.redirect === true;
    const __isOpenElementNotFound = error => error?.notFound === true;
    const __pageDefinition = module => module.default.openElementPage;
    const __routeMeta = () => ({});
    const __resolvePageTag = () => 'oe-stream-handler';
    const __localeFromPath = () => 'en';
    const __getDefaultLocale = () => 'en';
    const __resolvePageDocument = () => ({ title: 'Stream', lang: 'en', links: [] });
    const __pageProps = (_module, context) => context.data;
    const __pageErrorProps = () => ({});
    const __statusHtml = (title, text) => '<h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(text) + '</p>';
    const __clientScriptDescriptors = () => [{ src: '/client.js', type: 'module' }];
    const __resolveAppShell = () => false;
    const __renderAppShell = html => html;
    const __ssr = () => '<p>error</p>';
    function __mergeChannelHeaders(response, channel) {
      const headers = new Headers(response.headers);
      channel.forEach((value, name) => headers.append(name, value));
      return new Response(response.body, { status: response.status, headers });
    }
    async function __createDeferredPageShell(route, module, props, instanceId, documentToken) {
      return createDeferredDsdExecutor({
        componentClass: module.default, props, manifest: __streamManifests[route],
        instanceId, documentToken,
      });
    }
    ${renderStreamRuntime(timeoutMs)}
    ${lines.join('\n').replaceAll('import.meta.env.PROD', 'false')}
    return __pageHandlers['/'].GET[0];
  `;
  const routeModule = {
    default: Object.assign(Page, { openElementPage: { renderIntent: { mode: 'dynamic' } } }),
    loader: (_context: { responseHeaders: Headers; request: Request }): unknown => ({}),
  };
  const generated = new Function('deps', source)({
    routeModule,
    manifest: route.streamManifest,
    createDeferredDsdExecutor,
    documentStreamParts,
    escapeAttr,
    escapeHtml,
    wrapInDocument,
  }) as (context: unknown, route: unknown) => Promise<Response>;
  const fetch = (request: Request) => {
    const headers = new Headers();
    const context = {
      req: { raw: request, path: '/' },
      env: {},
      header: (name: string, value: string) => headers.set(name, value),
      get: (name: string) => name === 'cspNonce' ? 'nonce123' : undefined,
      body: (body: ReadableStream<Uint8Array>, status: number, extra: HeadersInit) =>
        new Response(body, { status, headers: new Headers([...headers, ...new Headers(extra)]) }),
      html: (body: string, status = 200) =>
        new Response(body, { status, headers: new Headers(headers) }),
      redirect: (location: string, status: number) =>
        new Response(null, { status, headers: { Location: location } }),
    };
    return generated(context, { params: {} });
  };
  return { fetch, routeModule };
}

Deno.test('generated GET streams a shell then independent inert Part frames with frozen headers', async () => {
  const { fetch, routeModule } = await handler();
  const first = deferred<string>();
  const second = deferred<string>();
  let held!: Headers;
  routeModule.loader = ({ responseHeaders }: { responseHeaders: Headers }) => {
    held = responseHeaders;
    held.append('Set-Cookie', 'session=abc; HttpOnly');
    return { first: first.promise, second: second.promise };
  };
  const response = await fetch(new Request('https://example.test/'));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('Set-Cookie'), 'session=abc; HttpOnly');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const shell = decoder.decode((await reader.read()).value);
  assertStringIncludes(shell, '<!DOCTYPE html>');
  assertStringIncludes(shell, 'data-oe-stream-request=');
  assertStringIncludes(shell, '<!--oe:p0--><!--oe:/p0-->');
  assertStringIncludes(shell, 'data-oe-seed=');
  assertStringIncludes(shell, '<script nonce="nonce123">');
  assertStringIncludes(shell, 'data-oe-frame');
  assertEquals(shell.indexOf('<script nonce="nonce123">') < shell.indexOf('</head>'), true);
  assert(!shell.includes('</body>'));
  held.set('X-Late', 'discard');
  held.delete('Set-Cookie');
  held.forEach((_value, _name, reference) => reference.append('X-Callback-Late', 'discard'));
  assertEquals(response.headers.get('X-Late'), null);
  assertEquals(response.headers.get('X-Callback-Late'), null);
  assertEquals(response.headers.get('Set-Cookie'), 'session=abc; HttpOnly');
  second.resolve('<script>&');
  const frame2 = decoder.decode((await reader.read()).value);
  assertStringIncludes(frame2, 'data-oe-frame=');
  assertStringIncludes(frame2, 'part&quot;:1');
  assertStringIncludes(frame2, '&lt;script&gt;&amp;');
  assertStringIncludes(frame2, '<noscript>');
  first.resolve('first');
  const frame1 = decoder.decode((await reader.read()).value);
  assertStringIncludes(frame1, 'part&quot;:0');
  assertStringIncludes(frame1, '<noscript>first</noscript>');
  assertStringIncludes(decoder.decode((await reader.read()).value), 'nonce="nonce123"');
  assertEquals((await reader.read()).done, true);
});

Deno.test('generated GET rejects front-gate failures before a success shell', async () => {
  const { fetch, routeModule } = await handler();
  let frontGateSignal!: AbortSignal;
  routeModule.loader = ({ request }: { request: Request }) => {
    frontGateSignal = request.signal;
    return { first: Promise.resolve('a') };
  };
  assertEquals((await fetch(new Request('https://example.test/'))).status, 500);
  assertEquals(frontGateSignal.aborted, true);
  routeModule.loader = () => ({
    first: Promise.resolve('a'),
    second: Promise.resolve('b'),
    unknown: Promise.reject(new Error('not observed by the page')),
  });
  assertEquals((await fetch(new Request('https://example.test/'))).status, 500);
  routeModule.loader = () => {
    throw { redirect: true, location: '/login', status: 302 };
  };
  const redirect = await fetch(new Request('https://example.test/'));
  assertEquals(redirect.status, 302);
  assertEquals(redirect.headers.get('Location'), '/login');
});

Deno.test('generated GET abort and late failure do not turn into successful backfills', async () => {
  const { fetch, routeModule } = await handler();
  const first = deferred<string>();
  const second = deferred<string>();
  let loaderSignal!: AbortSignal;
  routeModule.loader = ({ request }: { request: Request }) => {
    loaderSignal = request.signal;
    return { first: first.promise, second: second.promise };
  };
  const controller = new AbortController();
  const response = await fetch(new Request('https://example.test/', { signal: controller.signal }));
  const reader = response.body!.getReader();
  await reader.read();
  second.reject({ redirect: true, location: '/late', status: 302 });
  const frame = new TextDecoder().decode((await reader.read()).value);
  assertStringIncludes(frame, 'outcome&quot;:&quot;error');
  assertEquals(response.status, 200);
  controller.abort();
  assertEquals(loaderSignal.aborted, true);
  assertEquals((await reader.read()).done, true);
  first.resolve('too late');
  await Promise.resolve();
});

Deno.test('slow reader keeps only settled fields until a pull and cancel ignores late results', async () => {
  const { fetch, routeModule } = await handler();
  const first = deferred<string>();
  const second = deferred<string>();
  let loaderSignal!: AbortSignal;
  routeModule.loader = ({ request }: { request: Request }) => {
    loaderSignal = request.signal;
    return { first: first.promise, second: second.promise };
  };
  const response = await fetch(new Request('https://example.test/'));
  const reader = response.body!.getReader();
  await reader.read();
  first.resolve('one');
  second.resolve('two');
  await Promise.resolve();
  assertEquals((await reader.read()).done, false);
  await reader.cancel();
  assertEquals(loaderSignal.aborted, true);
  assertEquals((await reader.read()).done, true);
});

Deno.test('deferred timeout aborts loader work but emits terminal error frames', async () => {
  const { fetch, routeModule } = await handler(20);
  let loaderSignal!: AbortSignal;
  routeModule.loader = ({ request }: { request: Request }) => {
    loaderSignal = request.signal;
    return {
      first: new Promise<string>(() => {}),
      second: new Promise<string>(() => {}),
    };
  };
  const response = await fetch(new Request('https://example.test/'));
  const reader = response.body!.getReader();
  await reader.read();
  const decoder = new TextDecoder();
  const first = decoder.decode((await reader.read()).value);
  const second = decoder.decode((await reader.read()).value);
  assertEquals(loaderSignal.aborted, true);
  assertStringIncludes(first, 'outcome&quot;:&quot;error');
  assertStringIncludes(second, 'outcome&quot;:&quot;error');
  assertStringIncludes(decoder.decode((await reader.read()).value), '</html>');
  assertEquals((await reader.read()).done, true);
  assertEquals(response.status, 200);
});

Deno.test('late loader success cannot overwrite a queued timeout error for a slow reader', async () => {
  const { fetch, routeModule } = await handler(20);
  const first = deferred<string>();
  const second = deferred<string>();
  let loaderSignal!: AbortSignal;
  routeModule.loader = ({ request }: { request: Request }) => {
    loaderSignal = request.signal;
    return { first: first.promise, second: second.promise };
  };
  const response = await fetch(new Request('https://example.test/'));
  const reader = response.body!.getReader();
  await reader.read();
  first.resolve('settled-before-timeout');
  await Promise.resolve();
  if (!loaderSignal.aborted) {
    await new Promise<void>((resolve) =>
      loaderSignal.addEventListener('abort', () => resolve(), {
        once: true,
      })
    );
  }
  second.resolve('settled-after-timeout');
  await Promise.resolve();
  const decoder = new TextDecoder();
  const onTime = decoder.decode((await reader.read()).value);
  const late = decoder.decode((await reader.read()).value);
  assertStringIncludes(onTime, 'settled-before-timeout');
  assertStringIncludes(onTime, 'outcome&quot;:&quot;content');
  assertStringIncludes(late, 'outcome&quot;:&quot;error');
  assertEquals(late.includes('settled-after-timeout'), false);
  assertStringIncludes(decoder.decode((await reader.read()).value), '</html>');
  assertEquals((await reader.read()).done, true);
});

/** Collect unhandled rejections so an observed-rejection contract can be asserted. */
function unhandledRejectionGuard(): { events: unknown[]; install(): void; restore(): void } {
  const events: unknown[] = [];
  const listener = (event: PromiseRejectionEvent) => {
    events.push(event.reason);
    event.preventDefault();
  };
  return {
    events,
    install: () => globalThis.addEventListener('unhandledrejection', listener),
    restore: () => globalThis.removeEventListener('unhandledrejection', listener),
  };
}

Deno.test('front gate observes every loader rejection when a declared field is missing', async () => {
  const { fetch, routeModule } = await handler();
  const guard = unhandledRejectionGuard();
  guard.install();
  try {
    // 'second' is missing from the loader data, so the front gate throws the
    // missing-declared-field error before the undeclared-thenable scan runs;
    // every rejecting promise here must still be observed or the process dies.
    routeModule.loader = () => ({
      first: Promise.reject(new Error('declared field rejection')),
      stray: Promise.reject(new Error('undeclared stray rejection')),
    });
    assertEquals((await fetch(new Request('https://example.test/'))).status, 500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(guard.events, []);
    // The process survives the front-gate throw and keeps serving requests.
    routeModule.loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });
    assertEquals((await fetch(new Request('https://example.test/'))).status, 200);
  } finally {
    guard.restore();
  }
});

Deno.test('front gate observes every loader rejection when several thenables are undeclared', async () => {
  const { fetch, routeModule } = await handler();
  const guard = unhandledRejectionGuard();
  guard.install();
  try {
    // The undeclared-thenable scan reports only the first offender; the later
    // one must not escape observation when the gate throws.
    routeModule.loader = () => ({
      first: 'a',
      second: 'b',
      ghost1: Promise.reject(new Error('ghost one')),
      ghost2: Promise.reject(new Error('ghost two')),
    });
    assertEquals((await fetch(new Request('https://example.test/'))).status, 500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(guard.events, []);
    routeModule.loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });
    assertEquals((await fetch(new Request('https://example.test/'))).status, 200);
  } finally {
    guard.restore();
  }
});

Deno.test('front gate observes loader rejections when the loader returns a non-object', async () => {
  const { fetch, routeModule } = await handler();
  const guard = unhandledRejectionGuard();
  guard.install();
  try {
    // An array loader fails the one-object shape gate before any per-field
    // observer exists; its rejecting entries must still be observed or the
    // process dies instead of answering 500.
    routeModule.loader = () => [Promise.reject(new Error('array stray rejection'))];
    assertEquals((await fetch(new Request('https://example.test/'))).status, 500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(guard.events, []);
    // The process survives the front-gate throw and keeps serving requests.
    routeModule.loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });
    assertEquals((await fetch(new Request('https://example.test/'))).status, 200);
  } finally {
    guard.restore();
  }
});

Deno.test('front gate answers 500 when the loader itself returns a rejected promise', async () => {
  const { fetch, routeModule } = await handler();
  const guard = unhandledRejectionGuard();
  guard.install();
  try {
    // A bare rejecting promise (no object at all): the generated handler's
    // await consumes the rejection, so no stray unhandled rejection survives
    // and the route still answers 500 instead of crashing.
    routeModule.loader = () => Promise.reject(new Error('loader rejection'));
    assertEquals((await fetch(new Request('https://example.test/'))).status, 500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(guard.events, []);
    // The process survives and keeps serving requests.
    routeModule.loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });
    assertEquals((await fetch(new Request('https://example.test/'))).status, 200);
  } finally {
    guard.restore();
  }
});

Deno.test('stream budget front gate observes loader rejections before its diagnostic throw', async () => {
  // The budget diagnostic fires in __streamFields before the deferred shell is
  // created, so an over-budget manifest alone is enough to reach it through
  // the real generated handler.
  const overBudget: StreamRouteManifest = {
    program: { version: 1, tag: 'oe-stream-handler', sha256: '0'.repeat(64) },
    fields: Array.from({ length: 33 }, (_, index) => ({
      field: `f${index}`,
      signal: `f${index}`,
      owners: [{ kind: 'part' as const, index, location: `p${index}`, source: {} as never }],
    })),
  };
  const { fetch, routeModule } = await handler(undefined, overBudget);
  const guard = unhandledRejectionGuard();
  guard.install();
  try {
    routeModule.loader = () => ({ f0: Promise.reject(new Error('budget stray')) });
    assertEquals((await fetch(new Request('https://example.test/'))).status, 500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(guard.events, [], 'the budget throw observed the loader rejection');
  } finally {
    guard.restore();
  }
});
