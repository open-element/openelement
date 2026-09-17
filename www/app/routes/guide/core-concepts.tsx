import { definePage } from '@openelement/router';
import GuideCoreConceptsPage from '../../components/article-routes/guide-core-concepts.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideCoreConceptsPage, {
  head: ({ locale }) => articlePageHead('guide', 'core-concepts', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'core-concepts', locale) };
  },
});
