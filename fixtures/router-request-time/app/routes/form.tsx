/**
 * /form — request-time page exercising the ADR-0120 action protocol:
 * - empty submission -> fail(422, data) -> 422 re-render with the echo;
 * - valid submission -> redirect (PRG) with the value in the URL;
 * - named action 'shout' via formaction='?/shout'.
 * v0.44: markup is the compiled Part Program in components/page-form.tsx;
 * the props projector maps action data + the ?echoed= param onto the page's
 * compiled properties (replacing the render-scope useActionData() hook).
 */
import {
  definePage,
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/router';
import FormPage from '../components/page-form.tsx';

interface FormActionData {
  error?: string;
  message?: string;
}

export function action(ctx: { formData: FormData }): OpenElementActionFailure<FormActionData> {
  const message = String(ctx.formData.get('message') ?? '').trim();
  if (!message) {
    return fail(422, { error: 'message is required', message } satisfies FormActionData);
  }
  throw redirect(`/form?echoed=${encodeURIComponent(message)}`);
}

export const actions = {
  shout(ctx: { formData: FormData }): never {
    const message = String(ctx.formData.get('message') ?? '').trim() || 'silence';
    throw redirect(`/live?x=${encodeURIComponent(message.toUpperCase())}`);
  },
};

function projectFormProps(context: PagePropsContext): Record<string, unknown> {
  const actionData = context.actionData as FormActionData | undefined;
  const echoed = context.request
    ? new URL(context.request.url).searchParams.get('echoed')
    : undefined;
  return {
    message: actionData?.message ?? '',
    echoText: `echo=${echoed ?? ''}`,
    hasError: actionData?.error ? 1 : 0,
  };
}

export default definePage(FormPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — form' },
  props: projectFormProps,
});
