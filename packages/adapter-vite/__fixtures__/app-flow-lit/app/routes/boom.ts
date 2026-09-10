/**
 * /boom — loader always throws a plain Error: the generated entry answers
 * status 500 with the page's error variant (ADR-0121 §7 error-boundary
 * channel). The counter channel header is set before the throw, so even the
 * 500 response carries x-action-count.
 */
import { defineLitPage } from '@openelement/app/lit';
import { BoomPage } from '../components/boom-page.ts';
import { exposeActionCount } from '../store.ts';

export function loader(ctx: { responseHeaders: Headers }): never {
  exposeActionCount(ctx.responseHeaders);
  throw new Error('boom-loader');
}

export default defineLitPage('boom-page', BoomPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'app-flow-lit — boom' },
  props() {
    return { boomError: false, message: '' };
  },
  error(error) {
    return {
      boomError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  },
});
