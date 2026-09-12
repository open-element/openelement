/**
 * /dialog page — qualifies open-dialog on the compiled framework (#1226):
 * - a trigger-driven modal dialog (focus containment, Escape, focus return);
 * - a second dialog SSR-rendered with the `open` attribute, qualifying the
 *   attribute -> top-layer modal choreography at hydration (#1030).
 */
import { element, OpenElement } from '@openelement/element';
import '@openelement/ui/open-dialog';

@element('dialog-page', { root: 'shadow-open' })
export default class DialogPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>ui dogfood — dialog</h1>
        <open-dialog label='Dogfood dialog'>
          <button slot='trigger' id='dialog-trigger' type='button'>Open dialog</button>
          <p id='dialog-text'>Dogfood dialog body</p>
          <button id='dialog-inner-action' type='button'>Inner action</button>
          <button slot='footer' id='dialog-footer-action' type='button'>Footer action</button>
        </open-dialog>
        <open-dialog id='ssr-open-dialog' label='SSR open dialog' open>
          <p id='ssr-open-text'>SSR-opened dialog body</p>
        </open-dialog>
        <button id='after-dialog' type='button'>After dialog</button>
      </main>
    );
  }
}
