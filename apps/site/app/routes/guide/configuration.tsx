import { definePage } from '@openelement/router';
import GuideConfigurationPage from '../../components/article-routes/guide-configuration.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Guide', label: 'Configuration', order: 70 };

export default definePage(GuideConfigurationPage, {
  head: ({ locale }) => articlePageHead('guide', 'configuration', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'configuration', locale) };
  },
});
