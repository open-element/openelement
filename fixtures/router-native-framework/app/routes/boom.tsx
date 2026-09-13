/**
 * /boom — DYNAMIC page whose loader always throws a plain Error: the
 * generated entry answers status 500 with the page's error variant (ADR-0121
 * §7 error-boundary channel). The counter channel header is set before the
 * throw, so even the 500 response carries x-action-count.
 */
import { definePage } from '@openelement/router';
import BoomPage from '../components/page-boom.tsx';
import { exposeActionCount } from '../store.ts';

export function loader(ctx: { responseHeaders: Headers }): never {
  exposeActionCount(ctx.responseHeaders);
  throw new Error('boom-loader');
}

export default definePage(BoomPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'app-flow-native fixture — boom' },
  props() {
    return { boomNormal: 1, boomError: 0 };
  },
  error() {
    return { boomNormal: 0, boomError: 1 };
  },
});
