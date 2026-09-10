/**
 * note-edit-page — `/notes/:id/edit` pre-filled edit form host.
 */
import { html, LitElement } from 'lit';

export class NoteEditPage extends LitElement {
  static override properties = {
    noteId: { type: String, attribute: 'note-id' },
    noteTitle: { type: String, attribute: 'note-title' },
    noteBody: { type: String, attribute: 'note-body' },
  };

  declare noteId: string;
  declare noteTitle: string;
  declare noteBody: string;

  constructor() {
    super();
    this.noteId = '';
    this.noteTitle = '';
    this.noteBody = '';
  }

  override render() {
    return html`
      <main>
        <h1>edit note</h1>
        <form method="post" data-open-enhance>
          <label for="title">title</label>
          <input id="title" name="title" type="text" .value=${this.noteTitle} />
          <label for="body">body</label>
          <textarea id="body" name="body">${this.noteBody}</textarea>
          <button id="submit" type="submit">save</button>
        </form>
      </main>
    `;
  }
}
