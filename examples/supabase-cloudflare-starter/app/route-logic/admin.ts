/**
 * /admin route logic (v0.44): plain module so Deno tests never evaluate the
 * compiled page class. The browser receives no service-role material — these
 * calls use the signed-in user's JWT; SQL independently requires
 * issuer-controlled app_metadata.admin.
 */
import {
  type ActionContext,
  fail,
  type LoaderContext,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
import { type AuthenticatedIdentity, requireAdmin } from '../../lib/authorization.ts';
import { UUID_PATTERN } from '../../lib/service-role.ts';
import { createServerSupabase } from '../../lib/supabase-server.ts';

export interface DeadLetter {
  id: string;
  object_key: string;
  state: 'dead_letter' | 'replay_requested' | 'replayed';
  delivery_count: number;
  first_failed_at: string;
}
export interface PaymentDeadLetter {
  provider_event_id: string;
  event_type: string;
  processing_state: 'dead_letter' | 'replay_requested';
  delivery_count: number;
  dead_lettered_at: string;
}
export interface AdminData {
  email?: string;
  noteCount: number;
  deadLetters: DeadLetter[];
  paymentDeadLetters: PaymentDeadLetter[];
  error?: string;
}
export interface AdminClient {
  auth: {
    getUser(): Promise<{
      data: { user: (AuthenticatedIdentity & { email?: string }) | null };
    }>;
  };
  from(name: string): {
    select(column: string, options: { count: 'exact'; head: true }): Promise<{
      count: number | null;
      error: { message: string } | null;
    }>;
    insert(row: Record<string, unknown>): Promise<{
      error: { message: string } | null;
    }>;
  };
  rpc(name: string, body?: Record<string, string>): Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

export function createAdminLoader(
  createClient: (env: Record<string, string>, request: Request, headers: Headers) => AdminClient =
    createServerSupabase as never,
) {
  return async function adminLoader(
    ctx: LoaderContext<Record<string, string>>,
  ): Promise<AdminData> {
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data: { user } } = await supabase.auth.getUser();
    requireAdmin(user);
    const [{ count, error }, deadLetters, paymentDeadLetters] = await Promise.all([
      supabase.from('notes').select('id', { count: 'exact', head: true }),
      supabase.rpc('list_attachment_scan_dead_letters'),
      supabase.rpc('list_payment_event_dead_letters'),
    ]);
    return {
      email: user?.email,
      noteCount: count ?? 0,
      deadLetters: (deadLetters.data ?? []) as DeadLetter[],
      paymentDeadLetters: (paymentDeadLetters.data ?? []) as PaymentDeadLetter[],
      error: error?.message ?? deadLetters.error?.message ?? paymentDeadLetters.error?.message,
    };
  };
}

export function createPaymentReplayAction(
  createClient: (env: Record<string, string>, request: Request, headers: Headers) => AdminClient =
    createServerSupabase as never,
) {
  return async function replayPayment(
    ctx: ActionContext<Record<string, string>>,
  ): Promise<OpenElementActionFailure<{ error: string }>> {
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data: { user } } = await supabase.auth.getUser();
    requireAdmin(user);
    const eventId = String(ctx.formData.get('event_id') ?? '');
    if (!/^evt_[A-Za-z0-9_]+$/.test(eventId)) {
      return fail(422, { error: 'invalid payment event id' });
    }
    const { error } = await supabase.rpc('request_payment_event_replay', {
      target_event_id: eventId,
    });
    if (error) return fail(422, { error: error.message });
    // The RPC commits the state transition and actor audit in one Postgres
    // transaction (#1127). A second Data API insert would recreate the partial
    // commit this boundary is designed to prevent.
    throw redirect('/admin');
  };
}

export function createReplayAction(
  createClient: (env: Record<string, string>, request: Request, headers: Headers) => AdminClient =
    createServerSupabase as never,
) {
  return async function replay(
    ctx: ActionContext<Record<string, string>>,
  ): Promise<OpenElementActionFailure<{ error: string }>> {
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data: { user } } = await supabase.auth.getUser();
    requireAdmin(user);
    const id = String(ctx.formData.get('id') ?? '');
    if (!UUID_PATTERN.test(id)) {
      return fail(422, { error: 'invalid dead-letter id' });
    }
    const { error } = await supabase.rpc('request_attachment_scan_replay', {
      dead_letter_id: id,
    });
    if (error) return fail(422, { error: error.message });
    // The request RPC owns the append-only actor audit atomically (#1127).
    throw redirect('/admin');
  };
}

/**
 * Request scope → compiled page properties (app/components/page-admin.tsx).
 * Grammar v1 list Regions carry one value slot per item and no per-item
 * forms, so the 0.43 per-row replay forms move to section-level forms posting
 * the id shown in the row (the actions validate the id format regardless).
 */
export function adminPageProps(context: PagePropsContext<AdminData>): Record<string, unknown> {
  const data = context.data;
  const actionData = context.actionData as { error?: string } | undefined;
  return {
    whoText: data?.email ? `signed-in:${data.email}` : '',
    errorText: data?.error ?? '',
    actionErrorText: actionData?.error ?? '',
    noteCountText: `notes:${data?.noteCount ?? 0}`,
    attachmentRows: (data?.deadLetters ?? []).map((item) => ({
      id: item.id,
      line: `${item.object_key} — ${item.state} (deliveries:${item.delivery_count})`,
    })),
    paymentRows: (data?.paymentDeadLetters ?? []).map((item) => ({
      id: item.provider_event_id,
      line:
        `${item.provider_event_id} — ${item.event_type} — ${item.processing_state} (deliveries:${item.delivery_count})`,
    })),
  };
}
