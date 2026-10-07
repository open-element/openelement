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
import { compiledStyle } from '../site-ui/compiled-style.ts';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

// Same-module style sheet (ADR-0164 §4): the island style asset protocol
// admits only statically provable, same-module sheets — the compiler erases
// this const from the island chunk and emits its bytes as the component's
// `.oe-style.css` asset. Cross-module sheet imports fail closed (OEC9028).
const openSearchStyles = [
  compiledStyle(`
  :host {
    display: inline-flex;
    align-items: center;
    contain: none;
  }
  .search-root { display: contents; }
  .search-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: calc(var(--spacing) * 9);
    height: calc(var(--spacing) * 9);
    padding: 0;
    border: 0;
    border-radius: calc(infinity * 1px);
    background: transparent;
    color: var(--color-foreground);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0;
    box-shadow: none;
    cursor: pointer;
    transition: all var(--ease-in-out) var(--default-transition-duration);
  }
  .search-trigger:hover {
    color: var(--color-primary);
    border-color: transparent;
    background: color-mix(in srgb, color-mix(in srgb, var(--color-primary) 16%, transparent) 34%, transparent);
  }
  .search-trigger kbd {
    font-family: inherit;
    padding: calc(var(--spacing) * 1) calc(var(--spacing) * 1);
    border: calc(var(--spacing) * 0.25) solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    margin-left: calc(var(--spacing) * 1);
  }
  .search-trigger span, .search-trigger kbd { display: none; }
  .search-icon { display: inline-block; width: calc(var(--spacing) * 5); height: calc(var(--spacing) * 5); }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    width: 100vw;
    height: 100vh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 15vh 0 0;
    border: 0;
    color: inherit;
    background: color-mix(in srgb, var(--color-zinc-950) 44%, transparent);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    box-sizing: border-box;
  }
  .overlay[hidden] { display: none; }
  /* The panel is the input card; the results live in the combobox popup
     (Zag positioning channel → Floating UI), anchored under the control row
     at the same width. */
  .panel {
    width: 100%;
    max-width: 560px;
    margin: 0 calc(var(--spacing) * 4);
    background: var(--color-background);
    border: calc(var(--spacing) * 0.25) solid var(--color-border);
    border-radius: var(--radius-2xl);
    box-shadow: 0 calc(var(--spacing) * 4) calc(var(--spacing) * 16) color-mix(in srgb, var(--color-primary) 18%, transparent);
    overflow: hidden;
  }
  .results-label {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    clip-path: inset(50%);
    overflow: hidden;
    white-space: nowrap;
  }
  .control { display: block; }
  .search-input {
    display: block;
    width: 100%;
    padding: calc(var(--spacing) * 3) calc(var(--spacing) * 3);
    border: none;
    border-bottom: 0.5px solid var(--color-border);
    border-radius: 0;
    background: transparent;
    /* Semantic role, not a bare zinc: the dark theme's popover token is also
       zinc-900, so a raw zinc-900 pairing never flips and reads ~1:1 there. */
    color: var(--color-foreground);
    font-size: var(--text-base);
    box-sizing: border-box;
    font-family: inherit;
  }
  /* The positioner is Floating UI's coordinate box: clicks pass through it so
     the backdrop outside the listbox card still dismisses the dialog. */
  .results-positioner { z-index: 1; pointer-events: none; }
  .results { pointer-events: auto; }
  .results {
    overflow-y: auto;
    max-height: min(50vh, 26rem);
    padding: calc(var(--spacing) * 3) 0;
    background: var(--color-popover);
    border: calc(var(--spacing) * 0.25) solid var(--color-border);
    border-radius: var(--radius-xl);
    box-shadow: 0 calc(var(--spacing) * 4) calc(var(--spacing) * 16) color-mix(in srgb, var(--color-primary) 18%, transparent);
  }
  .item {
    display: block;
    padding: calc(var(--spacing) * 3) calc(var(--spacing) * 3);
    text-decoration: none;
    color: inherit;
    transition: background var(--ease-in-out) var(--default-transition-duration);
    cursor: pointer;
  }
  /* Pointer hover and keyboard highlight share one surface tone (the accent
     role, per the shadcn command pattern). */
  .item:hover, .item[data-highlighted] { background: var(--color-accent); }
  .item-section {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-widest);
    color: var(--color-muted-foreground);
    margin-bottom: calc(var(--spacing) * 1);
  }
  .item-title {
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
    /* Popover-foreground pairs with the results card's popover background
       (raw zinc-900 stayed zinc-900 in dark, where the popover also becomes
       zinc-900 — 1:1, invisible). */
    color: var(--color-popover-foreground);
    margin-bottom: calc(var(--spacing) * 1);
  }
  .item-text {
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
    line-height: var(--leading-normal);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .empty {
    padding: calc(var(--spacing) * 9) calc(var(--spacing) * 3);
    text-align: center;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }
  /* A blank message must never leave a padded empty box behind. */
  .empty:empty {
    display: none;
  }
  /* Loading skeleton: static bars (no shimmer — motion-safe by
     construction), shaped like result rows. */
  .skeleton {
    display: grid;
    gap: calc(var(--spacing) * 3);
    padding: calc(var(--spacing) * 3);
  }
  .skeleton[hidden] {
    display: none;
  }
  .skeleton span {
    display: block;
    height: calc(var(--spacing) * 8);
    border-radius: var(--radius-md);
    background: var(--color-muted);
  }
`),
];

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
            {/* The combobox state machine (Zag, open-search-controller.ts) owns
                the ARIA graph: role=combobox on the input, role=listbox on the
                results, aria-activedescendant across them. The static markup
                carries only the chrome (ids, labels, classes); everything the
                machine drives is applied at hydration and never SSR'd — the
                Region branches below stay static (OEC9012). The visually
                hidden label names the listbox through the machine's
                aria-labelledby wiring. */}
            <label id='open-search-results-label' class='results-label' for='open-search-input'>
              {this.resultsLabel}
            </label>
            <div id='open-search-control' class='control'>
              <input
                type='text'
                id='open-search-input'
                class='search-input'
                aria-label={this.inputLabel}
                placeholder={this.placeholder}
                onInput={this.searchFromInput}
              />
            </div>
            <div id='open-search-positioner' class='results-positioner'>
              <div id='open-search-results' class='results' onClick={this.closeSearchFromResults}>
                <div class='empty' hidden={this.hideEmpty}>
                  {this.message}
                </div>
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
      </div>
    );
  }
}
