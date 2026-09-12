/** /form — static page qualifying open-input/open-button form participation (#1226). */
import { definePage } from '@openelement/router';
import FormPage from '../components/page-form.tsx';

export default definePage(FormPage, {
  head: { title: 'ui dogfood fixture — form' },
});
