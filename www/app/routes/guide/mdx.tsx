import { definePage } from '@openelement/router';
import GuideMdxPage from '../../components/article-routes/guide-mdx.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Guide', label: 'MDX', order: 50 };

export default definePage(GuideMdxPage, {
  head: ({ locale }) => articlePageHead('guide', 'mdx', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'mdx', locale) };
  },
});
