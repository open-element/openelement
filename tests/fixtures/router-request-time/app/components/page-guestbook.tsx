/**
 * /guestbook page element — the ADR-0120-amendment HYBRID page (compiled,
 * v0.44): static prerendered GET + request-time action POST on one path.
 *
 * - `noteText` echoes the submitted value into the input (prop Part on value);
 * - `hasError` (0/1) drives the static-text error Region — the action's
 *   failure message is the constant 'note is required';
 * - `echoText` carries the PRG echo as one dynamic text Part so the raw HTML
 *   keeps the assertion-contiguous 'echo=<value>' string.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('guestbook-page', { root: 'shadow-open' })
export default class GuestbookPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  noteText = '';

  @property({ reflect: false, attribute: false })
  echoText = 'echo=';

  @property({ reflect: false, attribute: false })
  hasError = 0;

  render() {
    return (
      <main>
        <h1 id='guestbook-marker'>hybrid guestbook</h1>
        <form method='post' data-open-enhance>
          <input
            id='note'
            name='note'
            type='text'
            value={this.noteText}
          />
          <button id='submit' type='submit'>Sign</button>
          <button id='ghost' type='submit' formaction='?/ghost'>Ghost</button>
        </form>
        {this.hasError > 0 ? <p id='error'>note is required</p> : <span data-error='none'></span>}
        <p id='echo'>{this.echoText}</p>
      </main>
    );
  }
}
