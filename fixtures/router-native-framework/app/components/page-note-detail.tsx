/**
 * /notes/:id page element — dynamic detail (compiled). The projector maps the
 * loaded note plus the ?created=/?updated= PRG flash params onto the compiled
 * properties; `editHref` is a page-level attribute Part on the edit link.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('notes-id', { root: 'shadow-open' })
export default class NoteDetailPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  idText = 'id=';

  @property({ reflect: false, attribute: false })
  titleText = '';

  @property({ reflect: false, attribute: false })
  bodyText = '';

  @property({ reflect: false, attribute: false })
  editHref = '';

  @property({ reflect: false, attribute: false })
  createdText = 'created=';

  @property({ reflect: false, attribute: false })
  updatedText = 'updated=';

  /** Debug echo of the last submitter intent recorded by the store. */
  @property({ reflect: false, attribute: false })
  intentText = 'intent=';

  render() {
    return (
      <main>
        <h1 id='note-title'>{this.titleText}</h1>
        <p id='note-id'>{this.idText}</p>
        <p id='note-body'>{this.bodyText}</p>
        <a id='edit-link' href={this.editHref}>Edit</a>
        <a id='back-to-notes' href='/notes'>All notes</a>
        <p id='flash-created'>{this.createdText}</p>
        <p id='flash-updated'>{this.updatedText}</p>
        <p id='last-intent'>{this.intentText}</p>
      </main>
    );
  }
}
