import { definePage } from '@openelement/router';
import StandardsRegistryPage from '../../components/article-routes/architecture-standards-registry.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Reference', label: 'WC Standards Contract', order: 80 };

export default definePage(StandardsRegistryPage, {
  head: ({ locale }) => articlePageHead('architecture', 'standards-registry', locale),
  props({ locale }) {
    return { model: projectArticlePage('architecture', 'standards-registry', locale) };
  },
});
