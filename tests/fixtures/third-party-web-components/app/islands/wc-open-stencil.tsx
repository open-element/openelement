/**
 * wc-open-stencil — openElement child created inside a Stencil-compiled
 * component's own open shadow root, after activation (A3 of the late-host
 * corpus).
 *
 * Stencil is the third authoring path: its components attach their shadow
 * root from compiled output, so the host lands on a different schedule than a
 * Lit or FAST update. `@ionic/core` already pins `@stencil/core` at the same
 * version this fixture builds against, so the compiler costs no extra bytes.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` reproduces the class
 * lane's `shadow-open`: the qualifier reads the marker out of this element's own
 * shadow root after descending `wc-stencil-host`, so a light root would place it
 * where that walk stops short.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: false,
  dsd: false,
  root: 'shadow',
});

export default function WcOpenStencil() {
  return <span id='open-stencil-ready'>openElement child inside Stencil</span>;
}
