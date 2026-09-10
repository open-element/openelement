/**
 * /404 — styled not-found page (#923): request-time unmatched paths render
 * this page with a 404 status on both dev (hono) and build (Nitro) runtimes.
 * The loader proves the ADR-0129 channel is merged even on the notFound
 * fallback response.
 */
import { definePage } from '@openelement/app';
import NotFoundPage from '../components/page-404.tsx';
import { exposeActionCount } from '../store.ts';

export function loader(ctx: { responseHeaders: Headers }): void {
  exposeActionCount(ctx.responseHeaders);
}

export default definePage(NotFoundPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'app-flow-native fixture — not found' },
});
