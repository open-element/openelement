import { definePage } from '@openelement/app';
import GuideDeploymentPage from '../../components/article-routes/guide-deployment.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Guide', label: 'Deployment', order: 100 };

export default definePage(GuideDeploymentPage, {
  head: ({ locale }) => articlePageHead('guide', 'deployment', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'deployment', locale) };
  },
});
