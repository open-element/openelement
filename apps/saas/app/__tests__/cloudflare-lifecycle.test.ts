import { assertEquals } from '@std/assert';
import {
  consumeAttachmentScanDeadLetters,
  consumeAttachmentScans,
  consumePaymentEventDeadLetters,
  consumePaymentEvents,
  reconcileAttachments,
  reconcilePayments,
  type WorkerEnv,
} from '../../lib/cloudflare-lifecycle.ts';

function env(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    ATTACHMENT_SCANNER: { fetch: () => Promise.resolve(Response.json({ verdict: 'clean' })) },
    ATTACHMENT_SCAN_QUEUE: { send: () => Promise.resolve() },
    PAYMENT_EVENT_QUEUE: { send: () => Promise.resolve() },
    ...overrides,
  };
}

Deno.test('queue scan acknowledges only after scanner verdict and atomic RPC', async () => {
  const originalFetch = globalThis.fetch;
  const rpcBodies: unknown[] = [];
  globalThis.fetch = (_input, init) => {
    rpcBodies.push(JSON.parse(String(init?.body)));
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  let acked = 0;
  let retried = 0;
  try {
    await consumeAttachmentScans({
      queue: 'openelement-attachment-scan',
      messages: [{
        body: { type: 'attachment.scan', reservationId: 'r1', objectKey: 'u/o' },
        ack: () => acked++,
        retry: () => retried++,
      }],
    }, env());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(acked, 1);
  assertEquals(retried, 0);
  assertEquals(rpcBodies, [{ reservation_id: 'r1', target_key: 'u/o', verdict: 'clean' }]);
});

Deno.test('queue scan retries invalid scanner responses without acknowledging', async () => {
  let acked = 0;
  let retried = 0;
  await consumeAttachmentScans(
    {
      queue: 'openelement-attachment-scan',
      messages: [{
        body: { type: 'attachment.scan', reservationId: 'r1', objectKey: 'u/o' },
        ack: () => acked++,
        retry: () => retried++,
      }],
    },
    env({
      ATTACHMENT_SCANNER: { fetch: () => Promise.resolve(Response.json({ verdict: 'unknown' })) },
    }),
  );
  assertEquals(acked, 0);
  assertEquals(retried, 1);
});

Deno.test('DLQ acknowledges only after durable dead-letter persistence', async () => {
  const originalFetch = globalThis.fetch;
  const calls: unknown[] = [];
  globalThis.fetch = (_input, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  let acked = 0;
  let retried = 0;
  try {
    await consumeAttachmentScanDeadLetters({
      queue: 'openelement-attachment-scan-dlq',
      messages: [{
        body: { type: 'attachment.scan', reservationId: 'r1', objectKey: 'u/o' },
        ack: () => acked++,
        retry: () => retried++,
      }],
    }, env());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(acked, 1);
  assertEquals(retried, 0);
  assertEquals(calls, [{ reservation_id: 'r1', target_key: 'u/o' }]);
});

Deno.test('DLQ retries when durable persistence is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
  let acked = 0;
  let retried = 0;
  try {
    await consumeAttachmentScanDeadLetters({
      queue: 'openelement-attachment-scan-dlq',
      messages: [{
        body: { type: 'attachment.scan', reservationId: 'r1', objectKey: 'u/o' },
        ack: () => acked++,
        retry: () => retried++,
      }],
    }, env());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(acked, 0);
  assertEquals(retried, 1);
});

Deno.test('Cron removes stale objects before releasing quota and requeues pending scans', async () => {
  const originalFetch = globalThis.fetch;
  const operations: string[] = [];
  const queued: unknown[] = [];
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith('/rpc/list_pending_attachment_deletions')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_stale_attachment_reservations')) {
      return Promise.resolve(Response.json([{ id: 'stale-1', object_key: 'u/stale' }]));
    }
    if (url.includes('/storage/v1/object/')) {
      operations.push(`storage:${init?.method}`);
      return Promise.resolve(Response.json({}));
    }
    if (url.endsWith('/rpc/release_stale_attachment')) {
      operations.push('release');
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith('/rpc/list_pending_attachment_scans')) {
      return Promise.resolve(Response.json([{ id: 'pending-1', object_key: 'u/pending' }]));
    }
    if (url.endsWith('/rpc/list_requested_attachment_scan_replays')) {
      return Promise.resolve(Response.json([]));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await reconcileAttachments(env({
      ATTACHMENT_SCAN_QUEUE: {
        send: (message) => {
          queued.push(message);
          return Promise.resolve();
        },
      },
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(operations, ['storage:DELETE', 'release']);
  assertEquals(queued, [{
    type: 'attachment.scan',
    reservationId: 'pending-1',
    objectKey: 'u/pending',
  }]);
});

Deno.test('Cron retains an abandoned reservation across Storage failure and releases it on retry', async () => {
  // Reserve succeeded but the client never finalized: the row stays 'reserved'
  // until the 15-minute stale sweep lists it (migration 20260817000002). The
  // sweep must not release quota while the object removal failed, and must
  // converge on the next run — object removal strictly before quota release.
  const originalFetch = globalThis.fetch;
  let released = 0;
  let storageAttempts = 0;
  const operations: string[] = [];
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/rpc/list_pending_attachment_deletions')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_stale_attachment_reservations')) {
      return Promise.resolve(
        Response.json(released ? [] : [{ id: 'stale-1', object_key: 'u/stale' }]),
      );
    }
    if (url.includes('/storage/v1/object/')) {
      storageAttempts++;
      operations.push(`storage:DELETE#${storageAttempts}`);
      return Promise.resolve(
        storageAttempts === 1
          ? Response.json({ error: 'temporary outage' }, { status: 503 })
          : Response.json({}),
      );
    }
    if (url.endsWith('/rpc/release_stale_attachment')) {
      released++;
      operations.push('release');
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (
      url.endsWith('/rpc/list_pending_attachment_scans') ||
      url.endsWith('/rpc/list_requested_attachment_scan_replays')
    ) return Promise.resolve(Response.json([]));
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await reconcileAttachments(env());
    await reconcileAttachments(env());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(storageAttempts, 2);
  assertEquals(released, 1);
  assertEquals(operations, ['storage:DELETE#1', 'storage:DELETE#2', 'release']);
});

Deno.test('Cron converges an interrupted attachment deletion', async () => {
  const originalFetch = globalThis.fetch;
  const operations: string[] = [];
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith('/rpc/list_pending_attachment_deletions')) {
      return Promise.resolve(Response.json([{ id: 'deleting-1', object_key: 'u/deleting' }]));
    }
    if (url.includes('/storage/v1/object/')) {
      operations.push(`storage:${init?.method}`);
      return Promise.resolve(Response.json({}));
    }
    if (url.endsWith('/rpc/complete_pending_attachment_delete')) {
      operations.push('complete');
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (
      url.endsWith('/rpc/list_stale_attachment_reservations') ||
      url.endsWith('/rpc/list_pending_attachment_scans') ||
      url.endsWith('/rpc/list_requested_attachment_scan_replays')
    ) return Promise.resolve(Response.json([]));
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await reconcileAttachments(env());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(operations, ['storage:DELETE', 'complete']);
});

Deno.test('Cron retains a deletion tombstone across Storage failure and converges on retry', async () => {
  const originalFetch = globalThis.fetch;
  let completed = false;
  let storageAttempts = 0;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/rpc/list_pending_attachment_deletions')) {
      return Promise.resolve(Response.json(
        completed ? [] : [{ id: 'deleting-retry', object_key: 'u/deleting-retry' }],
      ));
    }
    if (url.includes('/storage/v1/object/')) {
      storageAttempts++;
      return Promise.resolve(
        storageAttempts === 1
          ? Response.json({ error: 'temporary outage' }, { status: 503 })
          : Response.json({}),
      );
    }
    if (url.endsWith('/rpc/complete_pending_attachment_delete')) {
      completed = true;
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (
      url.endsWith('/rpc/list_stale_attachment_reservations') ||
      url.endsWith('/rpc/list_pending_attachment_scans') ||
      url.endsWith('/rpc/list_requested_attachment_scan_replays')
    ) return Promise.resolve(Response.json([]));
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await reconcileAttachments(env());
    await reconcileAttachments(env());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(storageAttempts, 2);
  assertEquals(completed, true);
});

Deno.test('Cron isolates one enqueue failure so later pending scans still run', async () => {
  const originalFetch = globalThis.fetch;
  const queued: string[] = [];
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/rpc/list_pending_attachment_deletions')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_stale_attachment_reservations')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_pending_attachment_scans')) {
      return Promise.resolve(Response.json([
        { id: 'bad', object_key: 'u/bad' },
        { id: 'good', object_key: 'u/good' },
      ]));
    }
    if (url.endsWith('/rpc/list_requested_attachment_scan_replays')) {
      return Promise.resolve(Response.json([]));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await reconcileAttachments(env({
      ATTACHMENT_SCAN_QUEUE: {
        send: (message) => {
          if (message.reservationId === 'bad') {
            return Promise.reject(new Error('queue unavailable'));
          }
          queued.push(message.reservationId);
          return Promise.resolve();
        },
      },
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(queued, ['good']);
});

Deno.test('Cron marks replay only after Queue handoff succeeds', async () => {
  const originalFetch = globalThis.fetch;
  const operations: string[] = [];
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/rpc/list_pending_attachment_deletions')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_stale_attachment_reservations')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_pending_attachment_scans')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_requested_attachment_scan_replays')) {
      return Promise.resolve(Response.json([{
        id: 'dlq-1',
        reservation_id: 'reservation-1',
        object_key: 'u/replay',
      }]));
    }
    if (url.endsWith('/rpc/mark_attachment_scan_replayed')) {
      operations.push('marked');
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await reconcileAttachments(env({
      ATTACHMENT_SCAN_QUEUE: {
        send: () => {
          operations.push('sent');
          return Promise.resolve();
        },
      },
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(operations, ['sent', 'marked']);
});

Deno.test('Cron leaves a failed replay request durable and continues later rows', async () => {
  const originalFetch = globalThis.fetch;
  const marked: string[] = [];
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith('/rpc/list_pending_attachment_deletions')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_stale_attachment_reservations')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_pending_attachment_scans')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_requested_attachment_scan_replays')) {
      return Promise.resolve(Response.json([
        { id: 'bad', reservation_id: 'bad', object_key: 'u/bad' },
        { id: 'good', reservation_id: 'good', object_key: 'u/good' },
      ]));
    }
    if (url.endsWith('/rpc/mark_attachment_scan_replayed')) {
      marked.push((JSON.parse(String(init?.body)) as { dead_letter_id: string }).dead_letter_id);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await reconcileAttachments(env({
      ATTACHMENT_SCAN_QUEUE: {
        send: (message) =>
          message.reservationId === 'bad'
            ? Promise.reject(new Error('queue unavailable'))
            : Promise.resolve(),
      },
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(marked, ['good']);
});

Deno.test('payment Queue acknowledges only after the durable processor succeeds', async () => {
  const originalFetch = globalThis.fetch;
  const calls: unknown[] = [];
  globalThis.fetch = (_input, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Promise.resolve(Response.json('applied'));
  };
  let acked = 0;
  let retried = 0;
  try {
    await consumePaymentEvents({
      queue: 'openelement-payment-events',
      messages: [{
        body: { type: 'payment.process', eventId: 'evt_paid' },
        ack: () => acked++,
        retry: () => retried++,
      }],
    }, env());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals({ acked, retried }, { acked: 1, retried: 0 });
  assertEquals(calls, [{ target_event_id: 'evt_paid' }]);
});

Deno.test('payment DLQ retries until the dead letter is durable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
  let acked = 0;
  let retried = 0;
  try {
    await consumePaymentEventDeadLetters({
      queue: 'openelement-payment-events-dlq',
      messages: [{
        body: { type: 'payment.process', eventId: 'evt_failed' },
        ack: () => acked++,
        retry: () => retried++,
      }],
    }, env());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals({ acked, retried }, { acked: 0, retried: 1 });
});

Deno.test('payment Cron queues received events and marks replay only after handoff', async () => {
  const originalFetch = globalThis.fetch;
  const operations: string[] = [];
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith('/rpc/list_pending_payment_events')) {
      return Promise.resolve(Response.json([
        { provider_event_id: 'evt_received', processing_state: 'received' },
        { provider_event_id: 'evt_replay', processing_state: 'replay_requested' },
      ]));
    }
    if (url.endsWith('/rpc/mark_payment_event_replay_enqueued')) {
      operations.push(`mark:${JSON.parse(String(init?.body)).target_event_id}`);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await reconcilePayments(env({
      PAYMENT_EVENT_QUEUE: {
        send: (message) => {
          operations.push(`send:${message.eventId}`);
          return Promise.resolve();
        },
      },
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(operations, ['send:evt_received', 'send:evt_replay', 'mark:evt_replay']);
});

Deno.test('payment lifecycle logs correlate by event id and stay redacted', async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/rpc/process_stripe_event')) {
      return Promise.resolve(Response.json('applied'));
    }
    if (url.endsWith('/rpc/record_payment_event_dead_letter')) {
      return Promise.resolve(new Response(null, { status: 503 }));
    }
    if (url.endsWith('/rpc/list_pending_payment_events')) {
      return Promise.resolve(Response.json([
        { provider_event_id: 'evt_received', processing_state: 'received' },
      ]));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const message = (eventId: string) => ({
    body: { type: 'payment.process' as const, eventId },
    ack: () => {},
    retry: () => {},
  });
  try {
    await consumePaymentEvents(
      { queue: 'openelement-payment-events', messages: [message('evt_ok')] },
      env(),
    );
    await consumePaymentEventDeadLetters(
      { queue: 'openelement-payment-events-dlq', messages: [message('evt_dead')] },
      env(),
    );
    await reconcilePayments(env());
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }

  const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  assertEquals(
    entries.find((entry) => entry.event === 'payment_event_processed')?.provider_event_id,
    'evt_ok',
  );
  assertEquals(
    entries.find((entry) => entry.event === 'payment_event_dead_letter_failed')
      ?.provider_event_id,
    'evt_dead',
  );
  const reconciliation = entries.find((entry) => entry.event === 'payment_reconciliation');
  assertEquals(
    {
      pending: reconciliation?.pending,
      enqueued: reconciliation?.enqueued,
      replays: reconciliation?.replays,
    },
    { pending: 1, enqueued: 1, replays: 0 },
  );

  const all = lines.join('\n');
  for (const sentinel of ['service-role-test', 'project.supabase.co']) {
    assertEquals(all.includes(sentinel), false, `payment log leaked: ${sentinel}`);
  }
});

Deno.test('Cron delegates attachment replay state and audit to one atomic RPC', async () => {
  const originalFetch = globalThis.fetch;
  const operations: unknown[] = [];
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith('/rpc/list_pending_attachment_deletions')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_stale_attachment_reservations')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_pending_attachment_scans')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/rpc/list_requested_attachment_scan_replays')) {
      return Promise.resolve(Response.json([{
        id: 'dlq-1',
        reservation_id: 'reservation-1',
        object_key: 'u/replay',
        replay_requested_by: 'admin-9',
      }]));
    }
    if (url.endsWith('/rpc/mark_attachment_scan_replayed')) {
      operations.push({
        rpc: 'mark_attachment_scan_replayed',
        body: JSON.parse(String(init?.body)),
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await reconcileAttachments(env());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(operations, [{
    rpc: 'mark_attachment_scan_replayed',
    body: { dead_letter_id: 'dlq-1' },
  }]);
});

Deno.test('payment Cron delegates replay state and audit to one atomic RPC', async () => {
  const originalFetch = globalThis.fetch;
  const operations: unknown[] = [];
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith('/rpc/list_pending_payment_events')) {
      return Promise.resolve(Response.json([{
        provider_event_id: 'evt_replay',
        processing_state: 'replay_requested',
        replay_requested_by: 'admin-9',
      }]));
    }
    if (url.endsWith('/rpc/mark_payment_event_replay_enqueued')) {
      operations.push({
        rpc: 'mark_payment_event_replay_enqueued',
        body: JSON.parse(String(init?.body)),
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await reconcilePayments(env());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(operations, [{
    rpc: 'mark_payment_event_replay_enqueued',
    body: { target_event_id: 'evt_replay' },
  }]);
});

Deno.test('payment Cron isolates an atomic replay mark failure and continues later rows', async () => {
  const originalFetch = globalThis.fetch;
  const operations: string[] = [];
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith('/rpc/list_pending_payment_events')) {
      return Promise.resolve(Response.json([
        { provider_event_id: 'evt_bad', processing_state: 'replay_requested' },
        { provider_event_id: 'evt_good', processing_state: 'replay_requested' },
      ]));
    }
    if (url.endsWith('/rpc/mark_payment_event_replay_enqueued')) {
      const eventId = JSON.parse(String(init?.body)).target_event_id;
      operations.push(`mark:${eventId}`);
      return Promise.resolve(new Response(null, { status: eventId === 'evt_bad' ? 503 : 204 }));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await reconcilePayments(env({
      PAYMENT_EVENT_QUEUE: {
        send: (message) => {
          operations.push(`send:${message.eventId}`);
          return Promise.resolve();
        },
      },
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(operations, ['send:evt_bad', 'mark:evt_bad', 'send:evt_good', 'mark:evt_good']);
});
