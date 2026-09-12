import { definePage } from '@openelement/app';
import GuideErrorHandlingPage from '../../components/article-routes/guide-error-handling.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Guide', label: 'Error Handling', order: 80 };

export default definePage(GuideErrorHandlingPage, {
  head: ({ locale }) => articlePageHead('guide', 'error-handling', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'error-handling', locale) };
  },
});
