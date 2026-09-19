import { definePage } from '@openelement/router';
import GuideGettingStartedPage from '../../components/article-routes/guide-getting-started.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideGettingStartedPage, {
  head: ({ locale }) => articlePageHead('guide', 'getting-started', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'getting-started', locale) };
  },
});
