/**
 * /notes page element — dynamic list (compiled). The compiled each-Region
 * item template binds two per-item slots: an iattr href ({note.href}) and an
 * ival title ({note.title}) — the alpha.8 multi-field grammar. A note-counter
 * island proves load-time activation on a request-time page.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('notes-index', { root: 'shadow-open' })
export default class NotesPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  rows: Array<{ id: string; title: string; href: string }> = [];

  @property({ reflect: false, attribute: false })
  countText = 'note-count=0';

  /** Debug echo of the last submitter intent recorded by the store. */
  @property({ reflect: false, attribute: false })
  intentText = 'intent=';

  render() {
    return (
      <main>
        <h1>app-flow-native notes</h1>
        <p id='note-count'>{this.countText}</p>
        <p id='last-intent'>{this.intentText}</p>
        <a id='new-note' href='/notes/new'>New note</a>
        <ul>
          {this.rows.map((note) => (
            <li key={note.id}>
              <a href={note.href}>{note.title}</a>
            </li>
          ))}
        </ul>
        <note-counter></note-counter>
      </main>
    );
  }
}
