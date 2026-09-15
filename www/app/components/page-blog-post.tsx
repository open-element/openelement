import {
  element,
  OpenElement,
  property,
  type TrustedHtml,
  trustedHtml,
} from '@openelement/element';
import '@openelement/site-ui/open-reading-shell.tsx';
import '../islands/open-page-rail.tsx';
import { pageBlogPostStyles } from './page-blog-post-styles.ts';

interface BlogTag {
  key: string;
  label: string;
}
interface BlogRailItem {
  id: string;
  href: string;
  label: string;
  depth: string;
}
interface BlogNavigationItem {
  href: string;
  label: string;
}
interface BlogNavigation {
  previous?: BlogNavigationItem;
  next?: BlogNavigationItem;
}

@element('blog-slug')
export default class PageBlogPost extends OpenElement {
  static override styles = pageBlogPostStyles;

  @property({ reflect: false, attribute: false })
  notFoundClass = 'not-found';
  @property({ reflect: false, attribute: false })
  articleClass = 'is-hidden';
  @property({ reflect: false, attribute: false })
  notFoundMessage = '';
  @property({ reflect: false, attribute: false })
  slug = '';
  @property({ reflect: false, attribute: false })
  blogHref = '';
  @property({ reflect: false, attribute: false })
  backLabel = '';
  @property({ reflect: false, attribute: false })
  breadcrumbLabel = '';
  @property({ reflect: false, attribute: false })
  crumbCurrent = '';
  @property({ reflect: false, attribute: false })
  postTitle = '';
  @property({ reflect: false, attribute: false })
  lede = '';
  @property({ reflect: false, attribute: false })
  date = '';
  @property({ reflect: false, attribute: false })
  postLang = '';
  @property({ reflect: false, attribute: false })
  langNotice = '';
  @property({ reflect: false, attribute: false })
  tags: BlogTag[] = [];
  @property({ reflect: false, attribute: false })
  railItems: BlogRailItem[] = [];
  @property({ reflect: false, attribute: false })
  navigation: BlogNavigation = {};
  @property({ type: Object, reflect: false, attribute: false })
  articleHtml: TrustedHtml = trustedHtml('');
  @property({ reflect: false, attribute: false })
  nextDispatchLabel = '';
  @property({ reflect: false, attribute: false })
  nextDispatchHref = '';
  @property({ reflect: false, attribute: false })
  nextDispatchText = '';

  render() {
    return (
      <main>
        <div class={this.notFoundClass}>
          <h1>404</h1>
          <p>{this.notFoundMessage}: {this.slug}</p>
          <a href={this.blogHref}>← {this.backLabel}</a>
        </div>

        <div class={this.articleClass}>
          <open-reading-shell meta rail footer navigation={this.navigation}>
            <div slot='meta'>
              <p class='crumb'>
                <a href={this.blogHref}>{this.breadcrumbLabel}</a>
                <span class='crumb-sep'>/</span>
                <span class='crumb-current'>{this.crumbCurrent}</span>
              </p>
              <h1 class='post-title'>{this.postTitle}</h1>
              <p class='post-lede'>{this.lede}</p>
              <p class='post-meta'>
                <time>{this.date}</time>
                {this.tags.map((tag) => <span key={tag.key}>· {tag.label}</span>)}
              </p>
              <p class='lang-notice' role='note'>{this.langNotice}</p>
            </div>
            <div slot='rail'>
              <open-page-rail items={this.railItems}></open-page-rail>
            </div>
            <div
              class='blog-content'
              lang={this.postLang}
              innerHTML={this.articleHtml}
              trustedHtml
            />
            <nav class='next-dispatch' aria-label='Next dispatch'>
              <span class='next-label'>{this.nextDispatchLabel}</span>
              <a href={this.nextDispatchHref}>{this.nextDispatchText}</a>
            </nav>
          </open-reading-shell>
        </div>
      </main>
    );
  }
}
