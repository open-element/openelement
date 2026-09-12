/**
 * /magic-link route logic (v0.44): plain module so Deno tests never evaluate
 * the compiled page class. The route module (app/routes/magic-link.tsx) is
 * the thin wrapper.
 */
import {
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
import { publicAuthError, safeInternalNext } from '../../lib/auth-security.ts';
import { createServerSupabase } from '../../lib/supabase-server.ts';
import { authRequestAllowed, type RateLimitEnv } from '../../lib/rate-limit.ts';

export interface MagicLinkActionData {
  error?: string;
  email?: string;
}
export interface MagicLinkLoaderData {
  sent: boolean;
}

export function magicLinkLoader(ctx: { request: Request }): MagicLinkLoaderData {
  return { sent: new URL(ctx.request.url).searchParams.has('sent') };
}

export interface MagicLinkAuthClient {
  auth: {
    signInWithOtp(credentials: {
      email: string;
      options: { emailRedirectTo: string };
    }): PromiseLike<{ error: { message: string } | null }>;
  };
}
export type MagicLinkClientFactory = (
  env: RateLimitEnv,
  request: Request,
  responseHeaders: Headers,
) => MagicLinkAuthClient;
export function createMagicLinkAction(createClient: MagicLinkClientFactory = createServerSupabase) {
  return async function action(
    ctx: {
      formData: FormData;
      env: RateLimitEnv;
      request: Request;
      responseHeaders: Headers;
    },
  ): Promise<OpenElementActionFailure<MagicLinkActionData>> {
    if (!(await authRequestAllowed(ctx.env, ctx.request, 'magic-link'))) {
      return fail(429, { error: 'too many attempts; retry later' });
    }
    const email = String(ctx.formData.get('email') ?? '').trim();
    if (!email) return fail(422, { error: 'email is required' });
    const callback = new URL('/auth/callback', ctx.request.url);
    callback.searchParams.set(
      'next',
      safeInternalNext(String(ctx.formData.get('next') ?? '/notes')),
    );
    const { error } = await createClient(ctx.env, ctx.request, ctx.responseHeaders).auth
      .signInWithOtp({ email, options: { emailRedirectTo: callback.href } });
    if (error) return fail(422, { error: publicAuthError(error), email });
    // Success is PRG (#1060): fail() accepts only 4xx, so the confirmation
    // state lives behind ?sent=1 instead of a 200 fail().
    throw redirect('/magic-link?sent=1');
  };
}

/** Request scope → compiled page properties (app/components/page-magic-link.tsx). */
export function magicLinkPageProps(
  context: PagePropsContext<MagicLinkLoaderData>,
): Record<string, unknown> {
  const result = context.actionData as MagicLinkActionData | undefined;
  return {
    errorText: result?.error ?? '',
    email: result?.email ?? '',
    sent: context.data?.sent ? 1 : 0,
  };
}
