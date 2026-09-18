/** Compiler-owned search view; browser behavior lives in open-search-controller.ts. */

import { defineIslandConfig } from '@openelement/router';
import { computed, element, OpenElement, property } from '@openelement/element';
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

  // Chrome copy is finalized at SSR in the page locale: the shell passes the
  // strings as attributes (see open-layout.tsx); the English field defaults
  // are the standalone fallback and are pinned verbatim by e2e/search.spec.
  // Dynamic search-time messages (no-results, index-missing) still come from
  // open-search-controller.ts.
  @property({ reflect: true, attribute: 'locale' })
  locale = 'en';
  @property({ reflect: false, attribute: 'trigger' })
  triggerLabel = 'Search';
  @property({ reflect: false, attribute: 'dialog' })
  dialogLabel = 'Search';
  @property({ reflect: false, attribute: 'input' })
  inputLabel = 'Search documentation';
  @property({ reflect: false, attribute: 'placeholder' })
  placeholder = 'Search documentation...';
  @property({ reflect: false, attribute: 'results' })
  resultsLabel = 'Search results';
  @property({ reflect: false, attribute: 'empty' })
  emptyMessage = 'Type at least 2 characters to search';
  @property({ reflect: false, attribute: 'message' })
  message = '';
  @property({ reflect: false, attribute: false })
  hasHits = false;
  @property({ reflect: false, attribute: false })
  searching = false;
  @property({ reflect: false, attribute: false })
  hits: SearchHit[] = [];
  // Skeleton shows only over an empty result area (first search / index
  // load); the idle message hides while it is up. Both toggle through
  // `hidden` — Region branches must stay static (OEC9012).
  @property({ reflect: false, attribute: false })
  hideSkeleton = computed(() => !this.searching || this.hasHits);
  @property({ reflect: false, attribute: false })
  hideEmpty = computed(() => this.hasHits || this.searching);

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

        <div class='overlay' hidden data-pagefind-ignore onClick={this.closeSearchOnBackdrop}>
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
              <div class='empty' hidden={this.hideEmpty}>{this.message}</div>
              <div class='skeleton' hidden={this.hideSkeleton} aria-hidden='true'>
                <span></span>
                <span></span>
                <span></span>
              </div>
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
