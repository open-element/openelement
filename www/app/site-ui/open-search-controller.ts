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
  announce,
  input,
  overlay,
  SEARCH_OPEN_INTENT_KEY,
  searchLocale,
  showMessage,
  type SearchHost,
} from './open-search-shared.ts';
import { searchChromeStrings } from './chrome-strings.ts';
import { suggestNotFoundRoute } from './not-found-recovery.ts';
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
  /**
   * The element that opened the dialog: focus returns here on dismissal
   * (P2 audit D3 — Escape/backdrop/result close must not drop focus on body).
   */
  returnFocus: HTMLElement | null;
  removeRecoveryTrigger: (() => void) | null;
  /**
   * The short-lived open-focus guard (see openSearch): removed on close so a
   * previous session's remembered control can never pull focus off the field
   * when the dialog is reopened inside the guard window.
   */
  focusGuard: (() => void) | null;
  /**
   * What the modal took away while open: the pre-open scroll position, the
   * inline overflow values it overwrote, and every background sibling it
   * marked inert. Keep both changes together so dismissal restores the exact prior
   * state, even when opening and closing overlap.
   */
  modal: ModalLock | null;
}

interface ModalLock {
  scrollX: number;
  scrollY: number;
  htmlOverflow: string;
  bodyOverflow: string;
  bodyPaddingRight: string;
  inerted: HTMLElement[];
}

/** True when the element still participates in layout (and is not `hidden`). */
function isVisible(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) return false;
  return element.ownerDocument.defaultView?.getComputedStyle(element).visibility !== 'hidden';
}

/**
 * Lock document scrolling and make every sibling of the overlay's ancestor
 * chain inert. Walking UP from the dialog is what keeps the dialog itself
 * interactive: setting `inert` on the header (the overlay's ancestor) would
 * inert the modal too. Elements already inert before open are not tracked, so
 * a close never removes an app-owned inert state.
 */
function lockModal(host: SearchHost, state: SearchState): void {
  if (state.modal) return;
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const root = doc.documentElement;
  const body = doc.body;
  const lock: ModalLock = {
    scrollX: win?.scrollX ?? 0,
    scrollY: win?.scrollY ?? 0,
    htmlOverflow: root.style.overflow,
    bodyOverflow: body?.style.overflow ?? '',
    bodyPaddingRight: body?.style.paddingRight ?? '',
    inerted: [],
  };
  if (body) {
    // Keep the layout still when the classic scrollbar disappears.
    const bar = Math.max(0, (win?.innerWidth ?? 0) - root.clientWidth);
    if (bar > 0) {
      const current = Number.parseFloat(win?.getComputedStyle(body).paddingRight ?? '') || 0;
      body.style.paddingRight = `${current + bar}px`;
    }
    body.style.overflow = 'hidden';
  }
  root.style.overflow = 'hidden';

  let node: Element | null = overlay(host);
  while (node && node !== body) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      lock.inerted.push(sibling);
    }
    node = parent;
  }
  state.modal = lock;
}

function unlockModal(host: SearchHost, state: SearchState): void {
  const lock = state.modal;
  if (!lock) return;
  state.modal = null;
  for (const element of lock.inerted) element.removeAttribute('inert');
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  doc.documentElement.style.overflow = lock.htmlOverflow;
  if (doc.body) {
    doc.body.style.overflow = lock.bodyOverflow;
    doc.body.style.paddingRight = lock.bodyPaddingRight;
  }
  // Restore the exact pre-open position: an inert/overflow-hidden page can be
  // clamped to 0 by the UA when the scrollbar goes away.
  win?.scrollTo(lock.scrollX, lock.scrollY);
}

/**
 * Keep Tab inside the visible dialog controls. The old handler called
 * preventDefault() on every Tab as soon as the runtime loaded, so the empty
 * state's suggestion buttons and docs link could never receive focus. This
 * trap cycles through exactly the visible controls (including those recovery
 * controls) and wraps at both ends; stopping propagation also keeps the
 * combobox machine's own Tab handling from dismissing the dialog.
 */
function trapTab(host: SearchHost, event: KeyboardEvent): void {
  const panel = host.querySelector<HTMLElement>('.panel');
  if (!panel) {
    event.preventDefault();
    return;
  }
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusable = [...panel.querySelectorAll<HTMLElement>(selector)].filter(isVisible);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const doc = host.ownerDocument;
  const active = doc.activeElement;
  const current = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
  const nextIndex =
    current === -1
      ? event.shiftKey
        ? focusable.length - 1
        : 0
      : event.shiftKey
        ? (current - 1 + focusable.length) % focusable.length
        : (current + 1) % focusable.length;
  // Always move focus ourselves. Letting the browser run its native tab
  // order is what let the combobox's own Tab handling close the popup (and
  // therefore the dialog) before the close button or a chip could take focus.
  // The cycle still visits every visible control in DOM order and wraps.
  event.preventDefault();
  // Capture-phase listener: stop the event before the combobox's own keydown
  // handler sees Tab and dismisses the popup/dialog.
  event.stopPropagation();
  trapFocusing = true;
  focusable[nextIndex]!.focus();
  trapFocusing = false;
}

const states = new WeakMap<SearchHost, SearchState>();

/**
 * True only while the Tab trap is synchronously calling focus(). The focusin
 * it causes can be told apart from the combobox machine's later initial
 * focus, which must not steal focus back from a control the reader already
 * reached.
 */
let trapFocusing = false;
const searchOpenIntent = Symbol.for(SEARCH_OPEN_INTENT_KEY);
type SearchBootHost = SearchHost & { [searchOpenIntent]?: true };

/** The dialog's opener: the header trigger button (the island's `part=trigger`). */
function searchTrigger(host: SearchHost): HTMLElement | null {
  const trigger = host.querySelector<HTMLElement>('button[part="trigger"]');
  if (trigger) return trigger;
  const active = host.ownerDocument.activeElement;
  return active instanceof HTMLElement ? active : null;
}

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
      // Ownership check BEFORE the connect: even awaiting a synchronous call
      // yields a microtask, so two continuations of one in-flight import (a
      // stale install and the reinstall that replaced it) interleave their
      // connect segments — the stale one creates the shared pipeline, the
      // fresh one adopts it, and the stale teardown then deletes it under the
      // published runtime, whose every query silently no-ops on the
      // pipeline-identity guard from then on. A stale continuation must bail
      // before it can build anything.
      if (states.get(host) !== state) {
        throw new Error('open-search host was uninstalled before its import resolved');
      }
      const runtime = await connectSearchRuntime(host, {
        onClose: closeSearch,
      });
      // Re-validate before publishing: an uninstall may have torn this state
      // down (or a reinstall replaced it) while the connect ran. The stale
      // runtime must never wire itself into the new install.
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
  const recoveryTrigger = host.ownerDocument.querySelector<HTMLButtonElement>(
    'button[data-search-recovery]',
  );
  const removeSuggestion = recoveryTrigger ? suggestNotFoundRoute(host.ownerDocument) : undefined;
  const openFromRecovery = (): void => {
    if (recoveryTrigger) openSearch(host, recoveryTrigger);
  };
  const keydown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      overlay(host)?.hidden ? openSearch(host) : closeSearch(host);
    } else if (event.key === 'Escape' && !overlay(host)?.hidden) {
      closeSearch(host);
    } else if (event.key === 'Tab' && !overlay(host)?.hidden) {
      // The trap engages only once the runtime is wired: the overlay shows
      // immediately while the input gains its focus behavior only after the
      // runtime chunk import resolves, and trapping Tab in that window would
      // strand the reader on the background trigger. After that, every visible
      // control is reachable, including the empty state's chips and docs link,
      // and the ends wrap.
      if (states.get(host)?.runtime) trapTab(host, event);
    }
  };
  const state: SearchState = {
    keydown,
    runtime: null,
    connectPromise: null,
    openSequence: 0,
    epoch: 0,
    returnFocus: null,
    removeRecoveryTrigger: recoveryTrigger
      ? () => {
          recoveryTrigger.hidden = true;
          recoveryTrigger.removeEventListener('click', openFromRecovery);
          removeSuggestion?.();
        }
      : null,
    modal: null,
    focusGuard: null,
  };
  states.set(host, state);
  if (recoveryTrigger) {
    recoveryTrigger.addEventListener('click', openFromRecovery);
    recoveryTrigger.hidden = false;
  }
  globalThis.addEventListener('keydown', keydown, { capture: true });

  const bootHost = host as SearchBootHost;
  if (bootHost[searchOpenIntent]) {
    // The connect hook runs before claim. Give normal click replay first
    // use of the intent and open only after the compiled handlers exist.
    queueMicrotask(() => {
      if (states.get(host) !== state || !host.isConnected || !bootHost[searchOpenIntent]) return;
      openSearch(host);
    });
  }
}

export function uninstallSearch(host: SearchHost): void {
  const state = states.get(host);
  if (!state) return;
  globalThis.removeEventListener('keydown', state.keydown, { capture: true });
  state.removeRecoveryTrigger?.();
  // Invalidate every continuation captured against this install BEFORE the
  // runtime goes away: pending open/focus/load work must not write into a
  // reinstalled island (the reinstall's fresh state object fails the
  // identity check above).
  state.epoch++;
  state.focusGuard?.();
  // An open dialog must not outlive its controller: the modal keydown
  // listener is being removed, so a surviving overlay could never be
  // dismissed. Reset to the SSR program shape (hidden overlay, cleared
  // field/message) — exactly what closeSearch leaves behind.
  unlockModal(host, state);
  const target = overlay(host);
  if (target) target.hidden = true;
  const field = input(host);
  if (field) field.value = '';
  showMessage(host, searchChromeStrings(searchLocale()).emptyMessage);
  announce(host, '');
  // Teardown strips every machine-written attribute (the runtime owns that
  // contract): the compiled element runtime re-claims this markup if the
  // host re-connects, and the claim fails closed on any attribute the SSR
  // program does not declare.
  state.runtime?.teardown();
  states.delete(host);
}

export function openSearch(host: SearchHost, opener = searchTrigger(host)): void {
  const target = overlay(host);
  const state = states.get(host);
  if (!target || !state) return;
  // A normal click replay may consume the head script's intent even if the
  // dialog is dismissed again before the queued handoff runs.
  delete (host as SearchBootHost)[searchOpenIntent];
  if (!target.hidden) return;
  // Bind the dismissal focus target to THIS open: the reader returns to the
  // control that opened the dialog, even if focus has drifted since.
  state.returnFocus = opener;
  state.openSequence++;
  const sequence = state.openSequence;
  target.hidden = false;
  lockModal(host, state);
  // The runtime module loads on the first open; the machine's OPEN, the
  // index load, and the input focus land once it is wired (same tick for
  // every later open). Both continuations re-check the captured session:
  // a close/reopen (sequence moved), a teardown (state replaced) or a
  // closed overlay drops the stale work instead of acting on it.
  void ensureRuntime(host)
    .then((runtime) => {
      if (!isCurrentSession(host, state, sequence)) return;
      // The popup IS the results surface: opening the dialog opens the
      // combobox, so the guidance message shows before the first keystroke
      // (the machine's OPEN writes it).
      runtime.open();
      // The index is NOT loaded here (T10 R3): pagefind.js and its wasm
      // (~86 KB compressed) used to ride every open, including opens that were
      // closed again without a character typed. The first real input change
      // triggers loadIndex instead.
      // The dialog is fixed above the page: focusing the field must not
      // scroll the document to the header's flow position (the reader would
      // see the locked page jump to the top behind the scrim).
      const field = input(host);
      field?.focus({ preventScroll: true });
      // Zag's `open` state entry schedules its own initial focus one frame
      // later. If a keyboard reader reaches another dialog control inside
      // that frame (Tab to Close), the machine's focus call must not yank
      // focus back to the field. Watch intra-panel focus for the whole open
      // session (released by closeSearch/uninstallSearch): a focus that
      // arrives synchronously from the Tab trap (or a pointer/click on the
      // panel) is the reader's choice; a bare programmatic focus on the
      // field is the machine's initial focus and is returned to the control
      // the reader had already reached.
      const panel = host.querySelector<HTMLElement>('.panel');
      let moved: HTMLElement | null = null;
      let fromPointer = false;
      const markPointer = (): void => {
        fromPointer = true;
        queueMicrotask(() => {
          fromPointer = false;
        });
      };
      const onPanelFocus = (event: FocusEvent): void => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !panel?.contains(target)) return;
        if (target !== field) {
          moved = target;
          return;
        }
        if (fromPointer || trapFocusing) {
          // The reader focused the field themselves (Tab wrap or click).
          moved = null;
          return;
        }
        if (moved?.isConnected) {
          const back = moved;
          // One restore only: the machine focuses the field once per open,
          // and a later intentional Tab back to the field must not be undone.
          moved = null;
          back.focus({ preventScroll: true });
        }
      };
      const removeGuard = (): void => {
        panel?.removeEventListener('pointerdown', markPointer, true);
        panel?.removeEventListener('click', markPointer, true);
        panel?.removeEventListener('focusin', onPanelFocus, true);
        if (state.focusGuard === removeGuard) state.focusGuard = null;
      };
      // A previous open's guard (same host, still inside its 500ms window)
      // must not observe this open's focus at all.
      state.focusGuard?.();
      state.focusGuard = removeGuard;
      panel?.addEventListener('pointerdown', markPointer, true);
      panel?.addEventListener('click', markPointer, true);
      panel?.addEventListener('focusin', onPanelFocus, true);
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
  // Whether this close actually dismissed an open dialog: the failure path
  // below can call closeSearch for a dialog that never opened, and that path
  // must not yank focus.
  const wasOpen = target !== null && !target.hidden;
  if (target) target.hidden = true;
  const field = input(host);
  if (field) field.value = '';
  const state = states.get(host);
  // Invalidate every open/focus/load continuation captured before this
  // close. The pending module import itself may finish and be reused — only
  // the continuations are dropped.
  if (state) state.openSequence++;
  // Release the modal surface before returning focus: the trigger is inside
  // the header the open made inert, so focusing it first would be a no-op.
  state?.focusGuard?.();
  if (state) unlockModal(host, state);
  // The runtime may not be connected yet (Escape racing the first open); the
  // field + message reset below is the full close for that window.
  state?.runtime?.close();
  showMessage(host, searchChromeStrings(searchLocale()).emptyMessage);
  announce(host, '');
  state?.runtime?.syncHits(host, []);
  // Modal focus restoration (P2 audit D3, APG dialog pattern): a dismissal —
  // Escape, backdrop click, result click — returns the reader to the control
  // that opened the dialog instead of stranding focus on <body>.
  if (wasOpen && state?.returnFocus) {
    const returnFocus = state.returnFocus;
    state.returnFocus = null;
    if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }
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
 * list Block cannot carry per-item event handlers, so the view binds one
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
 * Activating an empty-state suggestion writes its query to the combobox
 * and triggers the same input event as typing. The `data-term` attribute
 * preserves the indexed query when the visible label is translated.
 */
export function searchSuggestedTerm(host: SearchHost, event: Event): void {
  const target = event.target as Element | null;
  const chip = target?.closest('[data-term]');
  const term = chip?.getAttribute('data-term') ?? '';
  const field = input(host);
  if (!field || !term) return;
  field.value = term;
  field.focus();
  // The compiled onInput binding and the combobox machine both subscribe to
  // the input event; dispatching it keeps the two in one state transition.
  field.dispatchEvent(new Event('input', { bubbles: true }));
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
      // The machine attaches its own input listener when the runtime connects;
      // a keystroke that wins the first-open race can reach this compiled
      // binding before that listener exists. Loading the index here too makes
      // the first REAL input pay for Pagefind regardless of which listener
      // saw it first (loadIndex is idempotent).
      runtime.loadIndex(host);
    })
    .catch(() => {
      // This session's load failed while the reader was already typing:
      // close/reset (there is no working dialog without the runtime). A
      // stale session's failure leaves newer sessions alone.
      if (states.get(host) !== state || state.openSequence !== sequence) return;
      closeSearch(host);
    });
}
