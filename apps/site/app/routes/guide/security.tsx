import { definePage } from '@openelement/router';
import GuideSecurityPage from '../../components/article-routes/guide-security.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Guide', label: 'Security', order: 95 };

export default definePage(GuideSecurityPage, {
  head: ({ locale }) => articlePageHead('guide', 'security', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'security', locale) };
  },
});
