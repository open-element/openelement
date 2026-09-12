/**
 * /reset-password route logic (v0.44): plain module, consistent with the
 * other route-logic modules (the route module never holds logic).
 */
import {
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
import { publicAuthError } from '../../lib/auth-security.ts';
import { createServerSupabase } from '../../lib/supabase-server.ts';

export interface ResetPasswordActionData {
  error?: string;
}

export async function resetPasswordAction(
  ctx: {
    formData: FormData;
    env: Record<string, string>;
    request: Request;
    responseHeaders: Headers;
  },
): Promise<OpenElementActionFailure<ResetPasswordActionData>> {
  const password = String(ctx.formData.get('password') ?? '');
  if (password.length < 8) return fail(422, { error: 'an 8+ character password is required' });
  const supabase = createServerSupabase(ctx.env, ctx.request, ctx.responseHeaders);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(401, { error: 'request a new recovery link' });
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(422, { error: publicAuthError(error) });
  throw redirect('/notes');
}

/** Request scope → compiled page properties (app/components/page-reset-password.tsx). */
export function resetPasswordPageProps(
  context: PagePropsContext<unknown>,
): Record<string, unknown> {
  const result = context.actionData as ResetPasswordActionData | undefined;
  return { errorText: result?.error ?? '' };
}
