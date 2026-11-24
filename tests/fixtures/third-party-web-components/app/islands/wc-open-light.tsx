/**
 * wc-open-light — openElement child appended to a third-party component's
 * LIGHT DOM after that component upgraded (B1–B3 of the late-host corpus).
 *
 * The other half of the late-host contract: Shoelace, Material Web and Ionic
 * expose components but no way to author their shadow content, so the honest
 * late-host case for them is a host appended into their light DOM (and
 * projected through a slot). The scheduler must find that too — a document
 * query does, and the fixture pins that it actually happens.
 *
 * GENERATED lane (F16: class → function). It keeps `root: 'shadow'`
 * (`shadow-open` in the class lane) even though the HOST is light: this element
 * is appended as a light child, and the qualifier then reads the marker from the
 * ISLAND's own shadow root (`upgraded(root.querySelector('wc-open-light'))`). A
 * light root here would put the marker in the Shoelace/Material/Ionic light DOM
 * — the same place the host was appended — and that probe reads the wrong node.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: false,
  dsd: false,
  root: 'shadow',
});

export default function WcOpenLight() {
  return <span id='open-light-ready'>openElement child appended late</span>;
}
