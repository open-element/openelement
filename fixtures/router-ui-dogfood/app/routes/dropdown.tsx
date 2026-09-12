/** /dropdown — static page qualifying open-dropdown (#1226). */
import { definePage } from '@openelement/router';
import DropdownPage from '../components/page-dropdown.tsx';

export default definePage(DropdownPage, {
  head: { title: 'ui dogfood fixture — dropdown' },
});
