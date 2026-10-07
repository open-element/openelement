import process from 'node:process';
import { expect, test } from 'vitest';
import {
  createDeferredDsdExecutor,
  documentStreamParts,
  escapeAttr,
  escapeHtml,
  MAX_ACTION_BODY_BYTES,
  wrapInDocument,
} from '@openelement/element';
import type { PartProgramV1 } from '../../element/src/internal/protocol/part-program.ts';
import { testProgram } from '../../element/__tests__/compiled-runtime/test-program.ts';
import {
  ACTION_FETCH_HEADER,
  createActionBodyLimit,
} from '../src/vite/internal/server-runtime/action-runtime.ts';
import { createRequestScope } from '../src/vite/internal/server-runtime/wintercg.ts';
import type { OpenElementRequestScope } from '../src/vite/internal/server-runtime/wintercg.ts';
import {
  createStreamHeaderChannel,
  mergeChannelHeaders,
} from '../src/vite/internal/server-runtime/response-channel.ts';
import {
  createDeferredPageShell,
  createStreamBody,
  createStreamRequestScope,
  STREAM_BROWSER_BOOTSTRAP,
  streamFields,
} from '../src/vite/internal/server-runtime/stream-runtime.ts';
import type { PageRouteDecl, StreamRouteManifest } from '@openelement/protocol/ssg';
import { renderActionRoute, renderPageRoute } from '../src/vite/internal/ssg/entry-codegen.ts';

const program = testProgram({
  tag: 'oe-stream-handler',
  rootMode: 'light',
  template: [
    {
      k: 'el',
      tag: 'main',
      attrs: [],
      children: [
        { k: 'part', index: 0 },
        { k: 'part', index: 1 },
      ],
    },
  ],
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
      sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
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

/**
 * The generated handler calls the response-header channel and the streaming
 * pump by name (`__mergeChannelHeaders`, `__streamHeaderChannel`,
 * `__streamRequestScope`, `__streamFields`, `__streamBody`); since ADR-0160
 * rule a those names bind to `@openelement/router/server-runtime` imports at
 * the top of the generated entry. A `new Function` harness cannot carry
 * import declarations, so the REAL production implementations are bound in
 * through `deps` instead — the assertions below still execute the shipped
 * modules, never a harness-local copy. The deferred-shell gate binds the same
 * way since ADR-0160 Amendment 1 (the typed `createDeferredPageShell` factory
 * over the serialized manifests + the real executor import), so the gate runs
 * as shipped too. The action POST wiring never executes here (only the GET
 * handler is driven), but the harness binds the real scope/body-limit so the
 * composed source matches the shipped entry.
 */
async function handler(timeoutMs?: number, streamManifest?: StreamRouteManifest) {
  const route: PageRouteDecl = {
    kind: 'page',
    path: '/',
    varName: '$Route_Index',
    filePath: 'index.tsx',
    defaultTagName: 'oe-stream-handler',
    tagName: 'oe-stream-handler',
    importPath: '/app/routes/index.tsx',
    streamManifest: streamManifest ?? (await manifest()),
  };
  const config = { title: 'Stream', lang: 'en', headExtras: '', allowHeadExtrasScripts: false };
  const lines: string[] = [];
  renderPageRoute(lines, route, [], config, false);
  const post: string[] = [];
  renderActionRoute(post, route, [], config, false);
  expect(!post.join('\n').includes('__streamBody(')).toBeTruthy();
  const source = `
    const { routeModule, manifest, createDeferredDsdExecutor, documentStreamParts,
      escapeAttr, escapeHtml, wrapInDocument } = deps;
    const __mergeChannelHeaders = deps.mergeChannelHeaders;
    const __streamHeaderChannel = deps.createStreamHeaderChannel;
    const __streamRequestScope = deps.createStreamRequestScope;
    const __streamFields = deps.streamFields;
    const __streamBody = deps.createStreamBody({ escapeAttr, timeoutMs: deps.timeoutMs });
    const __streamBrowserBootstrap = deps.streamBrowserBootstrap;
    const __requestScope = deps.requestScope;
    const __actionBodyLimit = deps.createActionBodyLimit(deps.maxActionBodyBytes);
    const __actionFetchHeader = deps.ACTION_FETCH_HEADER;
    const $Route_Index = routeModule;
    const __streamManifests = { '/': manifest };
    const __createDeferredPageShell = deps.createDeferredPageShell({
      streamManifests: __streamManifests,
      createDeferredDsdExecutor,
    });
    const __pageHandlers = { '/': {} };
    const __isOpenElementRedirect = error => error?.redirect === true;
    const __isOpenElementNotFound = error => error?.notFound === true;
    const __pageDefinition = module => module.default.openElementPage;
    const __routeMeta = () => ({});
    const __resolvePageTag = () => 'oe-stream-handler';
    const __locales = [];
    const __localeFromPath = () => 'en';
    const __getDefaultLocale = () => 'en';
    // Faithful to resolvePageDocument's #1471 signature: the render wiring's
    // client-script descriptors ride the resolved document.
    const __resolvePageDocument = (_head, _context, clientScripts) => ({
      title: 'Stream',
      lang: 'en',
      links: [],
      ...(clientScripts && clientScripts.length > 0 ? { clientScripts } : {}),
    });
    const __pageProps = (_module, context) => context.data;
    const __pageErrorProps = () => ({});
    const __statusHtml = (title, text) => '<h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(text) + '</p>';
    const __clientScriptDescriptors = () => [{ src: '/client.js', type: 'module' }];
    const __resolveAppShell = () => deps.resolvedAppShell ?? false;
    const __renderAppShell = html => html;
    const __ssr = () => '<p>error</p>';
    ${lines.join('\n').replaceAll('import.meta.env.PROD', 'false')}
    return __pageHandlers['/'].GET[0];
  `;
  const routeModule = {
    default: Object.assign(Page, { openElementPage: { renderIntent: { mode: 'dynamic' } } }),
    loader: (_context: { responseHeaders: Headers; request: Request }): unknown => ({}),
  };
  // The generated handler binds `c` through the request-scope accessor the
  // factory hands the entry (#1560). The harness mirrors the production
  // binding one-to-one: one scope per request, seeded with the CSP nonce the
  // generated wiring reads.
  const scopes = new Map<Request, OpenElementRequestScope>();
  const requestScope = (request: Request): OpenElementRequestScope => {
    let scope = scopes.get(request);
    if (!scope) {
      scope = createRequestScope(request);
      scope.set('cspNonce', 'nonce123');
      scopes.set(request, scope);
    }
    return scope;
  };
  const deps = {
    routeModule,
    manifest: route.streamManifest,
    createDeferredDsdExecutor,
    createDeferredPageShell,
    documentStreamParts,
    escapeAttr,
    escapeHtml,
    wrapInDocument,
    createStreamRequestScope,
    streamFields,
    createStreamBody,
    streamBrowserBootstrap: STREAM_BROWSER_BOOTSTRAP,
    timeoutMs,
    createStreamHeaderChannel,
    mergeChannelHeaders,
    requestScope,
    createActionBodyLimit,
    maxActionBodyBytes: MAX_ACTION_BODY_BYTES,
    ACTION_FETCH_HEADER,
    resolvedAppShell: undefined as unknown,
  };
  const generated = new Function('deps', source)(deps) as (
    request: Request,
    route: unknown,
  ) => Promise<Response>;
  const fetch = (request: Request) => {
    // The generated handler is a WinterCG route handler binding the request
    // scope; production creates the scope in the app's dispatch. The harness
    // creates it here — same accessor, same identity binding.
    requestScope(request);
    return generated(request, { params: {} });
  };
  return {
    fetch,
    routeModule,
    setResolvedAppShell: (shell: unknown) => {
      deps.resolvedAppShell = shell;
    },
  };
}

test('generated GET streams a shell then independent inert Part frames with frozen headers', async () => {
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
  expect(response.status).toEqual(200);
  expect(response.headers.get('Set-Cookie')).toEqual('session=abc; HttpOnly');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const shell = decoder.decode((await reader.read()).value);
  expect(shell).toContain('<!DOCTYPE html>');
  expect(shell).toContain('data-oe-stream-request=');
  expect(shell).toContain('<!--oe:p0--><!--oe:/p0-->');
  expect(shell).toContain('data-oe-seed=');
  expect(shell).toContain('<script nonce="nonce123">');
  expect(shell).toContain('data-oe-frame');
  expect(shell.indexOf('<script nonce="nonce123">') < shell.indexOf('</head>')).toEqual(true);
  expect(!shell.includes('</body>')).toBeTruthy();
  held.set('X-Late', 'discard');
  held.delete('Set-Cookie');
  held.forEach((_value, _name, reference) => reference.append('X-Callback-Late', 'discard'));
  expect(response.headers.get('X-Late')).toEqual(null);
  expect(response.headers.get('X-Callback-Late')).toEqual(null);
  expect(response.headers.get('Set-Cookie')).toEqual('session=abc; HttpOnly');
  second.resolve('<script>&');
  const frame2 = decoder.decode((await reader.read()).value);
  expect(frame2).toContain('data-oe-frame=');
  expect(frame2).toContain('part&quot;:1');
  expect(frame2).toContain('&lt;script&gt;&amp;');
  expect(frame2).toContain('<noscript>');
  first.resolve('first');
  const frame1 = decoder.decode((await reader.read()).value);
  expect(frame1).toContain('part&quot;:0');
  expect(frame1).toContain('<noscript>first</noscript>');
  expect(decoder.decode((await reader.read()).value)).toContain('nonce="nonce123"');
  expect((await reader.read()).done).toEqual(true);
});

test('the real channel merge keeps protocol headers and the streamed body', async () => {
  const { fetch, routeModule } = await handler();
  const first = deferred<string>();
  const second = deferred<string>();
  routeModule.loader = ({ responseHeaders }: { responseHeaders: Headers }) => {
    // Every protocol header the channel is forbidden to override, plus one
    // ordinary channel header that must survive.
    responseHeaders.append('Set-Cookie', 'session=abc; HttpOnly');
    responseHeaders.append('Content-Type', 'application/json');
    responseHeaders.append('Cache-Control', 'public, max-age=600');
    responseHeaders.append('Location', '/elsewhere');
    responseHeaders.append('Vary', '*');
    responseHeaders.set('X-OpenElement-Action', 'true');
    responseHeaders.append('X-Channel-Trace', 'kept');
    return { first: first.promise, second: second.promise };
  };
  const response = await fetch(new Request('https://example.test/'));
  expect(response.status).toEqual(200);
  // The channel cannot override a protocol header the response already set
  // (server-runtime/response-channel.ts: `PROTOCOL_HEADERS.has(key) && merged.has(key)`).
  expect(response.headers.get('Content-Type')).toEqual('text/html; charset=UTF-8');
  expect(response.headers.get('Cache-Control')).toEqual('private, no-cache');
  // A protocol header the response does NOT carry, and every ordinary channel
  // header, are appended: the channel only loses a header it tried to replace.
  expect(response.headers.get('Location')).toEqual('/elsewhere');
  expect(response.headers.get('X-OpenElement-Action')).toEqual('true');
  expect(response.headers.get('Set-Cookie')).toEqual('session=abc; HttpOnly');
  expect(response.headers.get('Vary')).toEqual('*');
  expect(response.headers.get('X-Channel-Trace')).toEqual('kept');
  // The rebuilt `new Response(resp.body, …)` still streams: the shell and both
  // Part frames arrive after the merge.
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const shell = decoder.decode((await reader.read()).value);
  expect(shell).toContain('<!DOCTYPE html>');
  second.resolve('second');
  first.resolve('first');
  const frames = [
    decoder.decode((await reader.read()).value),
    decoder.decode((await reader.read()).value),
  ];
  expect(frames.join('')).toContain('part&quot;:1');
  expect(frames.join('')).toContain('part&quot;:0');
});

test('the generated GET refuses a resolved app shell with route-level guidance', async () => {
  // Descriptors built outside buildEntryDescriptor (or reaching the runtime by
  // another path) still hit the generated route guard. It is the route-level
  // counterpart of the build gate and must name the same project-wide fix
  // rather than a route-local one that cannot work.
  const { fetch, routeModule, setResolvedAppShell } = await handler();
  setResolvedAppShell({ tagName: 'open-layout' });
  routeModule.loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });
  const response = await fetch(new Request('https://example.test/'));
  expect(response.status).toEqual(500);
  const body = await response.text();
  expect(body).toContain('resolved a compiled app shell');
  expect(body).toContain('appShell: false');
  expect(body).toContain('leave streaming off');
});

test('generated GET rejects front-gate failures before a success shell', async () => {
  const { fetch, routeModule } = await handler();
  let frontGateSignal!: AbortSignal;
  routeModule.loader = ({ request }: { request: Request }) => {
    frontGateSignal = request.signal;
    return { first: Promise.resolve('a') };
  };
  expect((await fetch(new Request('https://example.test/'))).status).toEqual(500);
  expect(frontGateSignal.aborted).toEqual(true);
  routeModule.loader = () => ({
    first: Promise.resolve('a'),
    second: Promise.resolve('b'),
    unknown: Promise.reject(new Error('not observed by the page')),
  });
  expect((await fetch(new Request('https://example.test/'))).status).toEqual(500);
  routeModule.loader = () => {
    throw { redirect: true, location: '/login', status: 302 };
  };
  const redirect = await fetch(new Request('https://example.test/'));
  expect(redirect.status).toEqual(302);
  expect(redirect.headers.get('Location')).toEqual('/login');
});

test('generated GET abort and late failure do not turn into successful backfills', async () => {
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
  expect(frame).toContain('outcome&quot;:&quot;error');
  expect(response.status).toEqual(200);
  controller.abort();
  expect(loaderSignal.aborted).toEqual(true);
  expect((await reader.read()).done).toEqual(true);
  first.resolve('too late');
  await Promise.resolve();
});

test('slow reader keeps only settled fields until a pull and cancel ignores late results', async () => {
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
  expect((await reader.read()).done).toEqual(false);
  await reader.cancel();
  expect(loaderSignal.aborted).toEqual(true);
  expect((await reader.read()).done).toEqual(true);
});

/**
 * Observation seam for the streamed body's own `controller.close()`.
 *
 * A pull parked at the wake-await resumes on an already-cancelled stream,
 * where `close()` throws `TypeError: The stream controller cannot close or
 * enqueue`. The rejection is discarded by the stream machinery (the stream is
 * no longer readable), so the consumer sees nothing — the only faithful
 * observation is whether the generated code ATTEMPTS the close. This wrapper
 * records each `pull` and each close attempt with the cancel state it happened
 * in; it forwards the real controller otherwise, so the code under test is
 * unchanged. Recorded `pull` events also let a test wait for the parked pull
 * (a plain macrotask is too early: the stream has not invoked pull yet).
 */
interface UnderlyingGenericSource {
  pull?(controller: ReadableStreamDefaultController<Uint8Array>): unknown;
  cancel?(reason: unknown): PromiseLike<void> | void;
}

function streamCloseProbe(): {
  events: string[];
  pulls(): number;
  waitForPull(count: number): Promise<void>;
  restore(): void;
} {
  const events: string[] = [];
  const Native = globalThis.ReadableStream;
  let cancelled = false;
  const wrap = (source: UnderlyingGenericSource): UnderlyingGenericSource => ({
    pull(controller) {
      events.push('pull');
      if (!Object.prototype.hasOwnProperty.call(controller, 'close')) {
        const real = controller.close.bind(controller);
        Object.defineProperty(controller, 'close', {
          value: () => {
            events.push(cancelled ? 'close-after-cancel' : 'close');
            return real();
          },
          configurable: true,
        });
      }
      return source.pull?.call(source, controller);
    },
    cancel(reason) {
      cancelled = true;
      events.push('cancel');
      return source.cancel?.call(source, reason);
    },
  });
  const ProbedStream = function (this: unknown, source: unknown, strategy?: unknown): unknown {
    const underlying = wrap(
      source as UnderlyingGenericSource,
    ) as unknown as UnderlyingSource<Uint8Array>;
    return new Native(underlying, strategy as QueuingStrategy<Uint8Array>);
  };
  (globalThis as unknown as { ReadableStream: unknown }).ReadableStream = ProbedStream;
  return {
    events,
    pulls: () => events.filter((event) => event === 'pull').length,
    waitForPull: async (count: number) => {
      const deadline = Date.now() + 5_000;
      while (events.filter((event) => event === 'pull').length < count) {
        if (Date.now() > deadline) {
          throw new Error(
            `Timed out waiting for ${count} pulls; observed events: ${events.join(', ')}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    restore: () => {
      (globalThis as unknown as { ReadableStream: unknown }).ReadableStream = Native;
    },
  };
}

test('cancel while a pull is parked at wake-await never closes the cancelled stream', async () => {
  const { fetch, routeModule } = await handler();
  const first = deferred<string>();
  const second = deferred<string>();
  routeModule.loader = () => ({ first: first.promise, second: second.promise });
  const probe = streamCloseProbe();
  try {
    const response = await fetch(new Request('https://example.test/'));
    const reader = response.body!.getReader();
    // The shell is consumed; the next read parks the pull at the wake-await
    // because both deferred fields are still unresolved.
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('<!DOCTYPE html>');
    const parked = reader.read();
    await probe.waitForPull(2);
    await reader.cancel();
    expect(await parked.then((result) => result.done), 'the parked read ends done').toEqual(true);
    first.resolve('late');
    second.resolve('late');
    await Promise.resolve();
  } finally {
    probe.restore();
  }
  expect(
    probe.events.includes('cancel'),
    `the body observed the cancel: ${probe.events.join(', ')}`,
  ).toBeTruthy();
  // The stream was already closed by the cancel; the resumed pull must not try
  // to close again (that attempt is the TypeError).
  expect(
    !probe.events.includes('close-after-cancel'),
    `resumed pull must not close a cancelled stream: ${probe.events.join(', ')}`,
  ).toBeTruthy();
  expect(
    probe.events.filter((event) => event === 'close'),
    'no close attempt belongs to the cancelled response',
  ).toEqual([]);
});

test('a request abort with a parked pull still closes the stream body', async () => {
  const { fetch, routeModule } = await handler();
  const first = deferred<string>();
  const second = deferred<string>();
  let loaderSignal!: AbortSignal;
  routeModule.loader = ({ request }: { request: Request }) => {
    loaderSignal = request.signal;
    return { first: first.promise, second: second.promise };
  };
  const controller = new AbortController();
  const probe = streamCloseProbe();
  try {
    const response = await fetch(
      new Request('https://example.test/', { signal: controller.signal }),
    );
    const reader = response.body!.getReader();
    await reader.read();
    const parked = reader.read();
    await probe.waitForPull(2);
    controller.abort();
    // An abort is not a cancel: the response body is still readable, so the
    // resumed pull must close it to terminate the body for the reader.
    expect(await parked.then((result) => result.done)).toEqual(true);
    expect(loaderSignal.aborted).toEqual(true);
  } finally {
    probe.restore();
  }
  expect(probe.events.includes('cancel'), 'an abort never cancels the body').toEqual(false);
  expect(
    probe.events.filter((event) => event === 'close').length,
    `exactly one close terminates the aborted body: ${probe.events.join(', ')}`,
  ).toEqual(1);
});

test('deferred timeout aborts loader work but emits terminal error frames', async () => {
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
  expect(loaderSignal.aborted).toEqual(true);
  expect(first).toContain('outcome&quot;:&quot;error');
  expect(second).toContain('outcome&quot;:&quot;error');
  expect(decoder.decode((await reader.read()).value)).toContain('</html>');
  expect((await reader.read()).done).toEqual(true);
  expect(response.status).toEqual(200);
});

test('late loader success cannot overwrite a queued timeout error for a slow reader', async () => {
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
      }),
    );
  }
  second.resolve('settled-after-timeout');
  await Promise.resolve();
  const decoder = new TextDecoder();
  const onTime = decoder.decode((await reader.read()).value);
  const late = decoder.decode((await reader.read()).value);
  expect(onTime).toContain('settled-before-timeout');
  expect(onTime).toContain('outcome&quot;:&quot;content');
  expect(late).toContain('outcome&quot;:&quot;error');
  expect(late.includes('settled-after-timeout')).toEqual(false);
  expect(decoder.decode((await reader.read()).value)).toContain('</html>');
  expect((await reader.read()).done).toEqual(true);
});

/** Collect unhandled rejections so an observed-rejection contract can be asserted.
 *  node-host equivalent of the Deno-global listener: a registered process
 *  'unhandledRejection' handler suppresses the default crash (the same role
 *  preventDefault played under Deno). */
function unhandledRejectionGuard(): { events: unknown[]; install(): void; restore(): void } {
  const events: unknown[] = [];
  const listener = (reason: unknown) => {
    events.push(reason);
  };
  return {
    events,
    install: () => process.on('unhandledRejection', listener),
    restore: () => process.off('unhandledRejection', listener),
  };
}

test('front gate observes every loader rejection when a declared field is missing', async () => {
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
    expect((await fetch(new Request('https://example.test/'))).status).toEqual(500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(guard.events).toEqual([]);
    // The process survives the front-gate throw and keeps serving requests.
    routeModule.loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });
    expect((await fetch(new Request('https://example.test/'))).status).toEqual(200);
  } finally {
    guard.restore();
  }
});

test('front gate observes every loader rejection when several thenables are undeclared', async () => {
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
    expect((await fetch(new Request('https://example.test/'))).status).toEqual(500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(guard.events).toEqual([]);
    routeModule.loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });
    expect((await fetch(new Request('https://example.test/'))).status).toEqual(200);
  } finally {
    guard.restore();
  }
});

test('front gate observes loader rejections when the loader returns a non-object', async () => {
  const { fetch, routeModule } = await handler();
  const guard = unhandledRejectionGuard();
  guard.install();
  try {
    // An array loader fails the one-object shape gate before any per-field
    // observer exists; its rejecting entries must still be observed or the
    // process dies instead of answering 500.
    routeModule.loader = () => [Promise.reject(new Error('array stray rejection'))];
    expect((await fetch(new Request('https://example.test/'))).status).toEqual(500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(guard.events).toEqual([]);
    // The process survives the front-gate throw and keeps serving requests.
    routeModule.loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });
    expect((await fetch(new Request('https://example.test/'))).status).toEqual(200);
  } finally {
    guard.restore();
  }
});

test('front gate answers 500 when the loader itself returns a rejected promise', async () => {
  const { fetch, routeModule } = await handler();
  const guard = unhandledRejectionGuard();
  guard.install();
  try {
    // A bare rejecting promise (no object at all): the generated handler's
    // await consumes the rejection, so no stray unhandled rejection survives
    // and the route still answers 500 instead of crashing.
    routeModule.loader = () => Promise.reject(new Error('loader rejection'));
    expect((await fetch(new Request('https://example.test/'))).status).toEqual(500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(guard.events).toEqual([]);
    // The process survives and keeps serving requests.
    routeModule.loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });
    expect((await fetch(new Request('https://example.test/'))).status).toEqual(200);
  } finally {
    guard.restore();
  }
});

test('stream budget front gate observes loader rejections before its diagnostic throw', async () => {
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
    expect((await fetch(new Request('https://example.test/'))).status).toEqual(500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(guard.events, 'the budget throw observed the loader rejection').toEqual([]);
  } finally {
    guard.restore();
  }
});
