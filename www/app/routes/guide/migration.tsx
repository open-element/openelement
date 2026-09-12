import { definePage } from '@openelement/app';
import GuideMigrationPage from '../../components/article-routes/guide-migration.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export const meta = { section: 'Guide', label: 'Migration', order: 75 };

export default definePage(GuideMigrationPage, {
  head: ({ locale }) => articlePageHead('guide', 'migration', locale),
  props({ locale }) {
    return { model: projectArticlePage('guide', 'migration', locale) };
  },
});
