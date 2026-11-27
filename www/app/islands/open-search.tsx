/** @jsxImportSource @openelement/element */
/** Compiler-owned search view; browser behavior lives in open-search-controller.ts. */

import { onConnect, onDispose } from '@openelement/element/lifecycle';
import { defineIslandConfig } from '@openelement/router';
import {
  closeSearch,
  closeSearchFromResults,
  closeSearchOnBackdrop,
  installSearch,
  openSearch,
  searchFromInput,
  searchSuggestedTerm,
  uninstallSearch,
} from '../site-ui/open-search-controller.ts';
import type { SearchHost } from '../site-ui/open-search-shared.ts';

/**
 * One rendered hit row, admitted to the props record.
 *
 * Declared HERE rather than imported: the generated lane proves a non-primitive
 * row's shape from a same-module type/interface alias (or an inline literal) and
 * refuses an imported element type (`OEIR_GENERATED_ELEMENT_PROPS_TYPE_UNSUPPORTED`),
 * because a shape it cannot read would be silently dropped from the property
 * channel. The members mirror `SearchHit` in `../site-ui/open-search-shared.ts`,
 * which stays the single authority for what the controller WRITES; this alias is
 * the read-side spelling the compiler can prove.
 */
interface SearchHitRow {
  key: string;
  href: string;
  section: string;
  title: string;
  /** Pre-split around the matched term so the view can own the `<mark>`. */
  before: string;
  match: string;
  after: string;
}

export const openElement = defineIslandConfig({
  // LIGHT, not the DSD default: `@element('open-search')` carried no root option,
  // so the class lane compiled a light-root program and the built page carries
  // `data-oe-light` with the content inline. `www/site-chrome.css` selects
  // `open-search .overlay` in the document tree, which a shadow root would put
  // out of reach — declaring `shadow` would be a behaviour change dressed as a
  // migration (compiled slot updates).
  root: 'light',
  hydrate: 'load',
  ssr: true,
  // Chrome copy is finalized at SSR in the page locale: the shell passes the
  // strings as attributes (see layout.tsx); the English field defaults are the
  // standalone fallback and are pinned verbatim by e2e/search.spec.
  // Dynamic search-time messages (no-results, index-missing) still come from
  // open-search-controller.ts.
  properties: {
    locale: { reflect: true, attribute: 'locale', default: 'en' },
    triggerLabel: { attribute: 'trigger', default: 'Search' },
    dialogLabel: { attribute: 'dialog', default: 'Search' },
    inputLabel: { attribute: 'input', default: 'Search documentation' },
    placeholder: { attribute: 'placeholder', default: 'Search documentation...' },
    resultsLabel: { attribute: 'results', default: 'Search results' },
    emptyMessage: { attribute: 'empty', default: 'Type at least 2 characters to search' },
    message: { attribute: 'message', default: '' },
    closeLabel: { attribute: 'close', default: 'Close dialog' },
    // Written by the controller after a round lands: the visible result count
    // and the polite live-region text share this one formatted string.
    resultCount: { attribute: false, default: '' },
    // The empty state's recovery path: three suggested queries and the docs
    // index. Strings are server-rendered per locale (layout.tsx pulls them
    // from searchChromeStrings); `termN` is both the chip label and the query
    // it runs, so the view needs no separate table.
    suggestionLabel: { attribute: 'suggestion-label', default: 'Try:' },
    term1: { attribute: 'term1', default: '' },
    term2: { attribute: 'term2', default: '' },
    term3: { attribute: 'term3', default: '' },
    docsHref: { attribute: 'docs-href', default: '/docs/' },
    docsLabel: { attribute: 'docs-label', default: 'Browse the docs index' },
    // The controller writes these three. `hits` is the rendered list and takes
    // the JSON seed channel (ADR-0182 D-18c), so the server-rendered rows survive
    // the claim instead of the instance reverting to an empty array.
    hasHits: { attribute: false, default: false },
    searching: { attribute: false, default: false },
    hits: { attribute: false, default: [] },
  },
});

/**
 * The search dialog.
 *
 * The class lane's two `computed` rows are inlined at their `hidden` sinks: the
 * generated lane has no authoring `computed` (2026-11-18 ruling), and an
 * attribute position admits the expression directly, so each sink keeps its own
 * dependency edge instead of becoming a setup-time one-shot.
 *
 * The rules the class kept in `static styles` are Tailwind utilities on this
 * markup; `www/site-chrome.css` keeps the host box and the scrim ink, selected
 * through the light-root tag exactly as before.
 */
function OpenSearch(props: {
  locale: string;
  triggerLabel: string;
  dialogLabel: string;
  inputLabel: string;
  placeholder: string;
  resultsLabel: string;
  emptyMessage: string;
  message: string;
  closeLabel: string;
  resultCount: string;
  suggestionLabel: string;
  term1: string;
  term2: string;
  term3: string;
  docsHref: string;
  docsLabel: string;
  hasHits: boolean;
  searching: boolean;
  hits: SearchHitRow[];
}) {
  // Every controller helper is host-keyed. A LIGHT root has no shadow boundary,
  // so `getRootNode().host` would hand back the Document; the host is the nearest
  // `open-search` ancestor of the event target. Declared as a component-local
  // const arrow (the idiom this lane admits) and read only inside event handlers,
  // never in a tracked JSX slot (compiled slot updates).
  const hostOf = (event: Event): SearchHost =>
    (event.currentTarget as HTMLElement).closest('open-search') as SearchHost;

  onConnect((env) => {
    installSearch(env.host as SearchHost);
    // The class lane's `disconnectedCallback` was this exact point: the
    // connection-scope signal aborts at the start of a disconnect, so a reconnect
    // reinstalls against a fresh state object. `uninstallSearch` is guarded by its
    // own state map, so the dispose below is a no-op after this already ran.
    env.signal.addEventListener('abort', () => uninstallSearch(env.host as SearchHost), {
      once: true,
    });
  });
  onDispose((env) => {
    // Element teardown, the class lane's other release point: never leave the
    // module-level keydown listener behind a disposed host.
    uninstallSearch(env.host as SearchHost);
  });

  return (
    <div class='contents'>
      <button
        type='button'
        class='oe-search-trigger inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-transparent px-1.5 font-bold tracking-normal text-(length:--text-xs) text-foreground shadow-none transition-all hover:border-transparent hover:bg-primary/[5.44%] hover:text-primary'
        part='trigger'
        aria-label={props.triggerLabel}
        title='⌘K / Ctrl K'
        onClick={(event: Event) => openSearch(hostOf(event))}
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
          {props.triggerLabel}
        </span>
        {/* The visible shortcut hint follows the platform. The
            pre-paint script records `html[data-platform]`; CSS shows exactly
            one glyph set, so the SSR bytes already carry both variants and the
            label never swaps after hydration. The title on the trigger names
            both chords, and the controller accepts metaKey and ctrlKey alike.
            aria-hidden keeps the button's accessible name the trigger label. */}
        <kbd
          class='oe-search-kbd rounded-md border border-border px-1 py-0.5 font-mono text-(length:--font-size-micro) leading-none'
          part='shortcut'
          aria-hidden='true'
        >
          <span class='oe-search-kbd-apple'>⌘K</span>
          <span class='oe-search-kbd-other'>Ctrl K</span>
        </kbd>
      </button>

      {/* The overlay's `hidden` must be an EXPRESSION with a CONSTANT value —
          `hidden={true}`, never the bare JSX shorthand — and both halves of that
          matter:

          - Bare `hidden` compiles to a STATIC attribute seed, so a reconnect
            re-claim re-validates it against the SSR bytes. The controller owns
            this attribute at run time (`openSearch` clears it, `closeSearch`
            restores it), so the re-claim failed closed with
            `OEIR_LEAF_CLAIM_MISMATCH` in the reconnect race of
            e2e/search.spec.ts. As an expression the compiler classifies it
            dynamic, records it in the claim's skip list, and still emits
            `hidden=""` for SSR.
          - The value must not READ A ROW. The generated props record has one
            coarse change signal, so `hidden={!props.searching}` rebinds to every
            props commit — and once results land the controller sets
            `searching: false` while the dialog must stay OPEN, so the refresh
            slammed it shut and 16 of 20 specs failed. A constant expression has
            zero dependencies, so no refresh is bound and the controller remains
            the single run-time writer.

          `jsx-boolean-value` is disabled on the attribute line itself: its
          canonical spelling is exactly the static form that breaks the re-claim. */}
      <div
        class='overlay fixed inset-0 z-[99999] box-border flex h-screen w-screen max-h-none max-w-none items-start justify-center m-0 border-0 pt-[15vh] text-inherit backdrop-blur-[18px]'
        // oxlint-disable-next-line react/jsx-boolean-value
        hidden={true}
        data-pagefind-ignore
        onClick={(event: Event) => closeSearchOnBackdrop(hostOf(event), event)}
      >
        <div
          class='panel mx-4 w-full max-w-[560px] overflow-hidden rounded-2xl border border-border bg-background shadow-[0_1rem_4rem_color-mix(in_srgb,var(--color-primary)_18%,transparent)]'
          role='dialog'
          aria-modal='true'
          aria-label={props.dialogLabel}
        >
          {/* The combobox state machine (Zag, open-search-controller.ts) owns the
              ARIA graph: role=combobox on the input, role=listbox on the
              results, aria-activedescendant across them. The static markup
              carries only the chrome (ids, labels, classes); everything the
              machine drives is applied at hydration and never SSR'd — the
              Block branches below stay static (OEC9012). The visually hidden
              label names the listbox through the machine's aria-labelledby
              wiring. */}
          <label id='open-search-results-label' class='sr-only' for='open-search-input'>
            {props.resultsLabel}
          </label>
          <div id='open-search-control' class='flex items-stretch'>
            <input
              type='text'
              id='open-search-input'
              class='search-input min-w-0 flex-1 border-0 bg-transparent px-3 py-3 text-(length:--text-base) text-foreground [font-family:inherit]'
              aria-label={props.inputLabel}
              placeholder={props.placeholder}
              onInput={(event: Event) => searchFromInput(hostOf(event))}
            />
            {/* The visible close button complements Escape and backdrop clicks. The target is
                44px under a coarse pointer (site-chrome.css), and the label
                comes from the page locale so both trees read naturally. */}
            <button
              type='button'
              id='open-search-close'
              class='search-close inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring'
              aria-label={props.closeLabel}
              title={props.closeLabel}
              onClick={(event: Event) => closeSearch(hostOf(event))}
            >
              {'×'}
            </button>
          </div>
          <div id='open-search-positioner' class='pointer-events-none z-[1]'>
            <div class='search-popover pointer-events-auto'>
              {/* The visible count sits outside the listbox, so the
                  machine-owned role=listbox still owns only option children.
                  It shares its text with the live region the controller writes. */}
              <div
                id='open-search-count'
                class='search-count-row flex items-center justify-between px-3 pt-3 font-mono text-(length:--font-size-micro) text-muted-foreground'
                hidden={!props.hasHits}
                data-count
              >
                {props.resultCount}
              </div>
              <div
                id='open-search-results'
                class='search-results overflow-y-auto py-3'
                onClick={(event: Event) => closeSearchFromResults(hostOf(event), event)}
              >
                {/* Skeleton shows only over an empty result area (first search /
                  index load); the idle message hides while it is up. The class
                  lane's `hideEmpty` / `hideSkeleton` `computed` rows inline at
                  these two `hidden` sinks, each keeping its own refresh edge
                  (compiled slot updates). */}
                <div
                  class='px-3 py-6 text-center text-(length:--text-sm) text-muted-foreground empty:hidden'
                  hidden={props.hasHits || props.searching}
                  data-empty
                >
                  {props.message}
                  {/* The idle and no-results states share the
                    same sink, so both get working suggestions and a way into
                    the docs index instead of a dead end. One delegated
                    handler on the terms row keeps the compiled island small;
                    the controller writes the chip's data-term into the input
                    and re-runs the existing input path, so no second search
                    engine exists. */}
                  <div class='search-empty-help'>
                    <span class='search-empty-label'>{props.suggestionLabel}</span>
                    <span
                      class='search-empty-terms'
                      onClick={(event: Event) => searchSuggestedTerm(hostOf(event), event)}
                    >
                      <button type='button' class='search-suggestion' data-term={props.term1}>
                        {props.term1}
                      </button>
                      <button type='button' class='search-suggestion' data-term={props.term2}>
                        {props.term2}
                      </button>
                      <button type='button' class='search-suggestion' data-term={props.term3}>
                        {props.term3}
                      </button>
                    </span>
                    <a class='search-empty-docs' href={props.docsHref}>
                      {props.docsLabel}
                    </a>
                  </div>
                </div>
                <div
                  class='grid gap-3 p-3'
                  hidden={!props.searching || props.hasHits}
                  aria-hidden='true'
                  data-skeleton
                >
                  {/* A mapped list, not three static siblings: three fully
                    static sibling elements compile to a static-sibling
                    DIRECTORY, and a committed directory stays permanently
                    consumed (M07-4 records this: "a directory claim that
                    commits every declared range stays permanent"), so the
                    reconnect below re-claims a directory it can never reopen.
                    A list keeps the same three `<span>` bytes and re-arms on
                    every connection. */}
                  {[0, 1, 2].map((row) => (
                    <span key={row} class='block h-8 rounded-md bg-muted'></span>
                  ))}
                </div>
                {props.hits.map((hit) => (
                  <a
                    class='result block cursor-pointer p-3 text-inherit no-underline transition-[background] hover:bg-accent data-[highlighted]:bg-accent'
                    href={hit.href}
                    key={hit.key}
                  >
                    <div class='mb-1 text-(length:--text-xs) tracking-widest text-muted-foreground uppercase'>
                      {hit.section}
                    </div>
                    <div class='mb-1 truncate text-(length:--text-sm) font-medium text-popover-foreground'>
                      {hit.title}
                    </div>
                    <div class='line-clamp-2 text-(length:--text-sm) leading-normal text-muted-foreground'>
                      {hit.before}
                      <mark class='search-hit-mark'>{hit.match}</mark>
                      {hit.after}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>
          {/* Polite live region, empty at SSR. The controller writes the
              loading/result/no-result text with textContent only. */}
          <p
            id='open-search-status'
            class='sr-only'
            role='status'
            aria-live='polite'
            aria-atomic='true'
          ></p>
        </div>
      </div>
    </div>
  );
}

export default OpenSearch;
