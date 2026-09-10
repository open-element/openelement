/**
 * note-counter — Lit island (hydrate: 'load', ssr: true). Server-rendered by
 * lit-ssr composition inside the notes list page; hydrated on load by
 * @lit-labs/ssr-client's lit-element-hydrate-support (installed as the first
 * import of the lit client entry). The reflected `count` attribute carries
 * SSR state into the client instance (non-reflected property bindings are not
 * restored from SSR DOM — @lit-labs/ssr semantics).
 */
import { html, LitElement } from 'lit';
import { defineIslandConfig } from '@openelement/app';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

export default class NoteCounter extends LitElement {
  static override properties = {
    count: { type: Number, reflect: true },
  };

  declare count: number;

  constructor() {
    super();
    this.count = 0;
  }

  override render() {
    return html`
      <button id="counter" type="button" @click=${() => {
        this.count += 1;
      }}>count: ${this.count}</button>
    `;
  }
}
