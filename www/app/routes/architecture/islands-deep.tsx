import { definePage } from '@openelement/router';
import IslandsDeepGuidePage from '../../components/article-routes/architecture-islands-deep.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Principles', label: 'Island Deep Dive', order: 50 };

export default definePage(IslandsDeepGuidePage, {
  head: ({ locale }) => articlePageHead('architecture', 'islands-deep', locale),
  props({ locale }) {
    return { model: projectArticlePage('architecture', 'islands-deep', locale) };
  },
});
