import { definePage } from '@openelement/router';
import GuideGlossaryPage from '../../components/article-routes/guide-glossary.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideGlossaryPage, {
  head: ({ locale }) => articlePageHead('guide', 'glossary', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'glossary', locale) };
  },
});
