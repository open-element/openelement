/**
 * /register — zod validation recipe (0.42.0-alpha.4): the action validates
 * with zod inside the route action; framework stays validation-agnostic.
 * v0.44: markup compiled in components/page-register.tsx.
 */
import {
  definePage,
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/router';
import { z } from 'zod';
import RegisterPage from '../components/page-register.tsx';

const registerSchema = z.object({
  email: z.string().email('a valid email is required'),
});

interface RegisterActionData {
  error?: string;
  email?: string;
}

export function action(ctx: { formData: FormData }): OpenElementActionFailure<RegisterActionData> {
  const parsed = registerSchema.safeParse({ email: String(ctx.formData.get('email') ?? '') });
  if (!parsed.success) {
    return fail(422, {
      error: parsed.error.issues[0]?.message ?? 'invalid input',
      email: String(ctx.formData.get('email') ?? ''),
    });
  }
  throw redirect(`/register?welcome=${encodeURIComponent(parsed.data.email)}`);
}

export default definePage(RegisterPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — register (zod)' },
  props(context: PagePropsContext) {
    const actionData = context.actionData as RegisterActionData | undefined;
    const welcome = context.request
      ? new URL(context.request.url).searchParams.get('welcome')
      : undefined;
    return {
      email: actionData?.email ?? '',
      welcomeText: `welcome=${welcome ?? ''}`,
      hasError: actionData?.error ? 1 : 0,
    };
  },
});
