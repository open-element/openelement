/**
 * notes-list-page — dynamic `/notes` page host. Renders the note list from
 * loader data and embeds the <note-counter> Lit island, proving nested
 * custom-element composition inside a lit page render (lit-ssr expands the
 * island with its own DSD) plus client-side island hydration.
 */
import { html, LitElement } from 'lit';
import type { Note } from '../store.ts';

export class NotesListPage extends LitElement {
  static override properties = {
    notes: { type: Array },
    countText: { type: String },
  };

  declare notes: Note[];
  declare countText: string;

  constructor() {
    super();
    this.notes = [];
    this.countText = 'note-count=0';
  }

  override render() {
    return html`
      <main>
        <h1>notes</h1>
        <p id="note-count">${this.countText}</p>
        <note-counter count="0"></note-counter>
        <ul id="notes-list">
          ${this.notes.map((note) =>
            html`
              <li class="note" data-note-id=${note.id}>
                <a href="/notes/${note.id}">${note.title}</a>
              </li>
            `
          )}
        </ul>
        <a id="new-note" href="/notes/new">new note</a>
      </main>
    `;
  }
}
