import { definePage } from '@openelement/router';
import GuideRecipeThemingPage from '../../components/article-routes/guide-recipe-theming.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideRecipeThemingPage, {
  head: ({ locale }) => articlePageHead('guide', 'recipe-theming', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'recipe-theming', locale) };
  },
});
