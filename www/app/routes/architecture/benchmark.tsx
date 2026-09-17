import { definePage } from '@openelement/router';
import Benchmark from '../../components/article-routes/architecture-benchmark.tsx';
import { articlePageHead, projectArticlePage } from '../../site-ui/article-page-model.ts';

export default definePage(Benchmark, {
  head: ({ locale }) => articlePageHead('architecture', 'benchmark', locale),
  props({ locale }) {
    return { model: projectArticlePage('architecture', 'benchmark', locale) };
  },
});
