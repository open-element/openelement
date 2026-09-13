customElements.define(
  'open-proof-island',
  class extends HTMLElement {
    connectedCallback() {
      this.dataset.upgraded = 'visible';
    }
  },
);
