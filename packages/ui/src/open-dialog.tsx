/**
 * @openelement/ui - open-dialog
 *
 * Dialog component using native <dialog> element + popover API.
 * Per WHATWG HTML Living Standard sections 4.11.4 (dialog) and 6.9.2 (popover).
 *
 * v0.44: compiled authoring (ADR-0143). The `open` boolean property drives the
 * compiled bool sink on the inner <dialog>; the top-layer/modal choreography
 * (showModal/show/close) stays imperative in methods. Modal-session state lives
 * in the shared instance-state module (compiled classes carry only @property
 * fields + methods).
 *
 * @csspart overlay - The dialog backdrop/element
 * @csspart header -The header bar
 * @csspart close -The close button
 * @csspart body -The content area (<slot>)
 * @csspart footer -The optional footer slot
 *
 * Usage:
 * ```html
 * <open-dialog label="Dialog title">
 *   <button slot="trigger">Open Dialog</button>
 *   <div>Dialog content here</div>
 * </open-dialog>
 * ```
 *
 * Attributes:
 * - `open` - Presence opens the dialog (reflected into :state(open))
 * - `label` - Title text and aria-label of the dialog
 * - `mode` - `modal` (default, showModal()) or `non-modal` (show()); read at open time
 */
import { effect, element, OpenElement, property } from '@openelement/element';
import { overlayRecipe, recipe } from './component-recipes.ts';
import { readInstanceState, writeInstanceState } from './instance-state.ts';

@element('open-dialog', { root: 'shadow-open', delegatesFocus: true })
export class OpenDialog extends OpenElement {
  static override styles = [
    overlayRecipe,
    recipe(`
    :host {
      display: inline-block;
    }

    ::slotted([slot='trigger']) {
      cursor: pointer;
    }

    dialog {
      border: var(--border-size-1) solid var(--surface-border-strong);
      border-radius: var(--overlay-radius);
      background: var(--surface-overlay);
      color: var(--text-primary);
      padding: var(--size-6);
      max-width: min(90vw, 480px);
      box-shadow: var(--surface-highlight), var(--overlay-shadow);
      font-family: var(--font-sans);
    }

    dialog::backdrop {
      background: color-mix(in srgb, var(--gray-12) 68%, transparent);
      backdrop-filter: blur(8px);
    }

    dialog[open] {
      animation: dialogFadeIn 0.2s ease-out;
    }

    @keyframes dialogFadeIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--size-4);
    }

    .dialog-title {
      font-size: var(--font-size-2);
      font-weight: var(--font-weight-6);
      color: var(--text-primary);
      margin: 0;
    }

    .dialog-close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      font-size: var(--font-size-2);
      line-height: var(--font-lineheight-1);
      padding: var(--size-1);
      border-radius: var(--radius-1);
      transition: color 0.15s ease;
    }

    .dialog-close:hover {
      color: var(--text-primary);
      background: var(--brand-subtle);
    }

    .dialog-body {
      font-size: var(--font-size-1);
      color: var(--text-secondary);
      line-height: var(--font-lineheight-3);
    }

    .dialog-footer {
      margin-top: var(--size-5);
      display: flex;
      justify-content: flex-end;
      gap: var(--size-2);
    }

    :host(:state(open)) dialog {
      display: block;
    }
  `),
  ];

  /** Presence opens the dialog (reflected so JS property sets stay truthful). */
  @property({ reflect: true, type: Boolean })
  open = false;

  @property({ reflect: false })
  label = '';

  render() {
    return (
      <div style='display:contents'>
        <slot name='trigger' onClick={this.handleTrigger}></slot>
        <dialog
          open={this.open}
          aria-label={this.label}
          part='overlay'
          onCancel={this.handleCancel}
          onClose={this.handleNativeClose}
        >
          <div class='dialog-header' part='header'>
            <h2 class='dialog-title'>{this.label}</h2>
            <button
              type='button'
              class='dialog-close'
              part='close'
              aria-label='Close'
              onClick={this.handleClose}
            >
              ×
            </button>
          </div>
          <div class='dialog-body' part='body'>
            <slot></slot>
          </div>
          <div class='dialog-footer' part='footer'>
            <slot name='footer'></slot>
          </div>
        </dialog>
      </div>
    );
  }

  override onCsrRendered(): void {
    this.syncOpenState();
  }

  override onDsdHydrated(): void {
    this.syncOpenState();
  }

  override disconnectedCallback(): void {
    readInstanceState(this, 'openEffect', () => undefined as undefined | (() => void))?.();
    writeInstanceState(this, 'openEffect', undefined);
    super.disconnectedCallback();
  }

  /**
   * Apply the `open` state once the shadow DOM exists, then keep it synced
   * through the compiled signal — an effect over `this.open` covers attribute
   * AND property writes with one channel (both routes convert into the signal
   * before any sink or method runs). SSR markup like `<open-dialog open>`
   * fires attributeChangedCallback at upgrade time — before ElementInternals
   * and the shadow DOM exist — so the initial run here applies that state.
   */
  private syncOpenState(): void {
    this.updateStates();
    this.syncDialogElement();
    const off = effect(() => {
      // Reading the property tracks the signal; the bodies stay idempotent.
      void this.open;
      this.updateStates();
      this.syncDialogElement();
    });
    writeInstanceState(this, 'openEffect', off);
  }

  private updateStates(): void {
    const states = this.stateSet();
    if (!states) return;
    if (this.open) {
      states.add('open');
      states.delete('closed');
    } else {
      states.delete('open');
      states.add('closed');
    }
  }

  /**
   * The kernel attaches ElementInternals only for form-associated hosts, so
   * the dialog (delegatesFocus, not formAssociated) attaches its own once —
   * without it :state(open)/:state(closed) silently never apply (#1226).
   */
  private stateSet(): CustomStateSet | undefined {
    if (this._internals?.states) return this._internals.states;
    let internals = readInstanceState(
      this,
      'internals',
      () => undefined as ElementInternals | undefined,
    );
    if (!internals) {
      if (typeof this.attachInternals !== 'function') return undefined;
      internals = this.attachInternals();
      writeInstanceState(this, 'internals', internals);
    }
    return internals.states;
  }

  show(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
  }

  toggle(): void {
    this.open = !this.open;
  }

  private syncDialogElement(): void {
    const dialog = this.shadowRoot?.querySelector('dialog');
    if (!dialog) return;
    // True once showModal() has run for the current open session (#1030).
    const modalActive = readInstanceState(this, 'modalActive', () => false);
    if (this.open) {
      if ((this.getAttribute('mode') || 'modal') === 'modal') {
        // Modal: showModal() puts the rest of the page on the inert top layer
        // natively — focus, hit-testing, and the accessibility tree are all
        // covered by the platform, so no hand-rolled sibling inert is needed.
        if (modalActive) return;
        // #1030: the compiled bool sink writes `open` onto the inner <dialog>
        // (SSR DSD / CSR first render), so dialog.open may already be true
        // without showModal() having run — that state presents as NON-modal
        // (no top layer, no ::backdrop, no focus containment). Close the
        // attribute-driven open first, then enter the top layer; showModal()
        // on an already-open dialog throws InvalidStateError.
        if (dialog.open) dialog.close();
        dialog.showModal();
        writeInstanceState(this, 'modalActive', true);
      } else if (!dialog.open) {
        // Non-modal: show() leaves the page interactive by design.
        dialog.show();
      }
    } else {
      // A modal session only exits the top layer while the inner `open`
      // attribute is still present. The compiled bool sink subscribes to the
      // same signal and may have already removed it — removing the attribute
      // leaves the dialog :modal and close() is then a spec no-op, so the
      // attribute must be restored before close() (#1226).
      if (modalActive && !dialog.open) dialog.setAttribute('open', '');
      if (dialog.open) dialog.close();
      writeInstanceState(this, 'modalActive', false);
    }
  }

  private handleNativeClose(): void {
    // The attribute→modal transition above close()es the attribute-opened
    // dialog and immediately re-opens it via showModal(); if the resulting
    // close event is dispatched asynchronously it arrives after the re-open
    // (dialog.open true, host attribute still present) and must be ignored.
    const dialog = this.shadowRoot?.querySelector('dialog');
    if (dialog?.open && this.open) return;
    // A close() driven by handleClose (property already cleared) is the same
    // closing session — its open-dialog-close event already fired (#1226).
    if (!this.open) return;
    // A genuine native close (e.g. form method="dialog") finds the platform
    // has already cleared dialog.open.
    this.handleClose();
  }

  private handleClose(): void {
    // Clearing the property updates the compiled signal; the open effect runs
    // updateStates() + syncDialogElement() — no duplicate sync here.
    this.open = false;
    this.dispatchEvent(new CustomEvent('open-dialog-close', { bubbles: true, composed: true }));
  }

  private handleCancel(e: Event): void {
    e.preventDefault();
    this.handleClose();
  }

  private handleTrigger(): void {
    this.toggle();
  }
}
