/**
 * /subscribe — valibot validation recipe (0.42.0-alpha.4): same contract as
 * the zod recipe, different library, to prove the loop is library-agnostic.
 * v0.44: markup compiled in components/page-subscribe.tsx.
 */
import {
  definePage,
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/router';
import * as v from 'valibot';
import SubscribePage from '../components/page-subscribe.tsx';

const subscribeSchema = v.object({
  email: v.pipe(v.string(), v.email('a valid email is required')),
});

interface SubscribeActionData {
  error?: string;
  email?: string;
}

export function action(ctx: { formData: FormData }): OpenElementActionFailure<SubscribeActionData> {
  const email = String(ctx.formData.get('email') ?? '');
  const parsed = v.safeParse(subscribeSchema, { email });
  if (!parsed.success) {
    return fail(422, {
      error: parsed.issues[0]?.message ?? 'invalid input',
      email,
    });
  }
  throw redirect(`/subscribe?welcome=${encodeURIComponent(parsed.output.email)}`);
}

export default definePage(SubscribePage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — subscribe (valibot)' },
  props(context: PagePropsContext) {
    const actionData = context.actionData as SubscribeActionData | undefined;
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
