import { definePage } from '@openelement/router';
import GuideRecipeFormActionsPage from '../../components/article-routes/guide-recipe-form-actions.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideRecipeFormActionsPage, {
  head: ({ locale }) => articlePageHead('guide', 'recipe-form-actions', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'recipe-form-actions', locale) };
  },
});
