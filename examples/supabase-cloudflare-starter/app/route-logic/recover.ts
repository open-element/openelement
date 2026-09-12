/**
 * /recover route logic (v0.44): the loader/action live in this plain module
 * so Deno tests can import them without evaluating the compiled page class
 * (decorators are compile-time-only input and throw outside the adapter
 * transform). The route module (app/routes/recover.tsx) is the thin wrapper.
 */
import {
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
import { publicAuthError } from '../../lib/auth-security.ts';
import { createServerSupabase } from '../../lib/supabase-server.ts';
import { authRequestAllowed, type RateLimitEnv } from '../../lib/rate-limit.ts';

export interface RecoverActionData {
  error?: string;
}
export interface RecoverLoaderData {
  sent: boolean;
}

export function recoverLoader(ctx: { request: Request }): RecoverLoaderData {
  return { sent: new URL(ctx.request.url).searchParams.has('sent') };
}

export interface RecoverAuthClient {
  auth: {
    resetPasswordForEmail(
      email: string,
      options: { redirectTo: string },
    ): PromiseLike<{ error: { message: string } | null }>;
  };
}
export type RecoverClientFactory = (
  env: RateLimitEnv,
  request: Request,
  responseHeaders: Headers,
) => RecoverAuthClient;
export function createRecoverAction(createClient: RecoverClientFactory = createServerSupabase) {
  return async function action(
    ctx: {
      formData: FormData;
      env: RateLimitEnv;
      request: Request;
      responseHeaders: Headers;
    },
  ): Promise<OpenElementActionFailure<RecoverActionData>> {
    if (!(await authRequestAllowed(ctx.env, ctx.request, 'recovery'))) {
      return fail(429, { error: 'too many attempts; retry later' });
    }
    const email = String(ctx.formData.get('email') ?? '').trim();
    if (!email) return fail(422, { error: 'email is required' });
    const redirectTo = new URL('/auth/callback?next=/reset-password', ctx.request.url).href;
    const { error } = await createClient(ctx.env, ctx.request, ctx.responseHeaders).auth
      .resetPasswordForEmail(email, { redirectTo });
    if (error) return fail(422, { error: publicAuthError(error) });
    // Success is PRG (#1060): fail() accepts only 4xx, so the confirmation
    // state lives behind ?sent=1 instead of a 200 fail().
    throw redirect('/recover?sent=1');
  };
}

/**
 * The deterministic seam mapping request scope onto the compiled page
 * properties (app/components/page-recover.tsx).
 */
export function recoverPageProps(
  context: PagePropsContext<RecoverLoaderData>,
): Record<string, unknown> {
  const result = context.actionData as RecoverActionData | undefined;
  return {
    errorText: result?.error ?? '',
    sent: context.data?.sent ? 1 : 0,
  };
}
