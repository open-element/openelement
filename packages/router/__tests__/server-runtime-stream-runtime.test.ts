/**
 * Unit tests for @openelement/router/server-runtime stream runtime
 * (ADR-0160 rule a, #1470 block d): the request-time streaming semantics the
 * generated entries import instead of carrying emitted function bodies —
 * the request scope's abort fan-out, the deferred-field front gate with its
 * rejection-observation sweep, the policy-bounded payload checks, the shell
 * commitment and terminal error frames, the deferred-shell gate (Amendment 1:
 * the route→manifest/program fail-closed binding the entry wires to its
 * serialized manifests and executor import), and the browser bootstrap
 * constant.
 *
 * The end-to-end behavior stays pinned by the read-only stream-manifest
 * oracle, by stream-handler.test.ts (the real generated handler driving this
 * module), and by stream-browser.test.ts (real Chromium executing the real
 * bootstrap string).
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from '@std/assert';
import {
  STREAM_FRAME_FORBIDDEN_TAGS,
  STREAM_FRAME_UNSAFE_URL,
  STREAM_FRAME_URL_ATTRIBUTES,
  STREAM_FRAME_URL_CONTROL_MAX,
  STREAM_MAX_FIELDS,
  STREAM_MAX_OWNERS,
  STREAM_MAX_PAYLOAD_LENGTH,
  STREAM_MAX_SEED_PROPERTIES,
} from '@openelement/element/authoring';
import {
  createDeferredPageShell,
  createStreamBody,
  createStreamRequestScope,
  STREAM_BROWSER_BOOTSTRAP,
  streamFields,
} from '../src/vite/internal/server-runtime/stream-runtime.ts';
import type { StreamExecutorView } from '../src/vite/internal/server-runtime/stream-runtime.ts';
import type { StreamRouteManifest } from '../src/vite/internal/protocol/ssg.ts';

function manifest(fieldCount: number): StreamRouteManifest {
  return {
    program: { version: 1, tag: 'oe-unit', sha256: 'a'.repeat(64) },
    fields: Array.from({ length: fieldCount }, (_, index) => ({
      field: `f${index}`,
      signal: `f${index}`,
      owners: [{ kind: 'part' as const, index, location: `p${index}`, source: {} as never }],
    })),
  };
}

function executor(): StreamExecutorView {
  return {
    shell: '<oe-unit></oe-unit>',
    owner: { instanceId: 'instance-1' },
    seed: { f0: { type: 'string' }, f1: { type: 'string' } },
    resolvedValue: (_field, value) => value,
    serializeResolved: (_field, value) => [String(value)],
  };
}

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

Deno.test('stream request scope fans the upstream abort out and cancel detaches it', () => {
  const upstream = new AbortController();
  const scope = createStreamRequestScope(
    new Request('https://example.test/', {
      signal: upstream.signal,
    }),
  );
  assertEquals(scope.upstreamSignal.aborted, false);
  assertEquals(scope.request.signal.aborted, false);
  upstream.abort(new Error('client gone'));
  assertEquals(scope.upstreamSignal.aborted, true);
  assertEquals(scope.request.signal.aborted, true, 'the upstream abort fans out to the scope');

  const second = new AbortController();
  const scope2 = createStreamRequestScope(
    new Request('https://example.test/', {
      signal: second.signal,
    }),
  );
  scope2.abortWork();
  assertEquals(scope2.request.signal.aborted, true);
  assertEquals(second.signal.aborted, false, 'abortWork must not cancel the upstream request');
  scope2.cancel();
  assertEquals(scope2.request.signal.aborted, true, 'cancel aborts the scope');
  assertEquals(
    second.signal.aborted,
    false,
    'cancel detaches the fan-out instead of aborting the upstream request',
  );

  const third = new AbortController();
  const scope3 = createStreamRequestScope(
    new Request('https://example.test/', {
      signal: third.signal,
    }),
  );
  scope3.cancel();
  scope3.cancel();
  assertEquals(scope3.request.signal.aborted, true, 'a repeated cancel stays a no-op');
});

Deno.test('stream front gate rejects non-object loader data after observing its thenables', async () => {
  const rejecting = Promise.reject(new Error('array stray rejection'));
  const error = assertThrows(() => streamFields([rejecting], manifest(1)), Error);
  assertEquals(error.message, 'stream loader must return one object');
  await new Promise((resolve) => setTimeout(resolve, 0)); // the rejection is observed
});

Deno.test('stream front gate enforces the field/owner budget from the policy constants', () => {
  const overFields = manifest(STREAM_MAX_FIELDS + 1);
  const error = assertThrows(() => streamFields({}, overFields), Error);
  assertEquals(error.message, 'stream manifest exceeds the bounded field/Part budget');
  // The boundary itself is admitted: a manifest AT the budget passes the gate.
  const atBudgetFields = manifest(STREAM_MAX_FIELDS);
  const atBudget = streamFields(
    Object.fromEntries(atBudgetFields.fields.map((field) => [field.field, 'v'])),
    atBudgetFields,
  );
  assertEquals(atBudget.length, STREAM_MAX_FIELDS);
});

Deno.test('stream front gate rejects a missing declared field and observes the strays', async () => {
  const declared = Promise.reject(new Error('declared field rejection'));
  const error = assertThrows(
    () => streamFields({ f0: declared }, manifest(2)),
    Error,
    'missing declared deferred field',
  );
  assertEquals(error.message, 'missing declared deferred field f1');
  await new Promise((resolve) => setTimeout(resolve, 0)); // the declared rejection is observed
  // The undeclared-thenable exit sweeps every loader thenable through
  // observation before it throws, rejections included.
  const stray = Promise.reject(new Error('undeclared stray rejection'));
  assertThrows(
    () => streamFields({ f0: 'a', f1: 'b', ghost: stray }, manifest(2)),
    Error,
    'undeclared thenable loader field ghost',
  );
  await new Promise((resolve) => setTimeout(resolve, 0)); // the stray rejection is observed too
});

Deno.test('stream front gate attaches both observers per declared field', async () => {
  const records = streamFields(
    { f0: Promise.resolve('ok'), f1: Promise.reject(new Error('no')) },
    manifest(2),
  );
  await new Promise((resolve) => setTimeout(resolve, 0)); // settlement lands on the microtask queue
  assertEquals(
    records.map((record) => record.settled),
    [true, true],
  );
  assertEquals(
    records.map((record) => record.failed),
    [false, true],
  );
  assertEquals(records[0].value, 'ok');
  assertEquals((records[1].error as Error).message, 'no');
});

Deno.test('deferred-shell gate fails closed when the route has no build manifest', async () => {
  const gate = createDeferredPageShell({
    streamManifests: {},
    createDeferredDsdExecutor: () => Promise.resolve(executor()),
  });
  const error = await assertRejects(
    () => gate('/', { default: { __partProgram: { tag: 'oe-unit', version: 1 } } }, {}, 'i', 't'),
    Error,
  );
  assertEquals(
    error.message,
    '[openElement] stream route / has no matching compiled route manifest/program.',
  );
});

Deno.test('deferred-shell gate fails closed on a program tag or version mismatch', async () => {
  const gate = createDeferredPageShell({
    streamManifests: { '/': manifest(1) },
    createDeferredDsdExecutor: () => Promise.resolve(executor()),
  });
  const routeModule = { default: { __partProgram: { tag: 'other-unit', version: 1 } } };
  await assertRejects(() => gate('/', routeModule, {}, 'i', 't'), Error, 'no matching compiled');
  const wrongVersion = {
    default: { __partProgram: { tag: 'oe-unit', version: manifest(1).program.version + 1 } },
  };
  await assertRejects(() => gate('/', wrongVersion, {}, 'i', 't'), Error, 'no matching compiled');
  // A page module without a compiled program fails the same gate.
  await assertRejects(
    () => gate('/', { default: {} }, {}, 'i', 't'),
    Error,
    'no matching compiled',
  );
});

Deno.test('deferred-shell gate delegates to the entry executor import on a match', async () => {
  const routeModule = { default: { __partProgram: { tag: 'oe-unit', version: 1 } } };
  const calls: unknown[] = [];
  const produced = executor();
  const gate = createDeferredPageShell({
    streamManifests: { '/': manifest(1) },
    createDeferredDsdExecutor: (options) => {
      calls.push(options);
      return Promise.resolve(produced);
    },
  });
  const executorView = await gate('/', routeModule, { first: 'v' }, 'instance-9', 'token-9');
  assertEquals(executorView, produced);
  assertEquals(calls, [
    {
      componentClass: routeModule.default,
      props: { first: 'v' },
      manifest: manifest(1),
      instanceId: 'instance-9',
      documentToken: 'token-9',
    },
  ]);
});

Deno.test('stream body commits the shell with its typed seed attribute first', async () => {
  const scope = createStreamRequestScope(new Request('https://example.test/'));
  const records = streamFields({ f0: Promise.resolve('v0') }, manifest(1));
  const body = createStreamBody({ escapeAttr })({
    scope,
    route: '/',
    manifest: manifest(1),
    executor: executor(),
    records,
    document: { prefix: '<!DOCTYPE html><html>', suffix: '</html>' },
    token: 'token-1',
  });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const shell = decoder.decode((await reader.read()).value);
  assertStringIncludes(shell, '<!DOCTYPE html><html>');
  assertStringIncludes(shell, '<oe-unit></oe-unit>');
  assertStringIncludes(shell, 'data-oe-seed=');
  assertStringIncludes(shell, '&quot;instance&quot;:&quot;instance-1&quot;');
  assertStringIncludes(shell, '&quot;program&quot;:&quot;1:' + 'a'.repeat(64) + '&quot;');
  assertStringIncludes(shell, '&quot;pending&quot;:[0]');
  assertEquals(scope.request.signal.aborted, false);
  await reader.cancel();
});

Deno.test('stream body backfills content frames, the no-JS tail, and then closes', async () => {
  const scope = createStreamRequestScope(new Request('https://example.test/'));
  const deferred = Promise.withResolvers<string>();
  const records = streamFields({ f0: deferred.promise }, manifest(1));
  const body = createStreamBody({ escapeAttr })({
    scope,
    route: '/',
    manifest: manifest(1),
    executor: executor(),
    records,
    document: { prefix: '<html>', suffix: '</html>' },
    token: 'token-1',
  });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  await reader.read();
  deferred.resolve('backfilled');
  const frame = decoder.decode((await reader.read()).value);
  assertStringIncludes(frame, 'data-oe-frame=');
  assertStringIncludes(frame, '&quot;outcome&quot;:&quot;content&quot;');
  assertStringIncludes(frame, '<noscript>backfilled</noscript>');
  const tail = decoder.decode((await reader.read()).value);
  assertEquals(tail, '</html>');
  assertEquals((await reader.read()).done, true);
  await reader.cancel();
});

Deno.test('stream body answers a rejected field with a terminal value-less error frame', async () => {
  const scope = createStreamRequestScope(new Request('https://example.test/'));
  const deferred = Promise.withResolvers<string>();
  const records = streamFields({ f0: deferred.promise }, manifest(1));
  const body = createStreamBody({ escapeAttr })({
    scope,
    route: '/',
    manifest: manifest(1),
    executor: executor(),
    records,
    document: { prefix: '<html>', suffix: '</html>' },
    token: 'token-1',
  });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  await reader.read();
  deferred.reject(new Error('late failure'));
  const originalError = console.error;
  const messages: string[] = [];
  console.error = (...args: unknown[]) => messages.push(String(args[0]));
  let frame: string;
  try {
    frame = decoder.decode((await reader.read()).value);
  } finally {
    console.error = originalError;
  }
  assertStringIncludes(frame, '&quot;outcome&quot;:&quot;error&quot;');
  assertStringIncludes(frame, '<noscript><p>Content unavailable.</p></noscript>');
  assert(
    messages.some((message) => message === '[openElement] deferred Part failed'),
    'the failure is diagnosed',
  );
  assert(!frame.includes('late failure'), 'the error frame carries no internals');
  await reader.cancel();
});

Deno.test('stream body turns an over-policy range into error frames, never oversized markup', async () => {
  const scope = createStreamRequestScope(new Request('https://example.test/'));
  const oversized: StreamExecutorView = {
    ...executor(),
    serializeResolved: () => ['x'.repeat(STREAM_MAX_PAYLOAD_LENGTH + 1)],
  };
  const records = streamFields({ f0: Promise.resolve('big') }, manifest(1));
  const body = createStreamBody({ escapeAttr })({
    scope,
    route: '/',
    manifest: manifest(1),
    executor: oversized,
    records,
    document: { prefix: '<html>', suffix: '</html>' },
    token: 'token-1',
  });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  await reader.read();
  const originalError = console.error;
  const messages: string[] = [];
  console.error = (...args: unknown[]) => messages.push(String(args[0]));
  let frame: string;
  try {
    frame = decoder.decode((await reader.read()).value);
  } finally {
    console.error = originalError;
  }
  assertStringIncludes(frame, '&quot;outcome&quot;:&quot;error&quot;');
  assert(
    messages.some((message) => message === '[openElement] deferred Part failed'),
    'the oversized range is diagnosed',
  );
  await reader.cancel();
});

Deno.test('stream body timeout sweeps pending fields and aborts loader work', async () => {
  const scope = createStreamRequestScope(new Request('https://example.test/'));
  const records = streamFields({ f0: new Promise<string>(() => {}) }, manifest(1));
  const body = createStreamBody({ escapeAttr, timeoutMs: 20 })({
    scope,
    route: '/',
    manifest: manifest(1),
    executor: executor(),
    records,
    document: { prefix: '<html>', suffix: '</html>' },
    token: 'token-1',
  });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  await reader.read();
  const frame = decoder.decode((await reader.read()).value);
  assertStringIncludes(frame, '&quot;outcome&quot;:&quot;error&quot;');
  assertEquals(scope.request.signal.aborted, true, 'the timeout aborts loader work');
  assertStringIncludes(decoder.decode((await reader.read()).value), '</html>');
  await reader.cancel();
});

Deno.test('stream body cancel aborts the request scope and ends the stream', async () => {
  const upstream = new AbortController();
  const scope = createStreamRequestScope(
    new Request('https://example.test/', {
      signal: upstream.signal,
    }),
  );
  const records = streamFields({ f0: new Promise<string>(() => {}) }, manifest(1));
  const body = createStreamBody({ escapeAttr })({
    scope,
    route: '/',
    manifest: manifest(1),
    executor: executor(),
    records,
    document: { prefix: '<html>', suffix: '</html>' },
    token: 'token-1',
  });
  const reader = body.getReader();
  await reader.read();
  await reader.cancel();
  assertEquals(scope.request.signal.aborted, true, 'cancel aborts the loader-facing scope');
  assertEquals(
    upstream.signal.aborted,
    false,
    'the upstream signal is the consumer side; the body only detaches from it',
  );
  assertEquals((await reader.read()).done, true);
});

Deno.test('the browser bootstrap constant carries the policy values it enforces', () => {
  // It is the one inline head script of every streamed page; its EXECUTION in
  // a real document is pinned by stream-browser.test.ts (Chromium).
  assertStringIncludes(STREAM_BROWSER_BOOTSTRAP, '(function () {');
  assertStringIncludes(STREAM_BROWSER_BOOTSTRAP.trimEnd(), '})();');
  assertStringIncludes(STREAM_BROWSER_BOOTSTRAP, 'openelement.stream-state.v1');
  assertStringIncludes(STREAM_BROWSER_BOOTSTRAP, 'openelement.stream-control.v1');
  assertStringIncludes(STREAM_BROWSER_BOOTSTRAP, `var maxPayload = ${STREAM_MAX_PAYLOAD_LENGTH};`);
  assertStringIncludes(
    STREAM_BROWSER_BOOTSTRAP,
    `new Set(${JSON.stringify(STREAM_FRAME_FORBIDDEN_TAGS)})`,
  );
  assertStringIncludes(
    STREAM_BROWSER_BOOTSTRAP,
    `new Set(${JSON.stringify(STREAM_FRAME_URL_ATTRIBUTES)})`,
  );
  assertStringIncludes(
    STREAM_BROWSER_BOOTSTRAP,
    `var frameUrlControlMax = ${STREAM_FRAME_URL_CONTROL_MAX};`,
  );
  assertStringIncludes(
    STREAM_BROWSER_BOOTSTRAP,
    `var unsafeFrameUrl = ${STREAM_FRAME_UNSAFE_URL};`,
  );
  assertStringIncludes(
    STREAM_BROWSER_BOOTSTRAP,
    `frame.fields.length > ${STREAM_MAX_FIELDS} || frame.pending.length > ${STREAM_MAX_OWNERS}`,
  );
  assertStringIncludes(STREAM_BROWSER_BOOTSTRAP, `names.length > ${STREAM_MAX_SEED_PROPERTIES}`);
  // The browser-local walker bounds stay contract literals.
  assertStringIncludes(STREAM_BROWSER_BOOTSTRAP, 'var maxNodes = 10000;');
  assertStringIncludes(STREAM_BROWSER_BOOTSTRAP, 'if (depth > 32) return false;');
});

Deno.test('the stream policy constants are the wire contracts the browser enforces', () => {
  assertEquals(STREAM_MAX_FIELDS, 32);
  assertEquals(STREAM_MAX_OWNERS, 64);
  assertEquals(STREAM_MAX_SEED_PROPERTIES, 64);
  assertEquals(STREAM_MAX_PAYLOAD_LENGTH, 256 * 1024);
  assertEquals(STREAM_FRAME_URL_CONTROL_MAX, 32);
  assertEquals(
    [...STREAM_FRAME_FORBIDDEN_TAGS],
    ['script', 'style', 'template', 'iframe', 'object', 'embed', 'base', 'meta', 'link'],
  );
});
