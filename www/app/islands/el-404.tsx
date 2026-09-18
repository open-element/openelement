import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement, property } from '@openelement/element';
import { page404Styles } from '../components/page-404-styles.ts';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true });

/** Minimal surface of the hydrated header search island this page opens. */
interface SearchOpener extends HTMLElement {
  openSearch?: () => void;
}

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
  searchLabel = '';

  openSiteSearch(): void {
    document.querySelector<SearchOpener>('open-search')?.openSearch?.();
  }

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
          <div class='actions'>
            {
              /* Native anchors, not open-button: importing the ui primitive
                would bundle its runtime into this 404-only island chunk and
                blow the per-island budget. The action-link styles below carry
                the same primary/ghost voice. */
            }
            <a class='action-link primary' href={this.homeHref}>
              {this.backHome}
            </a>
            <a class='action-link' href={this.docsHref}>
              {this.readDocs}
            </a>
            <button type='button' class='search-entry' onClick={this.openSiteSearch}>
              {this.searchLabel}
            </button>
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
