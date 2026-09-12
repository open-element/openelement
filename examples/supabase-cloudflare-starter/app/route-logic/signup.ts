/**
 * /signup route logic (v0.44): plain module so Deno tests never evaluate the
 * compiled page class. The route module (app/routes/signup.tsx) is the thin
 * wrapper.
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

export interface SignupActionData {
  error?: string;
  email?: string;
}
export interface SignupLoaderData {
  sent: boolean;
}

export function signupLoader(ctx: { request: Request }): SignupLoaderData {
  return { sent: new URL(ctx.request.url).searchParams.has('sent') };
}

export interface SignupAuthClient {
  auth: {
    signUp(credentials: {
      email: string;
      password: string;
      options: { emailRedirectTo: string };
    }): PromiseLike<{
      data: { session: unknown };
      error: { message: string } | null;
    }>;
  };
}
export type SignupClientFactory = (
  env: RateLimitEnv,
  request: Request,
  responseHeaders: Headers,
) => SignupAuthClient;

export function createSignupAction(createClient: SignupClientFactory = createServerSupabase) {
  return async function action(ctx: {
    formData: FormData;
    env: RateLimitEnv;
    request: Request;
    responseHeaders: Headers;
  }): Promise<OpenElementActionFailure<SignupActionData>> {
    if (!(await authRequestAllowed(ctx.env, ctx.request, 'signup'))) {
      return fail(429, { error: 'too many attempts; retry later' });
    }
    const email = String(ctx.formData.get('email') ?? '').trim();
    const password = String(ctx.formData.get('password') ?? '');
    const next = safeInternalNext(String(ctx.formData.get('next') ?? '/notes'));
    if (!email || password.length < 8) {
      return fail(422, { error: 'email and an 8+ character password are required', email });
    }
    const callback = new URL('/auth/callback', ctx.request.url);
    callback.searchParams.set('next', next);
    const { data, error } = await createClient(ctx.env, ctx.request, ctx.responseHeaders).auth
      .signUp({
        email,
        password,
        options: { emailRedirectTo: callback.href },
      });
    if (error) return fail(422, { error: publicAuthError(error), email });
    if (data.session) throw redirect(next);
    // Success is PRG (#1060): fail() accepts only 4xx, so the confirmation
    // state lives behind ?sent=1 instead of a 200 fail().
    throw redirect('/signup?sent=1');
  };
}

/** Request scope → compiled page properties (app/components/page-signup.tsx). */
export function signupPageProps(
  context: PagePropsContext<SignupLoaderData>,
): Record<string, unknown> {
  const result = context.actionData as SignupActionData | undefined;
  return {
    errorText: result?.error ?? '',
    email: result?.email ?? '',
    sent: context.data?.sent ? 1 : 0,
  };
}
