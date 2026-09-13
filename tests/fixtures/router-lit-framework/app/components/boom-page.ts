/**
 * boom-page — `/boom` host. The route loader always throws; the descriptor's
 * error projector maps the failure onto `boomError`/`message`, and the page
 * renders its error variant with status 500 (ADR-0121 §7).
 */
import { html, LitElement } from 'lit';

export class BoomPage extends LitElement {
  static override properties = {
    boomError: { type: Boolean },
    message: { type: String },
  };

  declare boomError: boolean;
  declare message: string;

  constructor() {
    super();
    this.boomError = false;
    this.message = '';
  }

  override render() {
    return html`
      <main>
        ${this.boomError
          ? html`<h1 id="boundary">boom boundary: ${this.message}</h1>`
          : html`<h1>boom</h1>`}
      </main>
    `;
  }
}
