/**
 * /404 — styled not-found page (#923): request-time unmatched paths render
 * this page with a 404 status on both dev (hono) and build (Nitro) runtimes.
 * v0.44: markup compiled in components/page-404.tsx (path-derived tag
 * 'el-404').
 */
import { definePage } from '@openelement/router';
import NotFoundPage from '../components/page-404.tsx';

export default definePage(NotFoundPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — not found' },
});
