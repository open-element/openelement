/**
 * /notes/:id/edit page element — edit form (compiled), pre-filled from the
 * store via the loader (`title` value Part, `body` textarea text Part).
 * `hasError` drives the static-text error Region like on /notes/new.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('notes-id-edit', { root: 'shadow-open' })
export default class NoteEditPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  title = '';

  @property({ reflect: false, attribute: false })
  body = '';

  @property({ reflect: false, attribute: false })
  hasError = 0;

  render() {
    return (
      <main>
        <h1>edit note</h1>
        <form method='post' data-open-enhance>
          <input id='title' name='title' type='text' required value={this.title} />
          <textarea id='body' name='body'>{this.body}</textarea>
          <button id='submit' type='submit' name='intent' value='update'>Update</button>
        </form>
        {this.hasError > 0
          ? <p id='error'>title must be at least 3 characters</p>
          : <span data-error='none'></span>}
      </main>
    );
  }
}
