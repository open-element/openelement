import { definePage } from '@openelement/router';
import GuideTutorialPage from '../../components/article-routes/guide-tutorial.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideTutorialPage, {
  head: ({ locale }) => articlePageHead('guide', 'tutorial', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'tutorial', locale) };
  },
});
