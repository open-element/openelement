/**
 * /guestbook — HYBRID page (ADR-0120 amendment, 2026-09-16): no renderIntent,
 * so the GET is prerendered at build time and served from the static
 * artifact, while the action POST is dispatched to dist/server at request
 * time. Contrast with /form (renderIntent 'dynamic'), whose GET also runs
 * per request.
 * - empty submission -> fail(422, data) -> 422 re-render with the echo;
 * - valid submission -> redirect (PRG) with the value in the URL;
 * - named action 'ghost' via formaction='?/ghost' -> notFound from an action.
 * v0.44: markup is the compiled Part Program in components/page-guestbook.tsx;
 * the props projector maps action data + the ?posted= param onto the page's
 * compiled properties.
 */
import {
  definePage,
  fail,
  notFound,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/router';
import GuestbookPage from '../components/page-guestbook.tsx';

interface GuestbookActionData {
  error?: string;
  note?: string;
}

export function action(ctx: { formData: FormData }): OpenElementActionFailure<GuestbookActionData> {
  const note = String(ctx.formData.get('note') ?? '').trim();
  if (!note) {
    return fail(422, { error: 'note is required', note } satisfies GuestbookActionData);
  }
  throw redirect(`/guestbook?posted=${encodeURIComponent(note)}`);
}

export const actions = {
  ghost(): never {
    notFound('this guest is gone');
  },
};

function projectGuestbookProps(context: PagePropsContext): Record<string, unknown> {
  const actionData = context.actionData as GuestbookActionData | undefined;
  const posted = context.request
    ? new URL(context.request.url).searchParams.get('posted')
    : undefined;
  return {
    noteText: actionData?.note ?? '',
    echoText: `echo=${posted ?? ''}`,
    hasError: actionData?.error ? 1 : 0,
  };
}

export default definePage(GuestbookPage, {
  head: { title: 'request-time fixture — guestbook (hybrid)' },
  props: projectGuestbookProps,
});
