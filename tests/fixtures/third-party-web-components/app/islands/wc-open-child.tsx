/**
 * wc-open-child — openElement child element nested inside a third-party
 * (Lit) host's shadow root (bidirectional interop section).
 *
 * v0.44 compiled island: the Lit host creates <wc-open-child> client-side
 * when it upgrades, so this island is client-only (ssr: false); the generated
 * client entry registers the compiled class on load and the element then
 * upgrades in place inside the Lit shadow root, creating its own shadow
 * content fresh from the compiled Part Program.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` reproduces the class
 * lane's `shadow-open`, which is load-bearing rather than cosmetic: the
 * qualifier reads this element's marker out of its OWN shadow root
 * (`litHost.shadowRoot.querySelector('wc-open-child').shadowRoot.textContent`),
 * so a light root would leave the marker where that walk never looks.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: false,
  dsd: false,
  root: 'shadow',
});

export default function WcOpenChild() {
  return <span id='open-child-ready'>openElement child inside Lit</span>;
}
