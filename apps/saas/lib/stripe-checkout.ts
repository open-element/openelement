export interface CheckoutConfiguration {
  secretKey: string;
  priceId: string;
  appOrigin: string;
  checkoutHost: string;
  livemode: boolean;
}

export const STRIPE_API_VERSION = '2026-07-29.dahlia';
export const STRIPE_INTEGRATION_PREFIX = 'openelement_reference_';

function required(env: Record<string, unknown>, name: string): string {
  const value = env[name];
  if (typeof value !== 'string' || !value) throw new Error(`missing ${name}`);
  return value;
}

export function checkoutConfiguration(env: Record<string, unknown>): CheckoutConfiguration {
  const appOrigin = required(env, 'APP_ORIGIN');
  const origin = new URL(appOrigin);
  const allowedProtocol = origin.protocol === 'https:' ||
    (origin.protocol === 'http:' && origin.hostname === 'localhost');
  if (origin.origin !== appOrigin || !allowedProtocol) {
    throw new Error('APP_ORIGIN must be an exact secure origin');
  }
  const livemode = required(env, 'STRIPE_LIVEMODE');
  if (!['true', 'false'].includes(livemode)) throw new Error('invalid STRIPE_LIVEMODE');
  const secretKey = required(env, 'STRIPE_SECRET_KEY');
  const allowedPrefixes = livemode === 'true' ? ['rk_live_', 'sk_live_'] : ['rk_test_', 'sk_test_'];
  if (!allowedPrefixes.some((prefix) => secretKey.startsWith(prefix))) {
    throw new Error('Stripe secret key mode mismatch');
  }
  const checkoutHost = typeof env.STRIPE_CHECKOUT_HOST === 'string' && env.STRIPE_CHECKOUT_HOST
    ? env.STRIPE_CHECKOUT_HOST
    : 'checkout.stripe.com';
  if (new URL(`https://${checkoutHost}`).hostname !== checkoutHost) {
    throw new Error('STRIPE_CHECKOUT_HOST must be an exact hostname');
  }
  return {
    secretKey,
    priceId: required(env, 'STRIPE_PRICE_ID'),
    appOrigin,
    checkoutHost,
    livemode: livemode === 'true',
  };
}

export function checkoutSessionBody(
  config: CheckoutConfiguration,
  orderId: string,
  integrationSuffix: string,
): URLSearchParams {
  if (!/^[a-z]{8}$/.test(integrationSuffix)) throw new Error('invalid integration suffix');
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('integration_identifier', `${STRIPE_INTEGRATION_PREFIX}${integrationSuffix}`);
  body.set('line_items[0][price]', config.priceId);
  body.set('line_items[0][quantity]', '1');
  body.set('client_reference_id', orderId);
  body.set('metadata[order_id]', orderId);
  body.set('payment_intent_data[metadata][order_id]', orderId);
  body.set('success_url', `${config.appOrigin}/checkout?result=success`);
  body.set('cancel_url', `${config.appOrigin}/checkout?result=cancelled`);
  return body;
}

export function checkoutIntegrationSuffix(attemptId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) {
    throw new Error('invalid checkout attempt id');
  }
  // The persisted v4 UUID already contains cryptographically random attempt
  // entropy. Reducing it into base 26 keeps Stripe's eight-letter label while
  // making every retry of one attempt serialize the exact same request body.
  let value = BigInt(`0x${attemptId.replaceAll('-', '')}`);
  let suffix = '';
  for (let index = 0; index < 8; index++) {
    suffix += String.fromCharCode(97 + Number(value % 26n));
    value /= 26n;
  }
  return suffix;
}

export function verifiedCheckoutUrl(value: unknown, expectedHost: string): string {
  if (typeof value !== 'string') throw new Error('Stripe did not return a Checkout URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.username || url.password) {
    throw new Error('Stripe returned an unexpected Checkout URL');
  }
  return url.href;
}
