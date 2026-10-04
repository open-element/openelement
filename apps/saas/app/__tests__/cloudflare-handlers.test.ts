import { expect, test } from 'vitest';
import { createCloudflareHandlers } from '../../lib/cloudflare-handlers.ts';

const env = {} as never;

test('custom Cloudflare entry preserves the Nitro fetch response exactly', async () => {
  const expected = new Response('nitro', { status: 207, headers: { 'x-owner': 'nitro' } });
  const handlers = createCloudflareHandlers(
    { fetch: () => expected },
    {
      reconcileLifecycle: () => Promise.resolve(),
      consumeAttachmentScans: () => Promise.resolve(),
      consumeAttachmentScanDeadLetters: () => Promise.resolve(),
      consumePaymentEvents: () => Promise.resolve(),
      consumePaymentEventDeadLetters: () => Promise.resolve(),
    },
  );
  const response = await handlers.fetch(new Request('https://app.test/notes'), env, {
    waitUntil: () => {},
  });
  expect(response).toEqual(expected);
  expect(response.headers.get('x-owner')).toEqual('nitro');
});

test('scheduled and queue events use application lifecycle hooks', async () => {
  const calls: string[] = [];
  const waits: Promise<unknown>[] = [];
  const handlers = createCloudflareHandlers(
    { fetch: () => new Response() },
    {
      reconcileLifecycle: () => {
        calls.push('scheduled');
        return Promise.resolve();
      },
      consumeAttachmentScans: () => {
        calls.push('queue');
        return Promise.resolve();
      },
      consumeAttachmentScanDeadLetters: () => {
        calls.push('dlq');
        return Promise.resolve();
      },
      consumePaymentEvents: () => {
        calls.push('payment');
        return Promise.resolve();
      },
      consumePaymentEventDeadLetters: () => {
        calls.push('payment-dlq');
        return Promise.resolve();
      },
    },
  );
  handlers.scheduled({}, env, { waitUntil: (promise) => waits.push(promise) });
  await handlers.queue({ queue: 'openelement-attachment-scan', messages: [] }, env);
  await handlers.queue({ queue: 'openelement-attachment-scan-dlq', messages: [] }, env);
  await handlers.queue({ queue: 'openelement-payment-events', messages: [] }, env);
  await handlers.queue({ queue: 'openelement-payment-events-dlq', messages: [] }, env);
  await Promise.all(waits);
  expect(calls).toEqual(['scheduled', 'queue', 'dlq', 'payment', 'payment-dlq']);
});
