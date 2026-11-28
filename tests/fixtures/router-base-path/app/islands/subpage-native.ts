import { defineIslandConfig } from '@openelement/router';
import './subpage-native.css';
import { appendLateHost } from '../native/create-late.ts';

export const openElement = defineIslandConfig({ hydrate: 'only', ssr: false });

if (typeof HTMLElement !== 'undefined' && typeof customElements !== 'undefined') {
  class SubpageNative extends HTMLElement {
    connectedCallback() {
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      if (root.childElementCount === 0) appendLateHost(root);
    }
  }

  customElements.define('subpage-native', SubpageNative);
}
