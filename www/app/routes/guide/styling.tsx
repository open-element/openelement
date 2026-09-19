import { definePage } from '@openelement/router';
import GuideStylingPage from '../../components/article-routes/guide-styling.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideStylingPage, {
  head: ({ locale }) => articlePageHead('guide', 'styling', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'styling', locale) };
  },
});
