/** /boundaries — static page qualifying the open/light/closed root contracts (#1226). */
import { definePage } from '@openelement/router';
import BoundariesPage from '../components/page-boundaries.tsx';

export default definePage(BoundariesPage, {
  head: { title: 'ui dogfood fixture — boundaries' },
});
