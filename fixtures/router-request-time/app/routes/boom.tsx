/**
 * /boom — error-boundary parity (ADR-0121 §7): the loader always throws, and
 * the page declares an error variant through the descriptor's error
 * projector. GET and POST must both render the boundary with status 500
 * (POST parity is the alpha.5 fix). v0.44: the boundary markup is a static
 * Region branch of the compiled page program (components/page-boom.tsx).
 */
import { definePage, fail, type OpenElementActionFailure } from '@openelement/router';
import BoomPage from '../components/page-boom.tsx';

export function loader(): never {
  throw new Error('boom-loader');
}

export function action(): OpenElementActionFailure<{ note: string }> {
  // Validation failure: the fail path re-runs the loader, which throws —
  // the POST must render the error boundary, not a bare 500.
  return fail(422, { note: 'validated' });
}

export const actions = {
  explode(): never {
    // A thrown action: the exception channel (boundary / scrubbed JSON).
    throw new Error('boom-action');
  },
};

export default definePage(BoomPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — boom' },
  props() {
    return { boomNormal: 1, boomLoader: 0, boomAction: 0 };
  },
  error(error) {
    // The two boundary texts are the page's two constant failure messages.
    const isAction = String((error as Error)?.message ?? error) === 'boom-action';
    return { boomNormal: 0, boomLoader: isAction ? 0 : 1, boomAction: isAction ? 1 : 0 };
  },
});
