import { definePage } from '@openelement/router';
import DesignSystemPage from '../../components/article-routes/architecture-design-system.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(DesignSystemPage, {
  head: ({ locale }) => articlePageHead('architecture', 'design-system', locale),
  props({ locale }) {
    return { model: projectArticlePage('architecture', 'design-system', locale) };
  },
});
