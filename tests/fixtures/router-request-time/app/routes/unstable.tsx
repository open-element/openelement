/**
 * /unstable — failure channel regression page (#943 amendment).
 *
 * v0.44: compiled pages have no render-time code path (render() is the
 * compiled Part Program), so the throw moved from render() into the loader —
 * the response contract is unchanged: every failure mode throws BEFORE the
 * render succeeds, so the #943 Cache-Control relaxation never leaks onto the
 * 404/3xx/500 response. `?kind=` selects the failure channel: `404`
 * (default) throws notFound(), `redirect` throws redirect('/live').
 */
import { definePage, notFound, redirect } from '@openelement/router';
import UnstablePage from '../components/page-unstable.tsx';

export function loader(ctx: { request: Request }): never {
  const kind = new URL(ctx.request.url).searchParams.get('kind') ?? '404';
  if (kind === 'redirect') redirect('/live');
  notFound('unstable gone');
}

export default definePage(UnstablePage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — unstable' },
});
