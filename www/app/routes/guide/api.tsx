import { definePage } from '@openelement/router';
import GuideApiPage from '../../components/article-routes/guide-api.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideApiPage, {
  head: ({ locale }) => articlePageHead('guide', 'api', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'api', locale) };
  },
});
