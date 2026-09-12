/**
 * /auth/callback route logic (v0.44): plain module so Deno tests never
 * evaluate the compiled page class. The route module
 * (app/routes/auth/callback.tsx) is the thin wrapper.
 */
import { type PagePropsContext, redirect } from '@openelement/app';
import { publicAuthError, safeInternalNext } from '../../lib/auth-security.ts';
import { createServerSupabase } from '../../lib/supabase-server.ts';

export interface CallbackData {
  error?: string;
}
export interface CallbackAuthClient {
  auth: {
    exchangeCodeForSession(code: string): PromiseLike<{ error: { message: string } | null }>;
  };
}
export type CallbackClientFactory = (
  env: Record<string, unknown>,
  request: Request,
  responseHeaders: Headers,
) => CallbackAuthClient;
export function createCallbackLoader(createClient: CallbackClientFactory = createServerSupabase) {
  return async function loader(ctx: {
    env: Record<string, unknown>;
    request: Request;
    responseHeaders: Headers;
  }): Promise<CallbackData> {
    const url = new URL(ctx.request.url);
    const code = url.searchParams.get('code');
    if (!code) return { error: publicAuthError('missing code') };
    const { error } = await createClient(ctx.env, ctx.request, ctx.responseHeaders).auth
      .exchangeCodeForSession(code);
    if (error) return { error: publicAuthError(error) };
    throw redirect(safeInternalNext(url.searchParams.get('next')));
  };
}

/** Request scope → compiled page properties (app/components/page-auth-callback.tsx). */
export function callbackPageProps(
  context: PagePropsContext<CallbackData>,
): Record<string, unknown> {
  return { errorText: context.data?.error ?? 'Completing sign-in…' };
}
