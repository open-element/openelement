import { definePage } from '@openelement/router';
import GuideI18nPage from '../../components/article-routes/guide-i18n.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(GuideI18nPage, {
  head: ({ locale }) => articlePageHead('guide', 'i18n', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'i18n', locale) };
  },
});
