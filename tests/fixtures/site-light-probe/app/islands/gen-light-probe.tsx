/** @jsxImportSource @openelement/element */
import { defineIslandConfig } from '@openelement/router';

/**
 * Generated (function) light-root island in the light-style probe fixture.
 *
 * A light-root generated host has no DSD/SSR producer: the build emits the
 * island as a plain tag and the document head is the only delivery that can
 * style it without JS (Alpha16 retained stylesheet delivery). The sheet is
 * declared through the sidecar, so the build emits a scoped client asset and
 * the per-route document fact links it in the page head.
 */
export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: false,
  root: 'light',
  styles: ['./gen-light-probe.css'],
});

export default function GenLightProbe() {
  return <article class='gen-probe-child'>generated light probe</article>;
}
