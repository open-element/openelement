import { element, OpenElement, property } from '@openelement/element';
import '../../site-ui/open-article-view.tsx';
import type { ArticlePageModel } from '../../site-ui/article-page-model.ts';

@element('guide-routing-and-data')
export default class GuideRoutingAndDataPage extends OpenElement {
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

  // Same base-field redeclaration as open-layout: the compiled @property
  // shadows OpenElementConfiguration.locale (SSR injection or the `locale`
  // attribute); tsc's `override` demand is rejected by the compiled grammar.
  @property({ reflect: false })
  // @ts-expect-error compiled @property shadows the optional base field
  locale = 'en';

  render() {
    return <open-article-view model={this.model} locale={this.locale}></open-article-view>;
  }
}
