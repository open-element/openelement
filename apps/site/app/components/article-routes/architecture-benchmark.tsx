import { element, OpenElement, property } from '@openelement/element';
import '../../site-ui/open-article-view.tsx';
import type { ArticlePageModel } from '../../site-ui/article-page-model.ts';

@element('architecture-benchmark')
export default class Benchmark extends OpenElement {
  @property({ reflect: false, attribute: false })
  model: ArticlePageModel = {
    notFoundClass: 'container',
    articleClass: 'is-hidden',
    slug: '',
    notFoundMessage: '',
    metadata: { breadcrumb: '', title: '', lede: '' },
    navigation: {},
    railItems: [],
    articleHtml: '',
  };

  render() {
    return <open-article-view model={this.model}></open-article-view>;
  }
}
