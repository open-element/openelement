/**
 * open-copy-button — the homepage's two copy controls.
 *
 * The install command and the source sample are both read-only text a reader
 * may want to take with them. The platform copy button is an island because
 * the feedback needs state: an idle label, a copied label announced through
 * a polite live region, and a real failure message that tells the reader what
 * to do next instead of a bare "Failed" (the old open-code-block chip does not
 * expose labels, and the site may not edit the package).
 *
 * The target is named by id rather than passed as text: the button reads the
 * exact rendered text on activation, so the copied bytes can never drift from
 * the visible command/code. `root: 'light'` keeps document CSS in charge of
 * the chip, matching the site's other chrome islands.
 *
 * The state writes are direct DOM writes into the SSR-rendered button/status,
 * not a signal: this island owns no other dynamic region, and the generated
 * lane rejects a string-valued JSX conditional. The live-region text is the
 * announcement; the wrapper's data-state only drives the visible error line.
 *
 * The visible label returns to its idle word after two seconds, but the
 * button's accessible name is a separate, stable prop ("Copy install
 * command"): an accessible name that flips to "Copied" and never returns
 * leaves a reader unable to find the control again. The polite status region
 * carries the confirmation for assistive technology; the label change is
 * only the sighted echo.
 *
 * A failed copy leaves a visible error line; the × button this island also
 * renders dismisses it so recovering never depends on a later copy
 * succeeding, and every press starts from a cleared line.
 */
import { defineIslandConfig } from '@openelement/router';
import { dismissCopyFailure, returnToIdle, scheduleIdleLabel } from '../site-ui/open-copy-state.ts';

export const openElement = defineIslandConfig({
  tag: 'open-copy-button',
  root: 'light',
  hydrate: 'visible',
  ssr: true,
  properties: {
    target: { default: '' },
    label: { default: 'Copy' },
    copied: { default: 'Copied' },
    announce: { default: 'Copied to clipboard' },
    failed: { default: 'Copy failed — select the text manually' },
    dismiss: { default: 'Dismiss copy error' },
    accessibleName: { attribute: 'accessible-name', default: 'Copy' },
  },
});

function OpenCopyButton(props: {
  target: string;
  label: string;
  copied: string;
  announce: string;
  failed: string;
  dismiss: string;
  accessibleName: string;
}) {
  return (
    <span class='home-copy-wrap' data-state='idle'>
      <button
        type='button'
        class='home-copy'
        part='button'
        aria-label={props.accessibleName}
        onClick={(event: Event) => {
          const button = event.currentTarget as HTMLButtonElement;
          const host = button.closest('open-copy-button');
          const wrap = button.closest('.home-copy-wrap');
          const status = wrap?.querySelector('.home-copy-status');
          const doc = host?.ownerDocument ?? globalThis.document;
          const target = props.target ? doc.getElementById(props.target) : null;
          const text = target?.textContent?.trimEnd() ?? '';
          // A press is a retry: clear the previous outcome (and any failure
          // line) before the attempted write, so the visible state always
          // describes THIS attempt.
          wrap?.setAttribute('data-state', 'idle');
          if (status) status.textContent = '';

          if (!text) {
            returnToIdle(wrap, button, props.label);
            wrap?.setAttribute('data-state', 'failed');
            if (status) status.textContent = props.failed;
            return;
          }
          try {
            const clipboard = globalThis.navigator?.clipboard;
            if (!clipboard?.writeText) {
              returnToIdle(wrap, button, props.label);
              wrap?.setAttribute('data-state', 'failed');
              if (status) status.textContent = props.failed;
              return;
            }
            clipboard.writeText(text).then(
              () => {
                wrap?.setAttribute('data-state', 'copied');
                button.textContent = props.copied;
                scheduleIdleLabel(wrap, button, props.label);
                if (status) status.textContent = props.announce;
              },
              () => {
                returnToIdle(wrap, button, props.label);
                wrap?.setAttribute('data-state', 'failed');
                if (status) status.textContent = props.failed;
              },
            );
          } catch {
            returnToIdle(wrap, button, props.label);
            wrap?.setAttribute('data-state', 'failed');
            if (status) status.textContent = props.failed;
          }
        }}
      >
        {props.label}
      </button>
      <span class='home-copy-status' role='status' aria-live='polite' aria-atomic='true'></span>
      {/* Readers can dismiss a clipboard error. The button is visible in the
          failed state controlled by site-chrome.css. */}
      <button
        type='button'
        class='home-copy-dismiss'
        aria-label={props.dismiss}
        onClick={(event: Event) => dismissCopyFailure(event)}
      >
        ×
      </button>
    </span>
  );
}

export default OpenCopyButton;
