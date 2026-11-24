/**
 * wc-open-nested — openElement child created inside a NESTED open shadow root
 * (C1 of the late-host corpus).
 *
 * Two foreign shadow roots deep by the time it appears: the walk that finds a
 * late host must not stop at the first boundary, so depth, not just presence,
 * is part of the contract.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` reproduces the class
 * lane's `shadow-open`: the qualifier descends `wc-nested-outer` →
 * `wc-lit-nested-host` → this element and reads the marker from THIS element's
 * shadow root. A light root would leave the marker in the Lit host's light DOM,
 * so the depth probe would report a false gap.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: false,
  dsd: false,
  root: 'shadow',
});

export default function WcOpenNested() {
  return <span id='open-nested-ready'>openElement child inside nested shadow roots</span>;
}
