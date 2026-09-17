import { definePage } from '@openelement/router';
import GuideArchitecturePage from '../../components/article-routes/guide-architecture.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideArchitecturePage, {
  head: ({ locale }) => articlePageHead('guide', 'architecture', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'architecture', locale) };
  },
});
