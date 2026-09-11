/** Static home page (default renderIntent mode 'static') — prerendered at build time. */
import { definePage } from '@openelement/router';
import HomePage from '../components/page-home.tsx';

export default definePage(HomePage, {
  head: { title: 'request-time fixture — home' },
});
