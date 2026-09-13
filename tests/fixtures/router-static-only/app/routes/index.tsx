import { definePage } from '@openelement/router';
import HomePage from '../components/page-home.tsx';

export default definePage(HomePage, {
  head: { title: 'static-only fixture — home' },
});
