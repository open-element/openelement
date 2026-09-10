import { definePage } from '@openelement/app';
import ComparisonPage from '../../components/article-routes/architecture-comparison.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Principles', label: 'Comparison', order: 20 };

export default definePage(ComparisonPage, {
  head: ({ locale }) => articlePageHead('architecture', 'comparison', locale),
  props({ locale }) {
    return { model: projectArticlePage('architecture', 'comparison', locale) };
  },
});
