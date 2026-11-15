/**
 * M11-2 generated page error consumer: the loader always throws and the page
 * declares an `error` projector, so the 500 boundary re-renders the generated
 * page host through the same root pair channel with error-projected props.
 */
import { definePage } from '@openelement/router';
import GeneratedPageBoomCard from '../islands/generated-page-boom.tsx';

export function loader(): never {
  throw new Error('generated-page-boom');
}

export default definePage(GeneratedPageBoomCard, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — generated boom' },
  props: () => ({ title: 'generated normal', note: 'not rendered' }),
  error: () => ({
    title: 'Generated page — error boundary',
    note: 'error projector rendered',
  }),
});
