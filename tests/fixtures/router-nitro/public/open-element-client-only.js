customElements.define(
  'open-proof-client-only',
  class extends HTMLElement {
    connectedCallback() {
      this.dataset.upgraded = 'only';
    }
  },
);
