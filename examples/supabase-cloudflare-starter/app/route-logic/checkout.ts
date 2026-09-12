/**
 * /checkout route logic (v0.44): one-time Stripe Checkout with idempotent
 * order reservation. Plain module so Deno tests never evaluate the compiled
 * page class.
 */
import {
  type ActionContext,
  fail,
  type LoaderContext,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
import { createServerSupabase } from '../../lib/supabase-server.ts';
import { serviceRoleRpc } from '../../lib/service-role.ts';
import {
  checkoutConfiguration,
  checkoutIntegrationSuffix,
  checkoutSessionBody,
  STRIPE_API_VERSION,
  verifiedCheckoutUrl,
} from '../../lib/stripe-checkout.ts';

const PRODUCT_CODE = 'starter-support';

export interface CheckoutData {
  denied: boolean;
  attemptId?: string;
  result?: 'success' | 'cancelled';
  orders?: { id: string; status: string; amount_total: number; currency: string }[];
  error?: string;
}

export interface CheckoutActionData {
  error?: string;
  attemptId?: string;
}

export interface CheckoutSupabaseClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } }> };
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: 'orders'): {
    select(columns: string): {
      order(column: string, options: { ascending: boolean }): PromiseLike<{
        data: CheckoutData['orders'] | null;
        error: { message: string } | null;
      }>;
    };
  };
}

type ClientFactory = (
  env: Record<string, unknown>,
  request: Request,
  responseHeaders: Headers,
) => CheckoutSupabaseClient;

type Fetch = typeof fetch;

function safeResult(request: Request): CheckoutData['result'] {
  const result = new URL(request.url).searchParams.get('result');
  return result === 'success' || result === 'cancelled' ? result : undefined;
}

export function createCheckoutLoader(createClient: ClientFactory = createServerSupabase) {
  return async function loader(ctx: LoaderContext<Record<string, unknown>>): Promise<CheckoutData> {
    const client = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw redirect('/login');
    const { data, error } = await client.from('orders')
      .select('id,status,amount_total,currency')
      .order('created_at', { ascending: false });
    return {
      denied: false,
      attemptId: crypto.randomUUID(),
      result: safeResult(ctx.request),
      orders: data ?? [],
      error: error?.message,
    };
  };
}

export function createCheckoutAction(
  createClient: ClientFactory = createServerSupabase,
  fetchImpl: Fetch = fetch,
) {
  return async function checkout(
    ctx: ActionContext<Record<string, unknown>>,
  ): Promise<OpenElementActionFailure<CheckoutActionData>> {
    const attemptId = String(ctx.formData.get('attempt_id') ?? '');
    // Deliberately stricter than the shared UUID_PATTERN (v1–v5): attempt ids
    // are always client-generated v4 UUIDs from the loader's crypto.randomUUID().
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) {
      return fail(422, { error: 'invalid checkout attempt' });
    }
    const client = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data: { user } } = await client.auth.getUser();
    if (!user) return fail(401, { error: 'sign-in required to checkout', attemptId });

    const reserved = await client.rpc('create_checkout_order', {
      product_code: PRODUCT_CODE,
      checkout_attempt: attemptId,
    });
    if (reserved.error || typeof reserved.data !== 'string') {
      return fail(409, { error: 'checkout is temporarily unavailable; retry safely', attemptId });
    }

    let config;
    try {
      config = checkoutConfiguration(ctx.env);
    } catch {
      return fail(409, { error: 'checkout is temporarily unavailable; retry safely', attemptId });
    }
    const orderId = reserved.data;
    let checkoutUrl: string;
    try {
      const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          'idempotency-key': `checkout-${attemptId}`,
          'stripe-version': STRIPE_API_VERSION,
        },
        body: checkoutSessionBody(config, orderId, checkoutIntegrationSuffix(attemptId)),
      });
      if (!response.ok) throw new Error('Stripe Checkout creation failed');
      const session = await response.json() as { id?: unknown; url?: unknown; livemode?: unknown };
      if (
        typeof session.id !== 'string' || session.livemode !== config.livemode ||
        typeof session.url !== 'string'
      ) throw new Error('Stripe Checkout response mismatch');
      // Throws on non-2xx/missing config, landing in the catch below just
      // like the former boolean serviceRpc's `!attached` branch did.
      await serviceRoleRpc(ctx.env, 'attach_checkout_session', {
        order_id: orderId,
        checkout_session_id: session.id,
      }, fetchImpl);
      checkoutUrl = verifiedCheckoutUrl(session.url, config.checkoutHost);
    } catch {
      // Best-effort compensation; a failed mark must not mask the 409.
      await serviceRoleRpc(
        ctx.env,
        'mark_checkout_creation_failed',
        { order_id: orderId },
        fetchImpl,
      )
        .catch(() => {});
      return fail(409, { error: 'checkout is temporarily unavailable; retry safely', attemptId });
    }
    throw redirect(checkoutUrl);
  };
}

/**
 * Request scope → compiled page properties (app/components/page-checkout.tsx).
 * The result banner branches are fully static conditional Regions; the orders
 * list composes one display line per row (grammar v1 list Regions carry one
 * value slot per item).
 */
export function checkoutPageProps(
  context: PagePropsContext<CheckoutData>,
): Record<string, unknown> {
  const data = context.data;
  const actionData = context.actionData as CheckoutActionData | undefined;
  return {
    actionErrorText: actionData?.error ?? '',
    attemptId: actionData?.attemptId ?? data?.attemptId ?? '',
    resultSuccess: data?.result === 'success' ? 1 : 0,
    resultCancelled: data?.result === 'cancelled' ? 1 : 0,
    orderRows: (data?.orders ?? []).map((order) => ({
      id: order.id,
      line: `${order.currency.toUpperCase()} ${
        (order.amount_total / 100).toFixed(2)
      } — ${order.status}`,
    })),
  };
}
