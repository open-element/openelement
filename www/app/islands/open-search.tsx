/** Compiler-owned search view; browser behavior lives in open-search-controller.ts. */

import { defineIslandConfig } from '@openelement/app';
import { element, OpenElement } from '@openelement/element';
import {
  closeSearchOnBackdrop,
  installSearch,
  openSearch,
  searchFromInput,
  uninstallSearch,
} from '../site-ui/open-search-controller.ts';
import { openSearchStyles } from '../site-ui/open-search-styles.ts';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('open-search')
export default class OpenSearch extends OpenElement {
  static override styles = openSearchStyles;

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
          aria-label='Search'
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
          <span part='label'>Search</span>
          <kbd part='shortcut'>&#x2318;K</kbd>
        </button>

        <div class='overlay' hidden onClick={this.closeSearchOnBackdrop}>
          <div class='panel' role='dialog' aria-modal='true' aria-label='Search'>
            <input
              type='text'
              class='search-input'
              aria-label='Search documentation'
              placeholder='Search documentation...'
              onInput={this.searchFromInput}
            />
            <div class='results' role='region' aria-label='Search results' aria-live='polite'>
              <div class='empty'>Type at least 2 characters to search</div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
