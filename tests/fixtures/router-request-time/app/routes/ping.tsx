/**
 * /ping — named-only actions route exercising ADR-0121 protocol edges:
 * - 'ping' returns nothing, so the default PRG target (action marker
 *   stripped, other query params kept) is observable; the Ping button is
 *   NAMED, so the enhanced path must include the submitter's name/value in
 *   the body or the action 422s (#544);
 * - 'mv307' redirects with an explicit 307, coerced to 303 on POST;
 * - 'raw' returns a Response — a contract violation, never a response.
 * v0.44: markup compiled in components/page-ping.tsx; the descriptor
 * projector replaces the render-scope useActionData() hook.
 */
import {
  definePage,
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/router';
import PingPage from '../components/page-ping.tsx';

interface PingActionData {
  error?: string;
  intent?: string;
}

export const actions = {
  ping(ctx: { formData: FormData }): OpenElementActionFailure<PingActionData> | void {
    const intent = String(ctx.formData.get('intent') ?? '');
    if (intent !== 'ping') {
      return fail(422, { error: 'intent missing', intent } satisfies PingActionData);
    }
    // Success returns nothing: the default PRG target applies (ADR-0121 §4).
  },
  mv307(): never {
    throw redirect('/ping?moved=1', 307);
  },
  raw(): Response {
    return new Response('<h1>raw</h1>', {
      headers: { 'content-type': 'text/html' },
    });
  },
};

export default definePage(PingPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — ping' },
  props(context: PagePropsContext) {
    const actionData = context.actionData as PingActionData | undefined;
    const moved = context.request
      ? new URL(context.request.url).searchParams.get('moved')
      : undefined;
    return {
      movedText: `moved=${moved ?? ''}`,
      hasError: actionData?.error ? 1 : 0,
    };
  },
});
