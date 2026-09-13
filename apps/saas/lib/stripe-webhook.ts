const DEFAULT_TOLERANCE_SECONDS = 300;

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

type RawStripeBody = string | Uint8Array;

function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === 'v1' && /^[a-fA-F0-9]{64}$/.test(value)) signatures.push(value.toLowerCase());
  }
  if (!Number.isSafeInteger(timestamp) || !signatures.length) {
    throw new Error('malformed Stripe-Signature header');
  }
  return { timestamp: timestamp!, signatures };
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

function decodeHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function verifyStripeSignature(
  rawBody: RawStripeBody,
  header: string | null,
  secret: string,
  options: { nowSeconds?: number; toleranceSeconds?: number } = {},
): Promise<void> {
  if (!header || !secret) throw new Error('missing Stripe webhook signature configuration');
  const { timestamp, signatures } = parseSignatureHeader(header);
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(tolerance) || tolerance < 0) {
    throw new Error('invalid Stripe webhook clock configuration');
  }
  if (Math.abs(now - timestamp) > tolerance) throw new Error('Stripe signature timestamp expired');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bodyBytes = typeof rawBody === 'string' ? new TextEncoder().encode(rawBody) : rawBody;
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const signedPayload = new Uint8Array(prefix.length + bodyBytes.length);
  signedPayload.set(prefix);
  signedPayload.set(bodyBytes, prefix.length);
  const expected = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      signedPayload,
    ),
  );
  if (!signatures.some((candidate) => constantTimeEqual(expected, decodeHex(candidate)))) {
    throw new Error('Stripe signature mismatch');
  }
}

export function parseStripeEvent(rawBody: RawStripeBody): StripeEvent {
  const json = typeof rawBody === 'string'
    ? rawBody
    : new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object') throw new Error('invalid Stripe event');
  const event = value as Partial<StripeEvent>;
  if (
    typeof event.id !== 'string' || !event.id.startsWith('evt_') ||
    typeof event.type !== 'string' || !Number.isSafeInteger(event.created) ||
    typeof event.livemode !== 'boolean' || !event.data ||
    typeof event.data.object !== 'object' || event.data.object === null
  ) throw new Error('invalid Stripe event');
  return event as StripeEvent;
}

export function stripeOrderReference(event: StripeEvent): string | null {
  const object = event.data.object;
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const orderId = (metadata as Record<string, unknown>).order_id;
  return typeof orderId === 'string' ? orderId : null;
}

/** Retain only state-machine inputs; never persist the full provider/customer payload. */
export function stripeEventData(event: StripeEvent): Record<string, unknown> {
  const object = event.data.object;
  const data: Record<string, unknown> = {};
  for (const key of ['id', 'payment_status', 'amount_total', 'currency', 'payment_intent']) {
    const value = object[key];
    if (typeof value === 'string' || typeof value === 'number' || value === null) data[key] = value;
  }
  return data;
}
