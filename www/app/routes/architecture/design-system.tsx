import { definePage } from '@openelement/app';
import DesignSystemPage from '../../components/article-routes/architecture-design-system.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Reference', label: 'Design System', order: 15 };

export default definePage(DesignSystemPage, {
  head: ({ locale }) => articlePageHead('architecture', 'design-system', locale),
  props({ locale }) {
    return { model: projectArticlePage('architecture', 'design-system', locale) };
  },
});
