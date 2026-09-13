/** /tabs — static page qualifying open-tabs (#1226). */
import { definePage } from '@openelement/router';
import TabsPage from '../components/page-tabs.tsx';

export default definePage(TabsPage, {
  head: { title: 'ui dogfood fixture — tabs' },
});
