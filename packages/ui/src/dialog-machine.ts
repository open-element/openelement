/**
 * @openelement/ui - open-dialog top-layer choreography (module helper).
 *
 * The generated element owns the compiled sinks (`open` attribute, `label`
 * sinks); this module owns the imperative state machine the compiled program
 * cannot express: the native <dialog> top-layer moves (showModal / show /
 * close) and the close-echo guards (#1030, #1226). Every function takes the
 * host explicitly — the same host the lifecycle `env` provides — so the unit
 * harness drives them without connecting an element.
 *
 * Modal-session bookkeeping lives in the shared instance-state module (the
 * generated class carries only the declared property fields).
 */
import { readInstanceState, writeInstanceState } from './instance-state.ts';

/** The generated element's declared `open` property, as the component sees it. */
export type DialogHost = HTMLElement & { open: boolean };

/** The subset of the element's `CustomStateSet` the dialog feedback needs. */
export type DialogStates = Pick<CustomStateSet, 'add' | 'delete'>;

/**
 * Mirror the `open` property into the custom states (`:state(open)` /
 * `:state(closed)`).
 */
export function updateDialogStates(host: DialogHost, states: DialogStates | undefined): void {
  if (!states) return;
  if (host.open) {
    states.add('open');
    states.delete('closed');
  } else {
    states.delete('open');
    states.add('closed');
  }
}

function dialogElement(host: DialogHost): HTMLDialogElement | null {
  const dialog = host.shadowRoot?.querySelector('dialog');
  return (dialog as HTMLDialogElement | null) ?? null;
}

/**
 * Apply the `open` state to the inner <dialog> once the shadow DOM exists:
 * the modal session enters the platform top layer exactly once, the
 * attribute-driven open is closed first (#1030), and the exit restores the
 * sink-removed attribute before close() (#1226).
 */
export function syncDialogElement(host: DialogHost): void {
  const dialog = dialogElement(host);
  if (!dialog) return;

  // True once showModal() has run for the current open session (#1030).
  const modalActive = readInstanceState(host, 'modalActive', () => false);
  if (host.open) {
    if ((host.getAttribute('mode') || 'modal') === 'modal') {
      // Modal: showModal() puts the rest of the page on the inert top layer
      // natively — focus, hit-testing, and the accessibility tree are all
      // covered by the platform, so no hand-rolled sibling inert is needed.
      if (modalActive) {
        // The bookkeeping says a session is live, but the platform may have
        // dropped it: disconnecting the host removes the dialog from the top
        // layer (`:modal` goes false) while this state and `dialog.open`
        // survive on the retained nodes. A reconnect re-running the sync must
        // detect the lost session and re-enter instead of presenting a
        // zombie "open" dialog with no backdrop, focus containment or inert.
        if (dialog.matches(':modal')) return;
        writeInstanceState(host, 'modalActive', false);
      }
      // #1030: the compiled bool sink writes `open` onto the inner <dialog>
      // (SSR DSD / CSR first render), so dialog.open may already be true
      // without showModal() having run — that state presents as NON-modal
      // (no top layer, no ::backdrop, no focus containment). Close the
      // attribute-driven open first, then enter the top layer; showModal()
      // on an already-open dialog throws InvalidStateError.
      if (dialog.open) dialog.close();
      dialog.showModal();
      writeInstanceState(host, 'modalActive', true);
    } else if (!dialog.open) {
      // Non-modal: show() leaves the page interactive by design.
      dialog.show();
    }
  } else {
    // A modal session only exits the top layer while the inner `open`
    // attribute is still present. The compiled bool sink subscribes to the
    // same property and may have already removed it — removing the attribute
    // leaves the dialog :modal and close() is then a spec no-op, so the
    // attribute must be restored before close() (#1226).
    if (modalActive && !dialog.open) dialog.setAttribute('open', '');
    if (dialog.open) dialog.close();
    writeInstanceState(host, 'modalActive', false);
  }
}

/**
 * One sync = custom states + top-layer choreography. The generated component
 * calls this once per frame after connect (initial state, including an
 * upgrade-time attribute seed) and on every committed `open` change.
 */
export function syncOpenDialog(host: DialogHost, states: DialogStates | undefined): void {
  updateDialogStates(host, states);
  syncDialogElement(host);
}

/**
 * The user-facing close path (close button, cancel): clear the declared
 * `open` property (the change channel applies the states and the top-layer
 * exit) and dispatch the component's event.
 */
export function handleDialogClose(host: DialogHost): void {
  host.open = false;
  host.dispatchEvent(new CustomEvent('open-dialog-close', { bubbles: true, composed: true }));
}

/**
 * The native `cancel` event (Escape): dismissals are not abortable here, so
 * preventDefault first, then run the close path.
 */
export function handleDialogCancel(host: DialogHost, event: Event): void {
  event.preventDefault();
  handleDialogClose(host);
}

/**
 * The inner dialog's native `close` event. The attribute→modal transition
 * above close()es the attribute-opened dialog and immediately re-opens it via
 * showModal(); if the resulting close event is dispatched asynchronously it
 * arrives after the re-open and must be ignored. A close() driven by
 * handleDialogClose (property already cleared) is the same closing session —
 * its open-dialog-close event already fired (#1226). A genuine native close
 * (e.g. form method="dialog") finds the platform has already cleared
 * dialog.open.
 */
export function handleDialogNativeClose(host: DialogHost): void {
  const dialog = dialogElement(host);
  if (dialog?.open && host.open) return;
  if (!host.open) return;
  handleDialogClose(host);
}
