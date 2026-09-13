/**
 * /regions — data-open-region / data-open-preserve morph semantics
 * (ADR-0121 §8): the form is scoped to its nearest ancestor region; the
 * preserved subtree survives untouched; a form targeting a missing region
 * falls back to a full navigation. v0.44: markup compiled in
 * components/page-regions.tsx; the descriptor projector replaces the
 * render-scope useActionData() hook.
 */
import {
  definePage,
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/router';
import RegionsPage from '../components/page-regions.tsx';

interface RegionActionData {
  error?: string;
  message?: string;
}

export function action(
  ctx: { formData: FormData },
): OpenElementActionFailure<RegionActionData> {
  const message = String(ctx.formData.get('message') ?? '').trim();
  if (!message) {
    return fail(422, { error: 'message is required', message } satisfies RegionActionData);
  }
  throw redirect(`/regions?echoed=${encodeURIComponent(message)}`);
}

export default definePage(RegionsPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — regions' },
  props(context: PagePropsContext) {
    const actionData = context.actionData as RegionActionData | undefined;
    const echoed = context.request
      ? new URL(context.request.url).searchParams.get('echoed')
      : undefined;
    return {
      bannerText: `echo=${echoed ?? ''}`,
      message: actionData?.message ?? '',
      hasError: actionData?.error ? 1 : 0,
    };
  },
});
