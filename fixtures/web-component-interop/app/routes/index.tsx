/** @jsxImportSource @openelement/element */
import { definePage } from '@openelement/router';
import InteropHomePage from '../components/page-interop-home.tsx';

export default definePage(InteropHomePage, {
  head: {
    title: 'OpenElement Web Components interoperability corpus',
  },
  renderIntent: { mode: 'static' },
});
