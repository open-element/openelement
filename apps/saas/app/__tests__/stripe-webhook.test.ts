import { assert, assertEquals, assertRejects } from '@std/assert';
import {
  parseStripeEvent,
  stripeEventData,
  verifyStripeSignature,
} from '../../lib/stripe-webhook.ts';
import stripeWebhook, { createStripeWebhook } from '../routes/api/stripe-webhook.ts';
import {
  MAX_WEBHOOK_BYTES,
  readBoundedRawBody,
  WEBHOOK_READ_TIMEOUT_MS,
  WebhookBodyReadTimeoutError,
  WebhookBodyTooLargeError,
} from '../routes/api/stripe-webhook.ts';

const secret = 'whsec_test_secret';
const timestamp = 1_700_000_000;
const body = JSON.stringify({
  id: 'evt_test',
  type: 'checkout.session.completed',
  created: timestamp,
  livemode: false,
  data: { object: { id: 'cs_test', payment_status: 'paid', metadata: { order_id: 'x' } } },
});

async function signature(payload = body, at = timestamp): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${at}.${payload}`),
    ),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.test('Stripe signature accepts an exact raw body and any valid v1 candidate', async () => {
  const valid = await signature();
  await verifyStripeSignature(body, `t=${timestamp},v1=${'0'.repeat(64)},v1=${valid}`, secret, {
    nowSeconds: timestamp + 300,
  });
  assertEquals(parseStripeEvent(body).id, 'evt_test');
});

Deno.test('Stripe signature rejects changed bodies, stale/future timestamps and malformed headers', async () => {
  const valid = await signature();
  await assertRejects(() =>
    verifyStripeSignature(`${body} `, `t=${timestamp},v1=${valid}`, secret, {
      nowSeconds: timestamp,
    })
  );
  await assertRejects(() =>
    verifyStripeSignature(body, `t=${timestamp},v1=${valid}`, secret, {
      nowSeconds: timestamp + 301,
    })
  );
  await assertRejects(() =>
    verifyStripeSignature(body, `t=${timestamp},v1=${valid}`, secret, {
      nowSeconds: timestamp - 301,
    })
  );
  await assertRejects(() =>
    verifyStripeSignature(body, `t=${timestamp},v0=${valid}`, secret, { nowSeconds: timestamp })
  );
});

Deno.test('Stripe event parsing rejects non-events after signature verification', () => {
  for (const invalid of ['null', '{}', '{"id":"evt_x"}']) {
    try {
      parseStripeEvent(invalid);
      throw new Error('expected invalid event');
    } catch (error) {
      assertEquals((error as Error).message === 'expected invalid event', false);
    }
  }
});

Deno.test('Stripe persistence payload excludes customer and metadata fields', () => {
  const event = parseStripeEvent(body);
  assertEquals(stripeEventData(event), { id: 'cs_test', payment_status: 'paid' });
});

Deno.test('Stripe webhook is POST-only and fails closed when secrets are unavailable', async () => {
  const get = await stripeWebhook({
    request: new Request('https://app.test/api/stripe-webhook'),
    env: {},
  });
  assertEquals(get.status, 405);
  assertEquals(get.headers.get('allow'), 'POST');

  const post = await stripeWebhook({
    request: new Request('https://app.test/api/stripe-webhook', { method: 'POST', body }),
    env: {},
  });
  assertEquals(post.status, 503);
});

Deno.test('Stripe webhook bounds chunked bodies before signature verification', async () => {
  let cancelled = 0;
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_WEBHOOK_BYTES));
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled++;
    },
  });
  const request = new Request('https://app.test/api/stripe-webhook', {
    method: 'POST',
    body: oversized,
  });
  const response = await createStripeWebhook()({
    request,
    env: {
      STRIPE_WEBHOOK_SECRET: secret,
      STRIPE_LIVEMODE: 'false',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only',
      PAYMENT_EVENT_QUEUE: { send: () => Promise.resolve() },
    },
  });
  await Promise.resolve();
  assertEquals(request.headers.has('content-length'), false);
  assertEquals(response.status, 413);
  assertEquals(cancelled, 1);
});

Deno.test('bounded Stripe body reader cancels a stalled stream on timeout', async () => {
  let cancelled = 0;
  const stalled = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => {});
    },
    cancel() {
      cancelled++;
    },
  });
  const request = new Request('https://app.test/api/stripe-webhook', {
    method: 'POST',
    body: stalled,
  });
  await assertRejects(
    () => readBoundedRawBody(request, MAX_WEBHOOK_BYTES, 5),
    WebhookBodyReadTimeoutError,
  );
  await Promise.resolve();
  assertEquals(cancelled, 1);
});

Deno.test('Stripe webhook fast-rejects an over-cap Content-Length without reading the body', async () => {
  let pulled = 0;
  let cancelled = 0;
  const unread = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1024));
    },
    cancel() {
      cancelled++;
    },
  });
  const request = new Request('https://app.test/api/stripe-webhook', {
    method: 'POST',
    headers: { 'content-length': String(MAX_WEBHOOK_BYTES + 1) },
    body: unread,
  });
  let rpcCalls = 0;
  const response = await createStripeWebhook(() => {
    rpcCalls++;
    return Promise.resolve(Response.json({ processing_state: 'received' }));
  })({
    request,
    env: {
      STRIPE_WEBHOOK_SECRET: secret,
      STRIPE_LIVEMODE: 'false',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only',
      PAYMENT_EVENT_QUEUE: { send: () => Promise.resolve() },
    },
  });
  assertEquals(response.status, 413);
  assertEquals(await response.json(), { error: 'payload too large' });
  // Fast reject (stripe-webhook.ts:119-123) returns before readBoundedRawBody:
  // the body stream was never locked by a reader, never cancelled, and never
  // pulled beyond the stream's own one-chunk self-fill. Had the handler read
  // and failed inside readBoundedRawBody, the lock would still be held (:85).
  assertEquals(request.body?.locked, false);
  assertEquals(cancelled, 0);
  await Promise.resolve();
  assert(pulled <= 1, `declared-length fast reject still read the body (${pulled} pulls)`);
  assertEquals(rpcCalls, 0);
  await request.body?.cancel().catch(() => undefined);
});

Deno.test('Stripe webhook rejects a body that outgrows a dishonest under-cap Content-Length', async () => {
  let cancelled = 0;
  // Exactly-cap chunks first (must NOT trip the guard), then one byte over.
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_WEBHOOK_BYTES / 2));
      controller.enqueue(new Uint8Array(MAX_WEBHOOK_BYTES / 2));
      controller.enqueue(new Uint8Array([1]));
      // No close(): a drip-feeding sender keeps the stream open; the cap must win.
    },
    cancel() {
      cancelled++;
    },
  });
  const request = new Request('https://app.test/api/stripe-webhook', {
    method: 'POST',
    headers: { 'content-length': '10' },
    body: oversized,
  });
  let rpcCalls = 0;
  const response = await createStripeWebhook(() => {
    rpcCalls++;
    return Promise.resolve(Response.json({ processing_state: 'received' }));
  })({
    request,
    env: {
      STRIPE_WEBHOOK_SECRET: secret,
      STRIPE_LIVEMODE: 'false',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only',
      PAYMENT_EVENT_QUEUE: { send: () => Promise.resolve() },
    },
  });
  // The declared length stayed under the cap, so the streaming bound
  // (stripe-webhook.ts:124-145) — not the fast reject — produced the 413.
  assertEquals(request.headers.get('content-length'), '10');
  assertEquals(response.status, 413);
  assertEquals(await response.json(), { error: 'payload too large' });
  assertEquals(cancelled, 1);
  assertEquals(rpcCalls, 0);
});

Deno.test('bounded Stripe body reader accepts exactly the cap and rejects one byte over', async () => {
  const bodyOf = (sizes: number[], close: boolean, onCancel: () => void) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of sizes) controller.enqueue(new Uint8Array(size));
        if (close) controller.close();
      },
      cancel: onCancel,
    });

  const atCap = new Request('https://app.test/api/stripe-webhook', {
    method: 'POST',
    body: bodyOf([400, 400], true, () => {}),
  });
  const resolved = await readBoundedRawBody(atCap, 800, 60_000);
  assertEquals(resolved.byteLength, 800);

  let cancelled = 0;
  const overCap = new Request('https://app.test/api/stripe-webhook', {
    method: 'POST',
    // Left open like a drip-feeding sender so the cancel has work to prove.
    body: bodyOf([400, 400, 1], false, () => cancelled++),
  });
  await assertRejects(
    () => readBoundedRawBody(overCap, 800, 60_000),
    WebhookBodyTooLargeError,
  );
  await Promise.resolve();
  assertEquals(cancelled, 1);
});

Deno.test('bounded Stripe body reader stops pulling an unbounded source at the cap', async () => {
  let pulled = 0;
  let cancelled = 0;
  const infinite = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(256));
    },
    cancel() {
      cancelled++;
    },
  });
  const request = new Request('https://app.test/api/stripe-webhook', {
    method: 'POST',
    body: infinite,
  });
  await assertRejects(
    () => readBoundedRawBody(request, 1_000, 60_000),
    WebhookBodyTooLargeError,
  );
  await Promise.resolve();
  assertEquals(cancelled, 1);
  // One eager self-fill plus one pull per read until 1024 > 1000; an
  // unbounded reader would drain the infinite source and hang instead.
  assert(pulled <= 5, `reader kept pulling an unbounded source (${pulled} pulls)`);
});

Deno.test('Stripe webhook maps a handler-level stalled body to 408 and cancels the stream', async () => {
  // The route reads with the module default (stripe-webhook.ts:129 does not
  // inject a timeout), so instead of waiting WEBHOOK_READ_TIMEOUT_MS this
  // test captures the pending read timer and fires it synchronously. The
  // helper-level timeout path itself is covered by the 5ms case above.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const captured: { callback: () => void; delay: number }[] = [];
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    captured.push({ callback, delay: delay ?? 0 });
    return captured.length;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as unknown as typeof clearTimeout;

  let cancelled = 0;
  const stalled = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => {});
    },
    cancel() {
      cancelled++;
    },
  });
  let rpcCalls = 0;
  const handler = createStripeWebhook(() => {
    rpcCalls++;
    return Promise.resolve(Response.json({ processing_state: 'received' }));
  });
  try {
    // Every step before the first body-read await is synchronous, so the
    // read-timeout timer is already captured when the handler promise returns.
    const responsePromise = handler({
      request: new Request('https://app.test/api/stripe-webhook', {
        method: 'POST',
        body: stalled,
      }),
      env: {
        STRIPE_WEBHOOK_SECRET: secret,
        STRIPE_LIVEMODE: 'false',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'server-only',
        PAYMENT_EVENT_QUEUE: { send: () => Promise.resolve() },
      },
    });
    assertEquals(captured.length, 1);
    assertEquals(captured[0].delay, WEBHOOK_READ_TIMEOUT_MS);
    captured[0].callback();
    const response = await responsePromise;
    assertEquals(response.status, 408);
    assertEquals(await response.json(), { error: 'request timeout' });
    await Promise.resolve();
    assertEquals(cancelled, 1);
    assertEquals(rpcCalls, 0);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

Deno.test('Stripe webhook acknowledges only after the verified event is durable', async () => {
  const now = Math.floor(Date.now() / 1000);
  const valid = await signature(body, now);
  let rpcBody: Record<string, unknown> | undefined;
  const queued: unknown[] = [];
  const handler = createStripeWebhook((_input, init) => {
    rpcBody = JSON.parse(String(init?.body));
    return Promise.resolve(Response.json({ processing_state: 'received' }));
  });
  const response = await handler({
    request: new Request('https://app.test/api/stripe-webhook', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${now},v1=${valid}` },
      body,
    }),
    env: {
      STRIPE_WEBHOOK_SECRET: secret,
      STRIPE_LIVEMODE: 'false',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only',
      PAYMENT_EVENT_QUEUE: { send: (message: unknown) => queued.push(message) },
    },
  });
  assertEquals(response.status, 200);
  assertEquals(rpcBody?.target_event_id, 'evt_test');
  assertEquals(rpcBody?.order_reference, 'x');
  assertEquals(queued, [{ type: 'payment.process', eventId: 'evt_test' }]);

  const unavailable = createStripeWebhook(() => Promise.resolve(new Response('', { status: 503 })));
  const retry = await unavailable({
    request: new Request('https://app.test/api/stripe-webhook', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${now},v1=${valid}` },
      body,
    }),
    env: {
      STRIPE_WEBHOOK_SECRET: secret,
      STRIPE_LIVEMODE: 'false',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only',
      PAYMENT_EVENT_QUEUE: { send: () => Promise.resolve() },
    },
  });
  assertEquals(retry.status, 503);

  const networkFailure = createStripeWebhook(() => Promise.reject(new Error('offline')));
  const retryNetwork = await networkFailure({
    request: new Request('https://app.test/api/stripe-webhook', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${now},v1=${valid}` },
      body,
    }),
    env: {
      STRIPE_WEBHOOK_SECRET: secret,
      STRIPE_LIVEMODE: 'false',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only',
      PAYMENT_EVENT_QUEUE: { send: () => Promise.resolve() },
    },
  });
  assertEquals(retryNetwork.status, 503);
});

Deno.test('Stripe webhook returns retryable failure when Queue handoff fails', async () => {
  const now = Math.floor(Date.now() / 1000);
  const valid = await signature(body, now);
  const handler = createStripeWebhook(() =>
    Promise.resolve(Response.json({ processing_state: 'received' }))
  );
  const response = await handler({
    request: new Request('https://app.test/api/stripe-webhook', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${now},v1=${valid}` },
      body,
    }),
    env: {
      STRIPE_WEBHOOK_SECRET: secret,
      STRIPE_LIVEMODE: 'false',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only',
      PAYMENT_EVENT_QUEUE: { send: () => Promise.reject(new Error('unavailable')) },
    },
  });
  assertEquals(response.status, 503);
});

const piiBody = JSON.stringify({
  id: 'evt_pii',
  type: 'checkout.session.completed',
  created: 1_700_000_000,
  livemode: false,
  data: {
    object: {
      id: 'cs_test_pii',
      payment_status: 'paid',
      metadata: { order_id: 'x' },
      customer_details: { email: 'cardholder@example.com', name: 'Card Holder' },
      payment_method_details: { card: { number: '4242424242424242', cvc: '123' } },
    },
  },
});

function captureConsole(lines: string[]): () => void {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  return () => {
    console.log = originalLog;
    console.error = originalError;
  };
}

Deno.test('Stripe webhook logs correlate by event id and never leak payload or secrets', async () => {
  const now = Math.floor(Date.now() / 1000);
  const valid = await signature(piiBody, now);
  const lines: string[] = [];
  const restore = captureConsole(lines);
  const env = {
    STRIPE_WEBHOOK_SECRET: secret,
    STRIPE_LIVEMODE: 'false',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-sentinel',
    PAYMENT_EVENT_QUEUE: { send: () => Promise.resolve() },
  };
  const post = (header: string) =>
    new Request('https://app.test/api/stripe-webhook', {
      method: 'POST',
      headers: { 'stripe-signature': header },
      body: piiBody,
    });
  try {
    const accepted = await createStripeWebhook(() =>
      Promise.resolve(Response.json({ processing_state: 'received' }))
    )({ request: post(`t=${now},v1=${valid}`), env });
    assertEquals(accepted.status, 200);

    const rejected = await createStripeWebhook()({
      request: post(`t=${now},v1=${'0'.repeat(64)}`),
      env,
    });
    assertEquals(rejected.status, 400);

    const notDurable = await createStripeWebhook(() =>
      Promise.resolve(new Response('', { status: 503 }))
    )({ request: post(`t=${now},v1=${valid}`), env });
    assertEquals(notDurable.status, 503);
  } finally {
    restore();
  }

  const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const acceptedLog = entries.find((entry) => entry.event === 'stripe_webhook_accepted');
  assertEquals(acceptedLog?.provider_event_id, 'evt_pii');
  assertEquals(acceptedLog?.event_type, 'checkout.session.completed');
  assertEquals(acceptedLog?.processing_state, 'received');
  assertEquals(acceptedLog?.enqueued, true);
  const rejectedLog = entries.find((entry) => entry.event === 'stripe_webhook_rejected');
  assertEquals(rejectedLog?.reason, 'invalid_signature');
  assertEquals(rejectedLog && 'provider_event_id' in rejectedLog, false);
  const notDurableLog = entries.find((entry) => entry.event === 'stripe_webhook_not_durable');
  assertEquals(notDurableLog?.provider_event_id, 'evt_pii');

  const all = lines.join('\n');
  for (
    const sentinel of [
      '4242424242424242',
      'cardholder@example.com',
      'Card Holder',
      'service-role-sentinel',
      piiBody,
    ]
  ) {
    assertEquals(all.includes(sentinel), false, `payment log leaked: ${sentinel}`);
  }
});
