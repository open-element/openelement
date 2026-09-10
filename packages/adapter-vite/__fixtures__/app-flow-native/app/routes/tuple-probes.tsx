/**
 * /tuple-probes — DYNAMIC probe page for the effective submission tuple
 * matrix (#1339 §5): a real default action records the invocation and
 * PRG-redirects back; the e2e wire observer (e2e/server.ts) proves exactly
 * what the server received on the enhanced and the native path, byte for
 * byte.
 */
import { definePage, redirect } from '@openelement/app';
import TupleProbesPage from '../components/page-tuple-probes.tsx';
import { exposeActionCount, noteStore } from '../store.ts';

export function loader(ctx: { responseHeaders: Headers }): void {
  exposeActionCount(ctx.responseHeaders);
}

export function action(ctx: { formData: FormData; responseHeaders: Headers }): never {
  noteStore.recordAction(String(ctx.formData.get('intent') ?? ''));
  exposeActionCount(ctx.responseHeaders);
  throw redirect('/tuple-probes?sent=1');
}

export default definePage(TupleProbesPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'app-flow-native fixture — tuple probes' },
  props() {
    return {};
  },
});
