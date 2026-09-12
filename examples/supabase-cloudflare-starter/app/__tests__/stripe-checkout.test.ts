import { assertEquals, assertThrows } from '@std/assert';
import {
  checkoutConfiguration,
  checkoutIntegrationSuffix,
  checkoutSessionBody,
  STRIPE_API_VERSION,
  verifiedCheckoutUrl,
} from '../../lib/stripe-checkout.ts';

const env = {
  APP_ORIGIN: 'https://app.test',
  STRIPE_SECRET_KEY: 'sk_test_server',
  STRIPE_PRICE_ID: 'price_fixed',
  STRIPE_LIVEMODE: 'false',
};

Deno.test('Checkout configuration requires an exact application origin', () => {
  assertEquals(checkoutConfiguration(env).appOrigin, 'https://app.test');
  for (
    const origin of [
      'https://app.test/path',
      'http://app.test',
      'https://app.test/',
      'ftp://localhost',
    ]
  ) {
    assertThrows(() => checkoutConfiguration({ ...env, APP_ORIGIN: origin }));
  }
  assertThrows(() => checkoutConfiguration({ ...env, STRIPE_SECRET_KEY: 'sk_live_wrong' }));
  assertEquals(
    checkoutConfiguration({ ...env, STRIPE_SECRET_KEY: 'rk_test_restricted' }).livemode,
    false,
  );
  assertEquals(
    checkoutConfiguration({
      ...env,
      STRIPE_LIVEMODE: 'true',
      STRIPE_SECRET_KEY: 'rk_live_restricted',
    })
      .livemode,
    true,
  );
  assertThrows(() => checkoutConfiguration({ ...env, STRIPE_CHECKOUT_HOST: 'evil.example/path' }));
});

Deno.test('Checkout request uses dynamic methods and remains webhook-correlated', () => {
  const body = checkoutSessionBody(checkoutConfiguration(env), 'order-1', 'abcdefgh');
  assertEquals(body.get('mode'), 'payment');
  assertEquals([...body.keys()].some((key) => key.startsWith('payment_method_types')), false);
  assertEquals(body.has('managed_payments[enabled]'), false);
  assertEquals(body.get('integration_identifier'), 'openelement_reference_abcdefgh');
  assertEquals(body.get('line_items[0][price]'), 'price_fixed');
  assertEquals(body.get('metadata[order_id]'), 'order-1');
  assertEquals(body.get('payment_intent_data[metadata][order_id]'), 'order-1');
  assertEquals(body.get('success_url'), 'https://app.test/checkout?result=success');
  assertEquals(STRIPE_API_VERSION, '2026-07-29.dahlia');
});

Deno.test('Checkout retries serialize an identical body for one persisted attempt', () => {
  const config = checkoutConfiguration(env);
  const attemptId = '123e4567-e89b-42d3-a456-426614174000';
  const suffix = checkoutIntegrationSuffix(attemptId);
  const first = checkoutSessionBody(config, 'order-1', suffix).toString();
  const second = checkoutSessionBody(config, 'order-1', checkoutIntegrationSuffix(attemptId))
    .toString();
  assertEquals(/^[a-z]{8}$/.test(suffix), true);
  assertEquals(second, first);
  assertEquals(
    checkoutIntegrationSuffix('123e4567-e89b-42d3-a456-426614174001') === suffix,
    false,
  );
});

Deno.test('Checkout redirect accepts only the configured HTTPS host', () => {
  assertEquals(
    verifiedCheckoutUrl('https://checkout.stripe.com/c/pay/test', 'checkout.stripe.com'),
    'https://checkout.stripe.com/c/pay/test',
  );
  for (const url of ['http://checkout.stripe.com/x', 'https://evil.example/x', 'not-a-url']) {
    assertThrows(() => verifiedCheckoutUrl(url, 'checkout.stripe.com'));
  }
});
