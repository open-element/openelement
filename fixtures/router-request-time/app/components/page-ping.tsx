/**
 * /ping page element — named-only actions route (ADR-0121 protocol edges),
 * compiled v0.44. `movedText` carries the ?moved= echo; `hasError` drives the
 * static-text intent-error Region.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('ping-page', { root: 'shadow-open' })
export default class PingPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  movedText = 'moved=';

  @property({ reflect: false, attribute: false })
  hasError = 0;

  render() {
    return (
      <main>
        <h1>ping page</h1>
        <p id='moved'>{this.movedText}</p>
        {this.hasError > 0
          ? <p id='intent-error'>intent missing</p>
          : <span data-error='none'></span>}
        <form method='post' data-open-enhance>
          <button id='ping' type='submit' name='intent' value='ping' formaction='?/ping'>
            Ping
          </button>
          <button id='mv307' type='submit' formaction='?/mv307'>Move</button>
        </form>
        {
          /* #576: an explicit action attribute with an attribute-less
            submitter — the enhanced POST must hit /form, not this page. */
        }
        <form method='post' action='/form' data-open-enhance>
          <button id='to-form' type='submit'>Send to /form</button>
        </form>
      </main>
    );
  }
}
