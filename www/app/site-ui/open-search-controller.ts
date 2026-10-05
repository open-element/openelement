/**
 * Browser-only behavior of the open-search island — the light shell.
 *
 * Everything that can load on demand lives in open-search-combobox.ts (the
 * Zag combobox stack and the whole Pagefind pipeline) and enters the graph
 * through the dynamic import in openSearch(): zero runtime bytes ship before
 * the first dialog open — that is what holds the site's client-JS SLO
 * (www/site-budget.ts). This module owns the dialog-level modal state
 * (overlay/panel, the global shortcut, the focus trap, dismissal) and stays
 * in the always-shipped island payload.
 */
import {
  input,
  overlay,
  searchLocale,
  showMessage,
  type SearchHost,
} from './open-search-shared.ts';
import { searchChromeStrings } from './chrome-strings.ts';
import type { SearchRuntime } from './open-search-combobox.ts';

interface SearchState {
  keydown: (event: KeyboardEvent) => void;
  /** Connected lazily on first open; null until then (and after teardown). */
  runtime: SearchRuntime | null;
  connectPromise: Promise<SearchRuntime> | null;
}

const states = new WeakMap<SearchHost, SearchState>();

/**
 * Connect the runtime module on first open. The import is the lazy boundary:
 * the Zag + Pagefind stack parses only for a reader who actually opens
 * search.
 */
function ensureRuntime(host: SearchHost): Promise<SearchRuntime> {
  const state = states.get(host);
  if (!state) return Promise.reject(new Error('open-search host is not installed'));
  if (state.runtime) return Promise.resolve(state.runtime);
  state.connectPromise ??= import('./open-search-combobox.ts').then(
    async ({ connectSearchRuntime }) => {
      const runtime = await connectSearchRuntime(host, {
        onClose: closeSearch,
      });
      state.runtime = runtime;
      state.connectPromise = null;
      return runtime;
    },
  );
  return state.connectPromise;
}

export function installSearch(host: SearchHost): void {
  if (states.has(host)) return;
  const keydown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      overlay(host)?.hidden ? openSearch(host) : closeSearch(host);
    } else if (event.key === 'Escape' && !overlay(host)?.hidden) {
      closeSearch(host);
    } else if (event.key === 'Tab' && !overlay(host)?.hidden) {
      // Modal focus trap: the dialog's single focusable node is the combobox
      // input (the options are activedescendant targets, not stops), so Tab
      // must not fall through to the page behind the modal.
      event.preventDefault();
    }
  };
  states.set(host, { keydown, runtime: null, connectPromise: null });
  globalThis.addEventListener('keydown', keydown);
}

export function uninstallSearch(host: SearchHost): void {
  const state = states.get(host);
  if (!state) return;
  globalThis.removeEventListener('keydown', state.keydown);
  // Teardown strips every machine-written attribute (the runtime owns that
  // contract): the compiled element runtime re-claims this markup if the
  // host re-connects, and the claim fails closed on any attribute the SSR
  // program does not declare.
  state.runtime?.teardown();
  states.delete(host);
}

export function openSearch(host: SearchHost): void {
  const target = overlay(host);
  if (!target) return;
  target.hidden = false;
  // The runtime module loads on the first open; the machine's OPEN, the
  // index load, and the input focus land once it is wired (same tick for
  // every later open).
  void ensureRuntime(host).then((runtime) => {
    if (!states.has(host)) return;
    // The popup IS the results surface: opening the dialog opens the
    // combobox, so the guidance message shows before the first keystroke.
    runtime.open();
    runtime.loadIndex(host);
    input(host)?.focus();
  });
}

export function closeSearch(host: SearchHost): void {
  const target = overlay(host);
  if (target) target.hidden = true;
  const field = input(host);
  if (field) field.value = '';
  const state = states.get(host);
  // The runtime may not be connected yet (Escape racing the first open); the
  // field + message reset below is the full close for that window.
  state?.runtime?.close();
  showMessage(host, searchChromeStrings(searchLocale()).emptyMessage);
  state?.runtime?.syncHits(host, []);
}

/** Backdrop dismissal, bound by the compiled view on the overlay. */
export function closeSearchOnBackdrop(host: SearchHost, event: Event): void {
  const inPanel = event
    .composedPath()
    .some((node) => node instanceof Element && node.classList.contains('panel'));
  if (!inPanel) closeSearch(host);
}

/**
 * Result-click dismissal, delegated from the results container: the compiled
 * list Region cannot carry per-item event handlers, so the view binds one
 * onClick on `.results` and this handler closes the search when the click
 * lands on a result link (the machine's Enter-path navigation also lands
 * here — clickIfLink dispatches a real click on the highlighted anchor).
 */
export function closeSearchFromResults(host: SearchHost, event: Event): void {
  const onResult = event
    .composedPath()
    .some((node) => node instanceof Element && node.classList.contains('result'));
  if (onResult) closeSearch(host);
}

/**
 * The compiled view's input binding. Typing is only possible while the
 * dialog is open, by which point the runtime module is loaded; the promise
 * keeps this binding valid even in that first-open window.
 */
export function searchFromInput(host: SearchHost): void {
  void ensureRuntime(host).then((runtime) => runtime.runSearch(host));
}
