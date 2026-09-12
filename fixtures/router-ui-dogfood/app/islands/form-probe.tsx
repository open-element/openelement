/**
 * form-probe — island that makes form participation observable (#1226).
 *
 * The /form page shell is not registered client-side, so the submit/reset
 * listeners live here: on activation the probe wires the form (found through
 * its own root node — the page shadow root) and echoes FormData entries into
 * #form-output with default prevented, so the browser never navigates.
 */
import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('form-probe', { root: 'shadow-open' })
export default class FormProbe extends OpenElement {
  @property({ reflect: false, attribute: false })
  status = 'probe-idle';

  override onDsdHydrated(): void {
    this.wire();
  }

  override onCsrRendered(): void {
    this.wire();
  }

  private wire(): void {
    const root = this.getRootNode() as unknown as ParentNode;
    const form = root.querySelector<HTMLFormElement>('#dogfood-form');
    const output = root.querySelector<HTMLOutputElement>('#form-output');
    if (!form || !output) return;
    // Reconnect-safe: the listeners outlive a move, so wire at most once.
    if (form.dataset.probeWired === 'true') return;
    form.dataset.probeWired = 'true';
    const echo = (): void => {
      const data = new FormData(form);
      output.textContent = JSON.stringify(Object.fromEntries(data.entries()));
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      echo();
    });
    form.addEventListener('reset', () => {
      // formResetCallback runs as a queued custom-element reaction — after a
      // microtask queued from this listener — so the echo waits a macrotask.
      setTimeout(echo, 0);
    });
    this.status = 'probe-wired';
  }

  render() {
    return <p id='probe-status'>{this.status}</p>;
  }
}
