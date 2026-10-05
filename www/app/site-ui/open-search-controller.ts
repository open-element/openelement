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
  /**
   * Monotonic open/close session counter. Every async continuation (module
   * import, index load, focus) captures the value at scheduling time and
   * re-checks it before touching the UI, so a close/reopen or a teardown
   * invalidates everything scheduled by earlier sessions.
   */
  openSequence: number;
  /**
   * Bumped by uninstallSearch. Continuations hold the state object itself,
   * so a removed install's stale work can be detected even after a
   * reinstall created a fresh state for the same host element.
   */
  epoch: number;
}

const states = new WeakMap<SearchHost, SearchState>();

/**
 * The guard every continuation runs before acting: the SAME install must
 * still be connected (state identity — a teardown+reinstall replaces the
 * object), no close/reopen may have happened since capture (sequence), and
 * the dialog this session belongs to must still be open.
 */
function isCurrentSession(host: SearchHost, state: SearchState, sequence: number): boolean {
  const current = states.get(host);
  return current === state && current.openSequence === sequence && overlay(host)?.hidden === false;
}

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
      // Re-validate before publishing: an uninstall may have torn this state
      // down (or a reinstall replaced it) while the import was in flight. The
      // stale runtime must never wire itself into the new install.
      if (states.get(host) !== state) {
        runtime.teardown();
        throw new Error('open-search host was uninstalled while connecting');
      }
      state.runtime = runtime;
      state.connectPromise = null;
      return runtime;
    },
  );
  const pending = state.connectPromise;
  // A failed connect clears its own cache entry — and only its own, in case a
  // newer attempt took the slot — so the next open re-attempts the fetch
  // instead of replaying a memoized rejection forever.
  pending.catch(() => {
    if (state.connectPromise === pending) state.connectPromise = null;
  });
  return pending;
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
  states.set(host, { keydown, runtime: null, connectPromise: null, openSequence: 0, epoch: 0 });
  globalThis.addEventListener('keydown', keydown);
}

export function uninstallSearch(host: SearchHost): void {
  const state = states.get(host);
  if (!state) return;
  globalThis.removeEventListener('keydown', state.keydown);
  // Invalidate every continuation captured against this install BEFORE the
  // runtime goes away: pending open/focus/load work must not write into a
  // reinstalled island (the reinstall's fresh state object fails the
  // identity check above).
  state.epoch++;
  // An open dialog must not outlive its controller: the modal keydown
  // listener is being removed, so a surviving overlay could never be
  // dismissed. Reset to the SSR program shape (hidden overlay, cleared
  // field/message) — exactly what closeSearch leaves behind.
  const target = overlay(host);
  if (target) target.hidden = true;
  const field = input(host);
  if (field) field.value = '';
  showMessage(host, searchChromeStrings(searchLocale()).emptyMessage);
  // Teardown strips every machine-written attribute (the runtime owns that
  // contract): the compiled element runtime re-claims this markup if the
  // host re-connects, and the claim fails closed on any attribute the SSR
  // program does not declare.
  state.runtime?.teardown();
  states.delete(host);
}

export function openSearch(host: SearchHost): void {
  const target = overlay(host);
  const state = states.get(host);
  if (!target || !state) return;
  state.openSequence++;
  const sequence = state.openSequence;
  target.hidden = false;
  // The runtime module loads on the first open; the machine's OPEN, the
  // index load, and the input focus land once it is wired (same tick for
  // every later open). Both continuations re-check the captured session:
  // a close/reopen (sequence moved), a teardown (state replaced) or a
  // closed overlay drops the stale work instead of acting on it.
  void ensureRuntime(host)
    .then((runtime) => {
      if (!isCurrentSession(host, state, sequence)) return;
      // The popup IS the results surface: opening the dialog opens the
      // combobox, so the guidance message shows before the first keystroke.
      runtime.open();
      runtime.loadIndex(host);
      input(host)?.focus();
    })
    .catch(() => {
      // This session's load failed: close/reset so the dialog never hangs
      // open half-wired. A stale session's failure must not touch a newer
      // session's UI.
      if (!isCurrentSession(host, state, sequence)) return;
      closeSearch(host);
    });
}

export function closeSearch(host: SearchHost): void {
  const target = overlay(host);
  if (target) target.hidden = true;
  const field = input(host);
  if (field) field.value = '';
  const state = states.get(host);
  // Invalidate every open/focus/load continuation captured before this
  // close. The pending module import itself may finish and be reused — only
  // the continuations are dropped.
  if (state) state.openSequence++;
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
  const state = states.get(host);
  if (!state) return;
  const sequence = state.openSequence;
  void ensureRuntime(host)
    .then((runtime) => {
      // A close (sequence moved) or a teardown (state replaced) between the
      // keystroke and the module load drops the search; the user's next
      // keystroke in the live session re-fires it.
      if (states.get(host) !== state || state.openSequence !== sequence) return;
      runtime.runSearch(host);
    })
    .catch(() => {
      // This session's load failed while the reader was already typing:
      // close/reset (there is no working dialog without the runtime). A
      // stale session's failure leaves newer sessions alone.
      if (states.get(host) !== state || state.openSequence !== sequence) return;
      closeSearch(host);
    });
}
