import { expect, test } from 'vitest';
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

test('Checkout configuration requires an exact application origin', () => {
  expect(checkoutConfiguration(env).appOrigin).toEqual('https://app.test');
  for (const origin of [
    'https://app.test/path',
    'http://app.test',
    'https://app.test/',
    'ftp://localhost',
  ]) {
    expect(() => checkoutConfiguration({ ...env, APP_ORIGIN: origin })).toThrow();
  }
  expect(() => checkoutConfiguration({ ...env, STRIPE_SECRET_KEY: 'sk_live_wrong' })).toThrow();
  expect(
    checkoutConfiguration({ ...env, STRIPE_SECRET_KEY: 'rk_test_restricted' }).livemode,
  ).toEqual(false);
  expect(
    checkoutConfiguration({
      ...env,
      STRIPE_LIVEMODE: 'true',
      STRIPE_SECRET_KEY: 'rk_live_restricted',
    }).livemode,
  ).toEqual(true);
  expect(() =>
    checkoutConfiguration({ ...env, STRIPE_CHECKOUT_HOST: 'evil.example/path' }),
  ).toThrow();
});

test('Checkout request uses dynamic methods and remains webhook-correlated', () => {
  const body = checkoutSessionBody(checkoutConfiguration(env), 'order-1', 'abcdefgh');
  expect(body.get('mode')).toEqual('payment');
  expect([...body.keys()].some((key) => key.startsWith('payment_method_types'))).toEqual(false);
  expect(body.has('managed_payments[enabled]')).toEqual(false);
  expect(body.get('integration_identifier')).toEqual('openelement_reference_abcdefgh');
  expect(body.get('line_items[0][price]')).toEqual('price_fixed');
  expect(body.get('metadata[order_id]')).toEqual('order-1');
  expect(body.get('payment_intent_data[metadata][order_id]')).toEqual('order-1');
  expect(body.get('success_url')).toEqual('https://app.test/checkout?result=success');
  expect(STRIPE_API_VERSION).toEqual('2026-07-29.dahlia');
});

test('Checkout retries serialize an identical body for one persisted attempt', () => {
  const config = checkoutConfiguration(env);
  const attemptId = '123e4567-e89b-42d3-a456-426614174000';
  const suffix = checkoutIntegrationSuffix(attemptId);
  const first = checkoutSessionBody(config, 'order-1', suffix).toString();
  const second = checkoutSessionBody(
    config,
    'order-1',
    checkoutIntegrationSuffix(attemptId),
  ).toString();
  expect(/^[a-z]{8}$/.test(suffix)).toEqual(true);
  expect(second).toEqual(first);
  expect(checkoutIntegrationSuffix('123e4567-e89b-42d3-a456-426614174001') === suffix).toEqual(
    false,
  );
});

test('Checkout redirect accepts only the configured HTTPS host', () => {
  expect(
    verifiedCheckoutUrl('https://checkout.stripe.com/c/pay/test', 'checkout.stripe.com'),
  ).toEqual('https://checkout.stripe.com/c/pay/test');
  for (const url of ['http://checkout.stripe.com/x', 'https://evil.example/x', 'not-a-url']) {
    expect(() => verifiedCheckoutUrl(url, 'checkout.stripe.com')).toThrow();
  }
});
