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

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('open-search')
export default class OpenSearch extends OpenElement {
  // Rules moved to the linked document stylesheet (www/site-chrome.css): the
  // SSR payload and the upgraded island read the one document sheet.

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
  // `hidden` — Block branches must stay static (OEC9012).
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
      <div class='contents'>
        <button
          type='button'
          class='inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 font-bold tracking-normal text-(length:--text-xs) text-foreground shadow-none transition-all hover:border-transparent hover:bg-primary/[5.44%] hover:text-primary'
          part='trigger'
          aria-label={this.triggerLabel}
          onClick={this.openSearch}
        >
          <svg
            class='inline-block size-5'
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
          <span class='hidden' part='label'>
            {this.triggerLabel}
          </span>
          <kbd
            class='ml-1 hidden rounded-md border border-border p-1 text-(length:--text-xs) [font-family:inherit]'
            part='shortcut'
          >
            ⌘K
          </kbd>
        </button>

        <div
          class='overlay fixed inset-0 z-[99999] box-border flex h-screen w-screen max-h-none max-w-none items-start justify-center m-0 border-0 pt-[15vh] text-inherit backdrop-blur-[18px]'
          hidden
          data-pagefind-ignore
          onClick={this.closeSearchOnBackdrop}
        >
          <div
            class='panel mx-4 w-full max-w-[560px] overflow-hidden rounded-2xl border border-border bg-background shadow-[0_1rem_4rem_color-mix(in_srgb,var(--color-primary)_18%,transparent)]'
            role='dialog'
            aria-modal='true'
            aria-label={this.dialogLabel}
          >
            {/* The combobox state machine (Zag, open-search-controller.ts) owns
                the ARIA graph: role=combobox on the input, role=listbox on the
                results, aria-activedescendant across them. The static markup
                carries only the chrome (ids, labels, classes); everything the
                machine drives is applied at hydration and never SSR'd — the
                Block branches below stay static (OEC9012). The visually
                hidden label names the listbox through the machine's
                aria-labelledby wiring. */}
            <label id='open-search-results-label' class='sr-only' for='open-search-input'>
              {this.resultsLabel}
            </label>
            <div id='open-search-control' class='block'>
              <input
                type='text'
                id='open-search-input'
                class='search-input box-border block w-full rounded-none border-0 border-b-[0.5px] border-b-border bg-transparent px-3 py-3 text-(length:--text-base) text-foreground [font-family:inherit]'
                aria-label={this.inputLabel}
                placeholder={this.placeholder}
                onInput={this.searchFromInput}
              />
            </div>
            <div id='open-search-positioner' class='pointer-events-none z-[1]'>
              <div
                id='open-search-results'
                class='pointer-events-auto max-h-[min(50vh,26rem)] overflow-y-auto rounded-xl border border-border bg-popover py-3 shadow-[0_1rem_4rem_color-mix(in_srgb,var(--color-primary)_18%,transparent)]'
                onClick={this.closeSearchFromResults}
              >
                <div
                  class='px-3 py-9 text-center text-(length:--text-sm) text-muted-foreground empty:hidden'
                  hidden={this.hideEmpty}
                  data-empty
                >
                  {this.message}
                </div>
                <div
                  class='grid gap-3 p-3'
                  hidden={this.hideSkeleton}
                  aria-hidden='true'
                  data-skeleton
                >
                  <span class='block h-8 rounded-md bg-muted'></span>
                  <span class='block h-8 rounded-md bg-muted'></span>
                  <span class='block h-8 rounded-md bg-muted'></span>
                </div>
                {this.hits.map((hit) => (
                  <a
                    class='result block cursor-pointer p-3 text-inherit no-underline transition-[background] hover:bg-accent data-[highlighted]:bg-accent'
                    href={hit.href}
                    key={hit.key}
                  >
                    <div class='mb-1 text-(length:--text-xs) tracking-widest text-muted-foreground uppercase'>
                      {hit.section}
                    </div>
                    <div class='mb-1 text-(length:--text-sm) font-medium text-popover-foreground'>
                      {hit.title}
                    </div>
                    <div class='line-clamp-2 text-(length:--text-sm) leading-normal text-muted-foreground'>
                      {hit.text}
                    </div>
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
