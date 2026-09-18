import { element, OpenElement, property } from '@openelement/element';
import '@openelement/ui/open-button';
import { page404Styles } from './page-404-styles.ts';

@element('el-404')
export default class Page404 extends OpenElement {
  static override styles = page404Styles;

  @property({ reflect: false })
  serifLine = '';

  @property({ reflect: false })
  lede = '';

  @property({ reflect: false })
  backHome = '';

  @property({ reflect: false })
  readDocs = '';

  @property({ reflect: false })
  homeHref = '/';

  @property({ reflect: false })
  docsHref = '/docs';

  @property({ reflect: false })
  searchHint = '';

  @property({ reflect: false })
  popularLabel = '';

  @property({ reflect: false })
  popular: Array<{ href: string; label: string }> = [];

  @property({ reflect: false })
  suggestionsLabel = '';

  @property({ reflect: false })
  suggestions: Array<{ href: string; label: string }> = [];

  @property({ reflect: false })
  marqueeText = '';

  render() {
    return (
      <div class='notfound' data-pagefind-ignore>
        <section class='stage'>
          <h1 class='code' aria-label='404'>
            <span aria-hidden='true'>4</span>
            <span class='solid' aria-hidden='true'>0</span>
            <span aria-hidden='true'>4</span>
          </h1>
          <p class='serif-line'>{this.serifLine}</p>
          <p class='lede'>{this.lede}</p>
          {/* Static component, deliberately not an island: a 404-only
              island chunk homed shared framework modules and got imported
              by every page's chunks (measured +22KB on /) — the header
              search and ⌘K already hydrate here, so a dedicated control
              is not worth a site-wide tax. */}
          <div class='actions'>
            <open-button variant='primary' href={this.homeHref}>
              {this.backHome}
            </open-button>
            <open-button href={this.docsHref}>
              {this.readDocs}
            </open-button>
          </div>
          <p class='search-hint'>{this.searchHint}</p>
          <nav class='popular' aria-labelledby='popular-heading'>
            <p class='popular-label' id='popular-heading'>{this.popularLabel}</p>
            {this.popular.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>
          <nav class='popular suggestions' aria-labelledby='suggestions-heading'>
            <p class='popular-label' id='suggestions-heading'>{this.suggestionsLabel}</p>
            {this.suggestions.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>
        </section>
        <div class='marquee' aria-hidden='true'>
          <span>{this.marqueeText}</span>
        </div>
      </div>
    );
  }
}
