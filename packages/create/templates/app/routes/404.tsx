/**
 * Styled 404 (#923): the request-time server renders this page with a 404
 * status for unmatched paths; SSG builds also emit it as static 404.html.
 */
import { definePage } from '@openelement/router';
import NotFoundPage from '../components/page-404.tsx';

export default definePage(NotFoundPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: '404 — openElement' },
});
