import {
  consumeAttachmentScanDeadLetters,
  consumeAttachmentScans,
  consumePaymentEventDeadLetters,
  consumePaymentEvents,
  type QueueBatch,
  reconcileLifecycle,
  type WorkerEnv,
} from './cloudflare-lifecycle.ts';
import {
  ATTACHMENT_SCAN_DLQ_NAME,
  ATTACHMENT_SCAN_QUEUE_NAME,
  PAYMENT_EVENT_DLQ_NAME,
  PAYMENT_EVENT_QUEUE_NAME,
} from './cloudflare-queues.ts';

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface NitroHandler {
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> | Response;
}

export function createCloudflareHandlers(
  nitro: NitroHandler,
  lifecycle = {
    reconcileLifecycle,
    consumeAttachmentScans,
    consumeAttachmentScanDeadLetters,
    consumePaymentEvents,
    consumePaymentEventDeadLetters,
  },
) {
  return {
    fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
      return nitro.fetch(request, env, ctx);
    },
    scheduled(_event: unknown, env: WorkerEnv, ctx: ExecutionContext) {
      ctx.waitUntil(lifecycle.reconcileLifecycle(env));
    },
    queue(
      batch: QueueBatch<
        | import('./cloudflare-lifecycle.ts').AttachmentScanMessage
        | import('./cloudflare-lifecycle.ts').PaymentEventMessage
      >,
      env: WorkerEnv,
    ) {
      if (batch.queue === ATTACHMENT_SCAN_QUEUE_NAME) {
        return lifecycle.consumeAttachmentScans(batch as never, env);
      }
      if (batch.queue === ATTACHMENT_SCAN_DLQ_NAME) {
        return lifecycle.consumeAttachmentScanDeadLetters(batch as never, env);
      }
      if (batch.queue === PAYMENT_EVENT_QUEUE_NAME) {
        return lifecycle.consumePaymentEvents(batch as never, env);
      }
      if (batch.queue === PAYMENT_EVENT_DLQ_NAME) {
        return lifecycle.consumePaymentEventDeadLetters(batch as never, env);
      }
      throw new Error(`unexpected application queue: ${batch.queue}`);
    },
  };
}
