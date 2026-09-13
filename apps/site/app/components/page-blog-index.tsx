import { element, OpenElement, property } from '@openelement/element';
import { pageBlogIndexStyles } from './page-blog-index-styles.ts';

interface BlogIndexRow {
  slug: string;
  href: string;
  index: string;
  title: string;
  excerpt: string;
  date: string;
  langLabel: string;
}

@element('blog-index')
export default class BlogIndexPage extends OpenElement {
  static override styles = pageBlogIndexStyles;

  @property({ reflect: false, attribute: false })
  featuredHref = '';
  @property({ reflect: false, attribute: false })
  featuredKicker = '';
  @property({ reflect: false, attribute: false })
  featuredTitle = '';
  @property({ reflect: false, attribute: false })
  featuredExcerpt = '';
  @property({ reflect: false, attribute: false })
  rows: BlogIndexRow[] = [];

  @property({ reflect: false, attribute: false })
  mastheadEyebrow = '';
  @property({ reflect: false, attribute: false })
  mastheadTitle = '';
  @property({ reflect: false, attribute: false })
  mastheadLede = '';
  @property({ reflect: false, attribute: false })
  originNote = '';
  @property({ reflect: false, attribute: false })
  latestLabel = '';
  @property({ reflect: false, attribute: false })
  readMoreLabel = '';
  @property({ reflect: false, attribute: false })
  streamLabel = '';

  render() {
    return (
      <main class='journal'>
        <header class='masthead'>
          <p class='eyebrow'>{this.mastheadEyebrow}</p>
          <h1>{this.mastheadTitle}</h1>
          <p class='lede'>
            {this.mastheadLede}
          </p>
          <p class='origin-note'>{this.originNote}</p>
        </header>

        <a class='featured' href={this.featuredHref}>
          <p class='featured-kicker'>
            <span>{this.featuredKicker}</span>
            <span class='read-time'>{this.latestLabel}</span>
          </p>
          <h2>{this.featuredTitle}</h2>
          <p class='featured-excerpt'>{this.featuredExcerpt}</p>
          <span class='read-more'>{this.readMoreLabel}</span>
        </a>

        <section class='stream' aria-label={this.streamLabel}>
          {this.rows.map((row) => (
            <a class='row' key={row.slug} href={row.href}>
              <span class='row-index' aria-hidden='true'>{row.index}</span>
              <div>
                <span class='row-title'>{row.title}</span>
                <span class='row-lang'>{row.langLabel}</span>
                <p class='row-excerpt'>{row.excerpt}</p>
              </div>
              <span class='row-date'>{row.date}</span>
            </a>
          ))}
        </section>
      </main>
    );
  }
}
