/**
 * wc-open-fast — openElement child created inside a FAST component's own open
 * shadow root, after activation (A2 of the late-host corpus).
 *
 * Same late-host shape as wc-open-child, carried by a different template
 * engine: the point of the corpus is that the product mechanism must not care
 * which library created the host, so the fixture must not either.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` reproduces the class
 * lane's `shadow-open`: the qualifier pierces `wc-fast-host`'s shadow root, then
 * this element's, and reads the marker there — a light root would put it in the
 * FAST host's light DOM, which that walk never inspects.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: false,
  dsd: false,
  root: 'shadow',
});

export default function WcOpenFast() {
  return <span id='open-fast-ready'>openElement child inside FAST</span>;
}
