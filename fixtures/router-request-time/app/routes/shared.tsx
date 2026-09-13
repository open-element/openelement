/**
 * /shared — a route whose enhanced form lives in an IMPORTED module (#577):
 * this file contains no data-open-enhance literal, so the enhancement layer
 * only ships because the scanner follows the import into the compiled page
 * element module (components/page-shared.tsx).
 */
import { definePage } from '@openelement/router';
import SharedPage from '../components/page-shared.tsx';

export default definePage(SharedPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — shared' },
});
