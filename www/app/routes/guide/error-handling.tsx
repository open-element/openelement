import { definePage } from '@openelement/router';
import GuideErrorHandlingPage from '../../components/article-routes/guide-error-handling.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideErrorHandlingPage, {
  head: ({ locale }) => articlePageHead('guide', 'error-handling', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'error-handling', locale) };
  },
});
