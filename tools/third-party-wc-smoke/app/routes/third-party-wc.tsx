/** /third-party-wc route — thin definePage wrapper around the compiled page. */
import { definePage } from '@openelement/router';
import ThirdPartyWcPage from '../components/page-third-party-wc.tsx';

export default definePage(ThirdPartyWcPage, {
  head: {
    title: 'alpha3 Web Components interop',
    description: 'Lit, Shoelace, and Material Web Components inside openElement',
  },
  renderIntent: { mode: 'static' },
});
