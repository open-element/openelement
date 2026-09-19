import { definePage } from '@openelement/router';
import GuideRecipeIslandStrategiesPage from '../../components/article-routes/guide-recipe-island-strategies.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideRecipeIslandStrategiesPage, {
  head: ({ locale }) => articlePageHead('guide', 'recipe-island-strategies', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'recipe-island-strategies', locale) };
  },
});
