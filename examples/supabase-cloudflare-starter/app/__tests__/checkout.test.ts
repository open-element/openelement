import { assert, assertEquals, assertRejects } from '@std/assert';
import { isActionFailure, isOpenElementRedirect } from '@openelement/app';

// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// compiled page class (decorators are compile-time-only input).
const { createCheckoutAction, createCheckoutLoader } = await import(
  '../route-logic/checkout.ts'
);
type CheckoutSupabaseClient = import('../route-logic/checkout.ts').CheckoutSupabaseClient;

const ATTEMPT = '147f2ee7-289a-4da4-8a2b-6f930d1d5c47';
const ORDER = '0a32b472-7252-4b02-a86a-7b459c639a71';
const STRIPE_CHECKOUT_API = 'https://api.stripe.com/v1/checkout/sessions';

function client(
  options: { user?: boolean; rpcError?: boolean } = {},
): () => CheckoutSupabaseClient {
  return () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: options.user === false ? null : { id: 'user-1' } },
        }),
    },
    rpc: () =>
      Promise.resolve({
        data: options.rpcError ? null : ORDER,
        error: options.rpcError ? { message: 'unavailable' } : null,
      }),
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
    }),
  });
}

function context(url = 'https://app.test/checkout') {
  return {
    request: new Request(url),
    params: {},
    responseHeaders: new Headers(),
    platform: undefined,
    route: { path: '/checkout', filePath: 'app/routes/checkout.tsx' },
    env: {
      APP_ORIGIN: 'https://app.test',
      STRIPE_SECRET_KEY: 'sk_test_server',
      STRIPE_PRICE_ID: 'price_fixed',
      STRIPE_LIVEMODE: 'false',
      STRIPE_CHECKOUT_HOST: 'checkout.stripe.com',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-only',
    },
  };
}

function form(attempt = ATTEMPT): FormData {
  const value = new FormData();
  value.set('attempt_id', attempt);
  value.set('price_id', 'price_attacker_controlled');
  return value;
}

Deno.test('Checkout loader is owner-scoped and success return grants no new state', async () => {
  // v0.44: anonymous GETs redirect to sign-in (the 0.43 denied branch paired
  // with a dynamic authenticated variant is outside the compiler grammar).
  const denied = await assertRejects(() =>
    createCheckoutLoader(client({ user: false }))(context())
  );
  assert(isOpenElementRedirect(denied));
  assertEquals((denied as { location?: string }).location, '/login');
  const returned = await createCheckoutLoader(client())(
    context('https://app.test/checkout?result=success'),
  );
  assertEquals(returned.denied, false);
  assertEquals(returned.result, 'success');
  assert(returned.attemptId);
});

Deno.test('Checkout rejects anonymous and invalid attempts before Stripe', async () => {
  let calls = 0;
  const fetchStub: typeof fetch = () => {
    calls++;
    return Promise.resolve(new Response());
  };
  const invalid = await createCheckoutAction(client(), fetchStub)({
    ...context(),
    formData: form('attacker'),
  });
  assert(isActionFailure(invalid));
  assertEquals(invalid.status, 422);
  const anonymous = await createCheckoutAction(client({ user: false }), fetchStub)({
    ...context(),
    formData: form(),
  });
  assert(isActionFailure(anonymous));
  assertEquals(anonymous.status, 401);
  assertEquals(calls, 0);
});

Deno.test('Checkout uses fixed server price, idempotency and persists session before redirect', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchStub: typeof fetch = (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === STRIPE_CHECKOUT_API) {
      return Promise.resolve(Response.json({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/pay/test',
        livemode: false,
      }));
    }
    return Promise.resolve(Response.json(null));
  };
  const error = await assertRejects(() =>
    createCheckoutAction(client(), fetchStub)({ ...context(), formData: form() })
  );
  assert(isOpenElementRedirect(error));
  assertEquals(error.location, 'https://checkout.stripe.com/c/pay/test');
  const stripe = calls[0];
  const body = stripe.init?.body as URLSearchParams;
  assertEquals(body.get('line_items[0][price]'), 'price_fixed');
  assertEquals(body.get('metadata[order_id]'), ORDER);
  assertEquals(body.get('payment_intent_data[metadata][order_id]'), ORDER);
  assertEquals(new Headers(stripe.init?.headers).get('idempotency-key'), `checkout-${ATTEMPT}`);
  assertEquals(new Headers(stripe.init?.headers).get('stripe-version'), '2026-07-29.dahlia');
  assertEquals(body.get('payment_method_types[0]'), null);
  assertEquals(body.get('managed_payments[enabled]'), null);
  assertEquals(body.get('integration_identifier')?.startsWith('openelement_reference_'), true);
  assertEquals(calls[1].url.endsWith('/rpc/attach_checkout_session'), true);
});

Deno.test('Checkout fails closed on unexpected redirect host and records creation failure', async () => {
  const rpcNames: string[] = [];
  const fetchStub: typeof fetch = (input) => {
    const url = String(input);
    if (url === STRIPE_CHECKOUT_API) {
      return Promise.resolve(Response.json({
        id: 'cs_test_123',
        url: 'https://evil.example/collect',
        livemode: false,
      }));
    }
    rpcNames.push(url.split('/').pop() ?? '');
    return Promise.resolve(Response.json(null));
  };
  const result = await createCheckoutAction(client(), fetchStub)({
    ...context(),
    formData: form(),
  });
  assert(isActionFailure(result));
  assertEquals(result.status, 409);
  assertEquals(rpcNames, ['attach_checkout_session', 'mark_checkout_creation_failed']);
});
