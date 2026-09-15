import { definePage } from '@openelement/router';
import IslandsPage from '../../components/article-routes/architecture-islands.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Principles', label: 'Islands', order: 40 };

export default definePage(IslandsPage, {
  head: ({ locale }) => articlePageHead('architecture', 'islands', locale),
  props({ locale }) {
    return { model: projectArticlePage('architecture', 'islands', locale) };
  },
});
