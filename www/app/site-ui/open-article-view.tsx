import { computed, element, OpenElement, property, trustedHtml } from '@openelement/element';
import '../islands/open-page-rail.tsx';
import './open-reading-shell.tsx';
import type { ArticlePageModel } from './article-page-model.ts';
import { openArticleViewStyles } from './open-article-view-styles.ts';

@element('open-article-view')
export default class OpenArticleView extends OpenElement {
  static override styles = openArticleViewStyles;

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
  @property({ reflect: false, attribute: false })
  notFoundClass = computed(() => this.model.notFoundClass);
  @property({ reflect: false, attribute: false })
  articleClass = computed(() => this.model.articleClass);
  @property({ reflect: false, attribute: false })
  slug = computed(() => this.model.slug);
  @property({ reflect: false, attribute: false })
  notFoundMessage = computed(() => this.model.notFoundMessage);
  @property({ reflect: false, attribute: false })
  metadata = computed(() => this.model.metadata);
  @property({ reflect: false, attribute: false })
  navigation = computed(() => this.model.navigation);
  @property({ reflect: false, attribute: false })
  railItems = computed(() => this.model.railItems);
  @property({ type: Object, reflect: false, attribute: false })
  articleHtml = computed(() => trustedHtml(this.model.articleHtml));

  render() {
    return (
      <main>
        <div class={this.notFoundClass}>
          <h1>404</h1>
          <p>{this.notFoundMessage}: {this.slug}</p>
        </div>
        <div class={this.articleClass}>
          <open-reading-shell
            rail
            footer
            metadata={this.metadata}
            navigation={this.navigation}
          >
            <div slot='rail'>
              <open-page-rail items={this.railItems}></open-page-rail>
            </div>
            <div class='article-content' innerHTML={this.articleHtml} trustedHtml />
          </open-reading-shell>
        </div>
      </main>
    );
  }
}
