import { definePage } from '@openelement/router';
import WebComponentAdmissionPage from '../../components/article-routes/architecture-web-component-admission.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(WebComponentAdmissionPage, {
  head: ({ locale }) => articlePageHead('architecture', 'web-component-admission', locale),
  props({ locale }) {
    return { model: projectArticlePage('architecture', 'web-component-admission', locale) };
  },
});
