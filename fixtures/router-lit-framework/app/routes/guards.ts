/**
 * /guards — DYNAMIC page hosting the Lit enhancement-guard probes (Beta.2.2
 * #1339 §5B, the app-flow-lit counterpart of the native /playground +
 * /tuple-probes pages). The action accepts every probe POST, records the
 * invocation and answers 303 -> /guards?sent=1, so the enhanced fetch path
 * morphs the redirect target while the native path navigates to it.
 */
import { defineLitPage } from '@openelement/router/lit';
import { redirect } from '@openelement/router';
import { GuardsPage } from '../components/guards-page.ts';
import { exposeActionCount, recordActionInvocation } from '../store.ts';

export function action(ctx: {
  formData: FormData;
  responseHeaders: Headers;
}): void {
  recordActionInvocation(String(ctx.formData.get('intent') ?? ''));
  exposeActionCount(ctx.responseHeaders);
  throw redirect('/guards?sent=1');
}

export function loader(ctx: { responseHeaders: Headers }): void {
  exposeActionCount(ctx.responseHeaders);
}

export default defineLitPage('guards-page', GuardsPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'app-flow-lit — guards' },
  props() {
    return {};
  },
});
