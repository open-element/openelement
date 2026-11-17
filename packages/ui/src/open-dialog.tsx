/**
 * @openelement/ui - open-dialog
 *
 * Dialog component using native <dialog> element + popover API.
 * Per WHATWG HTML Living Standard sections 4.11.4 (dialog) and 6.9.2 (popover).
 *
 * Experimental (owner ruling C1, #1468): no compatibility promise — may
 * change or be removed before 1.0.
 *
 * Generated authoring. The `open` property drives the compiled bool sink on
 * the inner <dialog> and the declared `label` drives the aria-label/text
 * sinks; the top-layer/modal choreography (showModal/show/close) and the
 * close-echo guards stay imperative in the dialog-machine module helper, run
 * from the lifecycle intrinsics (ADR-0182). The class lane's `show` / `close`
 * / `toggle` methods are property sugar and are retired with the class export:
 * drive the declared `open` property instead (`el.open = true`).
 *
 * @csspart overlay - The dialog backdrop/element
 * @csspart header -The header bar
 * @csspart close -The close button
 * @csspart body -The content area (<slot>)
 * @csspart footer -The optional footer slot
 *
 * Entry/exit transitions ride `transition-behavior: allow-discrete` +
 * `@starting-style` (the allow-discrete dialog recipe, cf. upstream #591),
 * so open AND close animate
 * while the display flip and top-layer membership wait for the exit
 * transition. Under `forced-colors: active` (and `prefers-reduced-motion`)
 * the transitions collapse: the dialog appears and dismisses immediately
 * instead of fighting the system-owned rendering.
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
import { onConnect, onPropertyChange } from '@openelement/element';

import { defineComponentConfig } from './component-config.ts';
import {
  handleDialogCancel,
  handleDialogNativeClose,
  syncOpenDialog,
  type DialogHost,
} from './dialog-machine.ts';

/**
 * Platform facts for the generated element: shadow root with delegated focus,
 * the authored package stylesheets, and the declared `open`/`label` property
 * rows (`open` reflects; `label` keeps its observable attribute without
 * reflection — the class lane's exact surface).
 */
export const openElement = defineComponentConfig({
  root: 'shadow',
  delegatesFocus: true,
  styles: ['./overlay-recipe.css', './open-dialog.css'],
  properties: {
    open: { default: false, reflect: true },
    label: { default: '' },
  },
});

/** Dialog component using native <dialog> element + popover API. */
function OpenDialog(props: { open: boolean; label: string }) {
  /** The host the inline handler's currentTarget belongs to. */
  const hostOf = (event: Event): DialogHost =>
    ((event.currentTarget as HTMLElement).getRootNode() as ShadowRoot).host as DialogHost;

  onConnect((env) => {
    // The class lane applied the open state after the shadow DOM existed
    // (onCsrRendered / onDsdHydrated); the generated setup can run before the
    // template mounts, so the same sync defers one frame. The frame is NOT
    // cancelled through `env.signal`: that channel is the element-lifetime
    // one, and the shell aborts it around connect passes, so cancelling here
    // would drop the reconnect's own sync (a modal left open across a
    // disconnect then never re-enters the top layer). The sync is idempotent
    // and reads the live host, so a stale frame is harmless.
    const host = env.host as DialogHost;
    globalThis.requestAnimationFrame(() => syncOpenDialog(host, env.states));
  });
  onPropertyChange((event) => {
    if (event.name !== 'open') return;
    syncOpenDialog(event.host as DialogHost, event.states);
  });

  return (
    <div style='display:contents'>
      <slot
        name='trigger'
        onClick={(event: Event) => {
          const host = hostOf(event);
          host.open = !host.open;
        }}
      ></slot>
      <dialog
        class='p-6 rounded-xl max-w-[min(90vw,480px)] font-sans'
        open={props.open}
        aria-label={props.label}
        part='overlay'
        onCancel={(event: Event) => handleDialogCancel(hostOf(event), event)}
        onClose={(event: Event) => handleDialogNativeClose(hostOf(event))}
      >
        <div class='dialog-header mb-4 flex items-center justify-between' part='header'>
          <h2 class='dialog-title m-0 text-xl font-semibold text-foreground'>{props.label}</h2>
          <button
            type='button'
            class='dialog-close cursor-pointer rounded-md border-0 bg-transparent p-1 text-xl leading-tight text-muted-foreground transition-colors duration-150 ease-out'
            part='close'
            aria-label='Close'
            onClick={(event: Event) => {
              // The user-facing close path: the change channel applies the
              // states and the top-layer exit, then the component's event
              // fires. The dispatch is authored inline because the manifest's
              // event recognizer is module-local (the cancel and native-close
              // paths share the same two lines through dialog-machine).
              const host = hostOf(event);
              host.open = false;
              host.dispatchEvent(
                new globalThis.CustomEvent('open-dialog-close', { bubbles: true, composed: true }),
              );
            }}
          >
            ×
          </button>
        </div>
        <div class='dialog-body text-base leading-normal text-muted-foreground' part='body'>
          <slot></slot>
        </div>
        <div class='dialog-footer mt-5 flex justify-end gap-2' part='footer'>
          <slot name='footer'></slot>
        </div>
      </dialog>
    </div>
  );
}

export default OpenDialog;
