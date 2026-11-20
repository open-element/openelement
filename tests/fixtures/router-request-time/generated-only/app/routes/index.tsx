import { definePage } from '@openelement/router';
import GenPage from '../islands/gen-page.tsx';

export default definePage(GenPage, { head: { title: 'generated-only fixture' } });
