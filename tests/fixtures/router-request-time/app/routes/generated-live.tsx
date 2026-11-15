/**
 * M11-2 request-time generated page: `renderIntent.mode: 'dynamic'` stays out
 * of prerendering and is served per request through the generated entry. The
 * action channel exercises the same page content statement on the 422 native
 * re-render as the GET path.
 */
import { definePage, fail, type OpenElementActionFailure } from '@openelement/router';
import GeneratedPageLiveCard from '../islands/generated-page-live.tsx';

export function loader() {
  return {
    title: 'Generated page — request time',
    dataNote: 'served from dist/server',
    count: 3,
    enabled: true,
  };
}

interface GeneratedActionData {
  notice?: string;
}

export function action(ctx: { formData: FormData }): OpenElementActionFailure<GeneratedActionData> {
  const value = String(ctx.formData.get('value') ?? '');
  if (value === '') {
    return fail(422, { notice: 'generated action: value required' });
  }
  return fail(422, { notice: `generated action: ${value}` });
}

export default definePage(GeneratedPageLiveCard, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — generated live page' },
  props: ({ data, actionData }) => {
    const pageData = data as
      | { title?: string; dataNote?: string; count?: number; enabled?: boolean }
      | undefined;
    const actionNotice = (actionData as GeneratedActionData | undefined)?.notice;
    return {
      title: pageData?.title ?? 'Generated page — request time',
      dataNote: actionNotice ?? pageData?.dataNote ?? '',
      count: pageData?.count ?? 0,
      enabled: pageData?.enabled ?? false,
    };
  },
});
