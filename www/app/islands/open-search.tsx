/** Compiler-owned search view; browser behavior lives in open-search-controller.ts. */

import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement, property } from '@openelement/element';
import {
  closeSearchFromResults,
  closeSearchOnBackdrop,
  installSearch,
  openSearch,
  searchFromInput,
  type SearchHit,
  uninstallSearch,
} from '../site-ui/open-search-controller.ts';
import { openSearchStyles } from '../site-ui/open-search-styles.ts';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('open-search')
export default class OpenSearch extends OpenElement {
  static override styles = openSearchStyles;

  // English defaults are the SSR contract (the island renders locale-agnostic
  // DSD); installSearch rewrites these from document.documentElement.lang on
  // zh pages after claim.
  @property({ reflect: false, attribute: false })
  triggerLabel = 'Search';
  @property({ reflect: false, attribute: false })
  dialogLabel = 'Search';
  @property({ reflect: false, attribute: false })
  inputLabel = 'Search documentation';
  @property({ reflect: false, attribute: false })
  placeholder = 'Search documentation...';
  @property({ reflect: false, attribute: false })
  resultsLabel = 'Search results';
  @property({ reflect: false, attribute: false })
  message = 'Type at least 2 characters to search';
  @property({ reflect: false, attribute: false })
  hasHits = false;
  @property({ reflect: false, attribute: false })
  hits: SearchHit[] = [];

  override connectedCallback(): void {
    super.connectedCallback();
    installSearch(this);
  }

  override disconnectedCallback(): void {
    uninstallSearch(this);
    super.disconnectedCallback();
  }

  openSearch(): void {
    openSearch(this);
  }

  closeSearchOnBackdrop(event: Event): void {
    closeSearchOnBackdrop(this, event);
  }

  closeSearchFromResults(event: Event): void {
    closeSearchFromResults(this, event);
  }

  searchFromInput(): void {
    searchFromInput(this);
  }

  render() {
    return (
      <div class='search-root'>
        <button
          type='button'
          class='search-trigger'
          part='trigger'
          aria-label={this.triggerLabel}
          onClick={this.openSearch}
        >
          <svg
            class='search-icon'
            part='icon'
            viewBox='0 0 16 16'
            fill='none'
            stroke='currentColor'
            stroke-width='1.5'
            stroke-linecap='round'
          >
            <circle cx='7' cy='7' r='4.5' />
            <path d='M10.5 10.5L14 14' />
          </svg>
          <span part='label'>{this.triggerLabel}</span>
          <kbd part='shortcut'>⌘K</kbd>
        </button>

        <div class='overlay' hidden onClick={this.closeSearchOnBackdrop}>
          <div class='panel' role='dialog' aria-modal='true' aria-label={this.dialogLabel}>
            <input
              type='text'
              class='search-input'
              aria-label={this.inputLabel}
              placeholder={this.placeholder}
              onInput={this.searchFromInput}
            />
            <div
              class='results'
              role='region'
              aria-label={this.resultsLabel}
              aria-live='polite'
              onClick={this.closeSearchFromResults}
            >
              <div class='empty' hidden={this.hasHits}>{this.message}</div>
              {this.hits.map((hit) => (
                <a class='result item' href={hit.href} key={hit.key}>
                  <div class='item-section'>{hit.section}</div>
                  <div class='item-title'>{hit.title}</div>
                  <div class='item-text'>{hit.text}</div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
}
