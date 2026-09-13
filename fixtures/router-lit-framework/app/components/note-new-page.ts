/**
 * note-new-page — `/notes/new` create form. The enhanced POST form
 * (data-open-enhance) submits via fetch when JS is on and morphs the returned
 * document; without JS it is a plain browser POST (303 PRG / 422 re-render).
 */
import { html, LitElement } from 'lit';

export class NoteNewPage extends LitElement {
  static override properties = {
    error: { type: String },
    title: { type: String },
    intentText: { type: String },
  };

  declare error: string;
  declare title: string;
  declare intentText: string;

  constructor() {
    super();
    this.error = '';
    this.title = '';
    this.intentText = 'intent=';
  }

  override render() {
    return html`
      <main>
        <h1>new note</h1>
        ${this.error ? html`<p id="error" role="alert">${this.error}</p>` : ''}
        <form method="post" data-open-enhance>
          <label for="title">title</label>
          <input id="title" name="title" type="text" required .value=${this.title} />
          <label for="body">body</label>
          <textarea id="body" name="body"></textarea>
          <button id="submit" type="submit" name="intent" value="create">create</button>
        </form>
        <p id="last-intent">${this.intentText}</p>
      </main>
    `;
  }
}
