import {
  parseStripeEvent,
  stripeEventData,
  stripeOrderReference,
  verifyStripeSignature,
} from '../../../lib/stripe-webhook.ts';
import { logPayment, serviceRoleRpc } from '../../../lib/service-role.ts';

interface ApiContext {
  request: Request;
  env: Record<string, unknown>;
}

interface PaymentQueue {
  send(message: { type: 'payment.process'; eventId: string }): Promise<void>;
}

export const MAX_WEBHOOK_BYTES = 1024 * 1024;
export const WEBHOOK_READ_TIMEOUT_MS = 10_000;

export class WebhookBodyTooLargeError extends Error {
  constructor() {
    super('Stripe webhook body exceeds the configured limit');
    this.name = 'WebhookBodyTooLargeError';
  }
}

export class WebhookBodyReadTimeoutError extends Error {
  constructor() {
    super('Stripe webhook body read timed out');
    this.name = 'WebhookBodyReadTimeoutError';
  }
}

/** Read exact signature bytes without ever buffering more than maxBytes. */
export async function readBoundedRawBody(
  request: Request,
  maxBytes = MAX_WEBHOOK_BYTES,
  readTimeoutMs = WEBHOOK_READ_TIMEOUT_MS,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let failed = false;
  const deadline = Date.now() + readTimeoutMs;
  try {
    while (true) {
      const result = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          request.signal.removeEventListener('abort', onAbort);
          callback();
        };
        const onAbort = () =>
          finish(() =>
            reject(request.signal.reason ?? new DOMException('Request aborted', 'AbortError'))
          );
        const timer = setTimeout(
          () => finish(() => reject(new WebhookBodyReadTimeoutError())),
          Math.max(0, deadline - Date.now()),
        );
        request.signal.addEventListener('abort', onAbort, { once: true });
        reader.read().then(
          (value) => finish(() => resolve(value)),
          (error) => finish(() => reject(error)),
        );
      });
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) throw new WebhookBodyTooLargeError();
      chunks.push(result.value);
    }
  } catch (error) {
    failed = true;
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    // A timed-out reader may still have a pending read until cancellation
    // reaches the source; releasing a locked reader then would mask the real
    // error with a TypeError. A completed reader is safe to release now.
    if (!failed) reader.releaseLock();
  }
  const rawBody = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return rawBody;
}

function serverSecret(env: Record<string, unknown>, name: string): string {
  const value = env[name];
  return typeof value === 'string' ? value : '';
}

export function createStripeWebhook(fetchImpl: typeof fetch = fetch) {
  return async function stripeWebhook({ request, env }: ApiContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
    }
    const webhookSecret = serverSecret(env, 'STRIPE_WEBHOOK_SECRET');
    const supabaseUrl = serverSecret(env, 'SUPABASE_URL');
    const serviceRoleKey = serverSecret(env, 'SUPABASE_SERVICE_ROLE_KEY');
    const livemode = serverSecret(env, 'STRIPE_LIVEMODE');
    const queue = env.PAYMENT_EVENT_QUEUE as PaymentQueue | undefined;
    if (
      !webhookSecret || !supabaseUrl || !serviceRoleKey || !queue ||
      !['true', 'false'].includes(livemode)
    ) {
      logPayment('error', { event: 'stripe_webhook_rejected', reason: 'webhook_unavailable' });
      return Response.json({ error: 'webhook unavailable' }, { status: 503 });
    }

    const declaredBytes = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_WEBHOOK_BYTES) {
      logPayment('error', { event: 'stripe_webhook_rejected', reason: 'payload_too_large' });
      return Response.json({ error: 'payload too large' }, { status: 413 });
    }
    // Stripe signs the exact bytes. Read once with a streaming cap, verify
    // first, and parse only afterwards. Content-Length is only a fast reject;
    // chunked or dishonest requests are bounded by readBoundedRawBody too.
    let rawBody: Uint8Array;
    try {
      rawBody = await readBoundedRawBody(request);
    } catch (error) {
      if (error instanceof WebhookBodyTooLargeError) {
        logPayment('error', { event: 'stripe_webhook_rejected', reason: 'payload_too_large' });
        return Response.json({ error: 'payload too large' }, { status: 413 });
      }
      if (error instanceof WebhookBodyReadTimeoutError) {
        logPayment('error', { event: 'stripe_webhook_rejected', reason: 'body_read_timeout' });
        return Response.json({ error: 'request timeout' }, { status: 408 });
      }
      logPayment('error', { event: 'stripe_webhook_rejected', reason: 'invalid_body' });
      return Response.json({ error: 'invalid body' }, { status: 400 });
    }
    if (rawBody.byteLength > MAX_WEBHOOK_BYTES) {
      logPayment('error', { event: 'stripe_webhook_rejected', reason: 'payload_too_large' });
      return Response.json({ error: 'payload too large' }, { status: 413 });
    }
    try {
      await verifyStripeSignature(rawBody, request.headers.get('stripe-signature'), webhookSecret);
    } catch {
      logPayment('error', { event: 'stripe_webhook_rejected', reason: 'invalid_signature' });
      return Response.json({ error: 'invalid signature' }, { status: 400 });
    }

    let event;
    try {
      event = parseStripeEvent(rawBody);
      if (event.livemode !== (livemode === 'true')) {
        logPayment('error', {
          event: 'stripe_webhook_rejected',
          reason: 'event_mode_mismatch',
          provider_event_id: event.id,
          event_type: event.type,
        });
        return Response.json({ error: 'event mode mismatch' }, { status: 400 });
      }
    } catch {
      logPayment('error', { event: 'stripe_webhook_rejected', reason: 'invalid_event' });
      return Response.json({ error: 'invalid event' }, { status: 400 });
    }

    try {
      const durable = await serviceRoleRpc<{ processing_state?: string }>(
        env,
        'receive_stripe_event',
        {
          target_event_id: event.id,
          event_type: event.type,
          event_created_at: event.created,
          event_livemode: event.livemode,
          order_reference: stripeOrderReference(event),
          event_data: stripeEventData(event),
        },
        fetchImpl,
      );
      if (durable.processing_state === 'completed' || durable.processing_state === 'dead_letter') {
        logPayment('info', {
          event: 'stripe_webhook_accepted',
          provider_event_id: event.id,
          event_type: event.type,
          processing_state: durable.processing_state,
          enqueued: false,
        });
        return Response.json({ received: true });
      }
      await queue.send({ type: 'payment.process', eventId: event.id });
      logPayment('info', {
        event: 'stripe_webhook_accepted',
        provider_event_id: event.id,
        event_type: event.type,
        processing_state: durable.processing_state,
        enqueued: true,
      });
      return Response.json({ received: true });
    } catch {
      logPayment('error', {
        event: 'stripe_webhook_not_durable',
        provider_event_id: event.id,
        event_type: event.type,
      });
      return Response.json({ error: 'event not durable' }, { status: 503 });
    }
  };
}

export default createStripeWebhook();
