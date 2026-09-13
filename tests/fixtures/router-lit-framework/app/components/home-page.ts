/**
 * home-page — static `/` page host (LitElement). The note count is captured
 * at build time (renderIntent static is the default) into the #build-count
 * text, proving build-time SSG composes with the lit renderer.
 */
import { html, LitElement } from 'lit';

export class HomePage extends LitElement {
  static override properties = {
    noteCount: { type: Number },
  };

  declare noteCount: number;

  constructor() {
    super();
    this.noteCount = 0;
  }

  override render() {
    return html`
      <main>
        <h1>app-flow-lit</h1>
        <p id="build-count">build-count=${this.noteCount}</p>
        <nav><a href="/notes">notes</a></nav>
      </main>
    `;
  }
}
