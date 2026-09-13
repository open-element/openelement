import { definePage } from '@openelement/router';
import AboutPage from '../components/page-about.tsx';

export default definePage(AboutPage, {
  head: { title: 'static-only fixture — about' },
});
