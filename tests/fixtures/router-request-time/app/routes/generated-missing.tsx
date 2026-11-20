/**
 * M11-2 generated page not-found consumer: a loader `notFound()` answers the
 * 404 status page without rendering the page host (the 404 terminal owns the
 * response), matching the class-page contract.
 */
import { definePage, notFound } from '@openelement/router';
import GeneratedPageMissingCard from '../islands/generated-page-missing.tsx';

export function loader(): never {
  throw notFound();
}

export default definePage(GeneratedPageMissingCard, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — generated missing' },
  props: () => ({ title: 'unused', note: 'unused' }),
});
