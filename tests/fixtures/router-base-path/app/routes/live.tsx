import { definePage } from '@openelement/router';
import SubpageLive from '../components/subpage-live.tsx';

/**
 * The streamed request-time route (S-C2/S-12): `stream: { defer: ['message'] }`
 * makes the server send the document head + shell first and the resolved field
 * as a later frame, so the stylesheet links must already be in the FIRST flush.
 */
export function loader(ctx: { request: Request }) {
  const url = new URL(ctx.request.url);
  const delay = Math.min(500, Math.max(5, Number(url.searchParams.get('delay') ?? 150) || 150));
  return {
    message: new Promise<string>((resolve) => {
      setTimeout(() => resolve('deferred content resolved'), delay);
    }),
  };
}

export default definePage(SubpageLive, {
  renderIntent: { mode: 'dynamic', stream: { defer: ['message'] } },
  head: { title: 'streamed base path' },
});
