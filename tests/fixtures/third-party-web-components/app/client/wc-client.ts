import { css, html, LitElement } from 'lit';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@material/web/button/filled-button.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/switch/switch.js';
import { FASTElement, html as fastHtml } from '@microsoft/fast-element';
import { defineCustomElement as defineIonButton } from '@ionic/core/components/ion-button.js';

defineIonButton();

class WcLitCounter extends LitElement {
  static properties = { count: { type: Number }, label: { type: String } };
  static styles = css`
    :host {
      display: inline-flex;
      gap: 0.5rem;
      align-items: center;
    }
    button {
      cursor: pointer;
    }
  `;
  count = 0;
  label = 'Lit counter';
  #increment() {
    this.count++;
    this.dispatchEvent(
      new CustomEvent('lit-count', {
        detail: { count: this.count },
        bubbles: true,
        composed: true,
      }),
    );
  }
  render() {
    return html`
      <slot name="label"></slot>
      <button
        id="lit-button"
        @click="${() => this.#increment()}"
      >
        ${this.label}: ${this.count}
      </button>
    `;
  }
}

class WcLitHost extends LitElement {
  render() {
    return html`
      <wc-open-child></wc-open-child>
    `;
  }
}

// Bare-native custom element: vanilla HTMLElement with its own shadow root,
// no library. Corpus baseline for the "no framework" third-party WC kind.
class WcNativeBadge extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      ':host{display:inline-block;padding:0.25rem 0.75rem;border:1px solid #8250df;border-radius:999px;}';
    root.append(style, document.createElement('slot'));
  }
}

class WcFastCounter extends FASTElement {
  count = 0;
  increment() {
    this.count++;
    this.shadowRoot!.querySelector('#fast-count')!.textContent = String(this.count);
    this.dispatchEvent(
      new CustomEvent('fast-count', {
        detail: { count: this.count },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

WcFastCounter.define({
  name: 'wc-fast-counter',
  template: fastHtml<WcFastCounter>`
    <slot name="label"></slot>
    <button id="fast-button" @click=${(component) => component.increment()}>
      FAST: <span id="fast-count">0</span>
    </button>
  `,
});

customElements.define('wc-lit-counter', WcLitCounter);
customElements.define('wc-lit-host', WcLitHost);
customElements.define('wc-native-badge', WcNativeBadge);
