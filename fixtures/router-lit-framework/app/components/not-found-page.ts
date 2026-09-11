/**
 * not-found-page — custom 404 host, rendered by the generated notFound
 * fallback for unmatched paths.
 */
import { html, LitElement } from 'lit';

export class NotFoundPage extends LitElement {
  override render() {
    return html`
      <main>
        <h1>app-flow-lit 404</h1>
        <p id="not-found-message">nothing notes-like lives here</p>
        <a href="/notes">all notes</a>
      </main>
    `;
  }
}
