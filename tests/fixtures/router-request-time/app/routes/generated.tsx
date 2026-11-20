/**
 * M11-2 static generated page (SSG): the route module imports the generated
 * function island and passes it to definePage; the page tag is the compiler-owned
 * island tag build fact. The default renderIntent mode is `static`, so the page
 * is prerendered at build time (same artifact expectations as a class page).
 */
import { definePage } from '@openelement/router';
import GeneratedPageCard from '../islands/generated-page-card.tsx';

export function loader() {
  return {
    title: 'Generated page — SSG',
    dataNote: 'prerendered note',
    count: 2,
    enabled: true,
  };
}

export default definePage(GeneratedPageCard, {
  head: { title: 'request-time fixture — generated page' },
  props: ({ data }) => {
    const pageData = data as
      | { title?: string; dataNote?: string; count?: number; enabled?: boolean }
      | undefined;
    return {
      title: pageData?.title ?? '',
      dataNote: pageData?.dataNote ?? '',
      count: pageData?.count ?? 0,
      enabled: pageData?.enabled ?? false,
    };
  },
});
