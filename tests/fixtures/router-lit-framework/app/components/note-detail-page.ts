/**
 * note-detail-page — dynamic `/notes/:id` page host. `created` carries the
 * PRG flash from the create flow (?created=1).
 */
import { html, LitElement } from 'lit';

export class NoteDetailPage extends LitElement {
  static override properties = {
    noteId: { type: String, attribute: 'note-id' },
    noteTitle: { type: String, attribute: 'note-title' },
    noteBody: { type: String, attribute: 'note-body' },
    created: { type: Boolean },
    intentText: { type: String },
  };

  declare noteId: string;
  declare noteTitle: string;
  declare noteBody: string;
  declare created: boolean;
  declare intentText: string;

  constructor() {
    super();
    this.noteId = '';
    this.noteTitle = '';
    this.noteBody = '';
    this.created = false;
    this.intentText = 'intent=';
  }

  override render() {
    return html`
      <main>
        ${this.created ? html`<p id="created-flash">note created</p>` : ''}
        <h1 id="note-title">${this.noteTitle}</h1>
        <p id="note-body">${this.noteBody}</p>
        <p id="note-id">${this.noteId}</p>
        <p id="last-intent">${this.intentText}</p>
        <a href="/notes/${this.noteId}/edit">edit</a>
        <a href="/notes">all notes</a>
      </main>
    `;
  }
}
