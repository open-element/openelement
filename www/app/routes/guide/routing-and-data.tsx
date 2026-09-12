import { definePage } from '@openelement/app';
import GuideRoutingAndDataPage from '../../components/article-routes/guide-routing-and-data.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Guide', label: 'Routing and Data', order: 40 };

export default definePage(GuideRoutingAndDataPage, {
  head: ({ locale }) => articlePageHead('guide', 'routing-and-data', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'routing-and-data', locale) };
  },
});
