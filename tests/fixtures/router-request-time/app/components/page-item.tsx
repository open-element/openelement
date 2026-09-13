/**
 * /item/:id page element — request-time param route (#556), compiled v0.44.
 * `idText` echoes params.id (via the loader + props projector); `note` echoes
 * the 422-submitted value; `hasError` drives the static-text error Region;
 * `notedText` carries the PRG echo.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('item-id', { root: 'shadow-open' })
export default class ItemPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  idText = 'id=';

  @property({ reflect: false, attribute: false })
  note = '';

  @property({ reflect: false, attribute: false })
  notedText = 'noted=';

  @property({ reflect: false, attribute: false })
  hasError = 0;

  render() {
    return (
      <main>
        <h1>request-time item</h1>
        <p id='item-id'>{this.idText}</p>
        <form method='post' data-open-enhance>
          <input id='note' name='note' type='text' value={this.note} />
          <button id='submit' type='submit'>Save</button>
        </form>
        {this.hasError > 0 ? <p id='error'>note is required</p> : <span data-error='none'></span>}
        <p id='noted'>{this.notedText}</p>
      </main>
    );
  }
}
