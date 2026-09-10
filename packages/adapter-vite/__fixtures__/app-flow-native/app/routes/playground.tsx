/**
 * /playground — DYNAMIC page (#1339 §5B) hosting the enhancement-guard probes.
 * No action export: a POST here exercises the protocol's "route does not
 * accept submissions" 404 channel, which the enhance client turns into a full
 * navigation — exactly the fallback the target='_blank' probe observes when
 * interception (incorrectly) happens.
 */
import { definePage } from '@openelement/app';
import PlaygroundPage from '../components/page-playground.tsx';
import { exposeActionCount } from '../store.ts';

export function loader(ctx: { responseHeaders: Headers }): void {
  exposeActionCount(ctx.responseHeaders);
}

export default definePage(PlaygroundPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'app-flow-native fixture — playground' },
  props() {
    return {};
  },
});
