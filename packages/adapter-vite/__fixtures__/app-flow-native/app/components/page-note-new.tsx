/**
 * /notes/new page element — create form (compiled). `titleText` backs the
 * native `required` control (empty submissions are blocked by the browser
 * before any submit event); the property is NOT named `title` because that
 * would shadow HTMLElement.title (TS4114 under noImplicitOverride — the
 * packed-consumer typecheck cell catches it). `hasError` drives the
 * static-text error Region — the compiled grammar's conditional branches are
 * fully static, so the constant validation message is the branch text. The
 * named submitter travels in both the enhanced and the native body (#544).
 */
import { element, OpenElement, property } from '@openelement/element';

@element('notes-new', { root: 'shadow-open' })
export default class NoteNewPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  titleText = '';

  @property({ reflect: false, attribute: false })
  hasError = 0;

  /** Debug echo of the last submitter intent recorded by the store. */
  @property({ reflect: false, attribute: false })
  intentText = 'intent=';

  render() {
    return (
      <main>
        <h1>new note</h1>
        <form method='post' data-open-enhance>
          <input id='title' name='title' type='text' required value={this.titleText} />
          <textarea id='body' name='body'></textarea>
          <button id='submit' type='submit' name='intent' value='create'>Create</button>
          {
            /* #1339: submitter formaction override -> named action (?/feature),
              on both the enhanced and the native POST path. */
          }
          <button id='feature' type='submit' name='intent' value='feature' formaction='?/feature'>
            Feature
          </button>
        </form>
        {this.hasError > 0
          ? <p id='error'>title must be at least 3 characters</p>
          : <span data-error='none'></span>}
        <p id='last-intent'>{this.intentText}</p>
      </main>
    );
  }
}
