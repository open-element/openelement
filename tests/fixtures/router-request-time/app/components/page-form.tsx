/**
 * /form page element — the ADR-0120 action protocol page (compiled, v0.44).
 *
 * Compiled-grammar shape of the legacy render():
 * - `message` echoes the submitted value into the input (prop Part on value);
 * - `hasError` (0/1) drives the static-text error Region — the compiled
 *   grammar's conditional branches are fully static, and the action's
 *   failure message is the constant 'message is required';
 * - `echoText` carries the PRG echo as one dynamic text Part so the raw HTML
 *   keeps the assertion-contiguous 'echo=<value>' string.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('form-page', { root: 'shadow-open' })
export default class FormPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  message = '';

  @property({ reflect: false, attribute: false })
  echoText = 'echo=';

  @property({ reflect: false, attribute: false })
  hasError = 0;

  render() {
    return (
      <main>
        <h1>request-time form</h1>
        <form method='post' data-open-enhance>
          <input
            id='message'
            name='message'
            type='text'
            value={this.message}
          />
          <button id='submit' type='submit'>Send</button>
          <button id='shout' type='submit' formaction='?/shout'>Shout</button>
        </form>
        {this.hasError > 0
          ? <p id='error'>message is required</p>
          : <span data-error='none'></span>}
        <p id='echo'>{this.echoText}</p>
        <live-counter></live-counter>
      </main>
    );
  }
}
