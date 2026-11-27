/**
 * open-layer-strip — the layer group's selection and deep-link carrier.
 *
 * The "All layers" row and the three probe rows are plain buttons in the page
 * render, so CSS alone can show hover/focus, but a screen reader gets no
 * "this row is the active one" signal from a :hover rule. This light-root,
 * behaviour-only island keeps exactly one button pressed and moves the group's
 * single tab stop with the arrow keys; pressing the active probe (or "All")
 * clears the selection; Escape returns to "All layers" from any row. It also
 * reads and writes the shareable `#layer=dsd|html|hydrate` hash. Nothing is
 * rendered — the host is a `display: contents` sentinel, like
 * open-site-menu's controller. All of the mechanics live in
 * open-layer-strip-controller.ts; the page CSS paints the ring/pill/wash from
 * [aria-pressed='true'] only and gives :hover/:focus-visible a hairline
 * preview, so the visual and the announced selection stay the same thing.
 */
import { onConnect } from '@openelement/element/lifecycle';
import { defineIslandConfig } from '@openelement/router';
import { installLayerStrip } from '../site-ui/open-layer-strip-controller.ts';

export const openElement = defineIslandConfig({
  tag: 'open-layer-strip',
  root: 'light',
  hydrate: 'load',
  ssr: true,
});

function OpenLayerStrip() {
  onConnect((env) => {
    const strip = env.host.closest('.home-layers');
    if (strip) installLayerStrip(strip as HTMLElement, env.signal);
  });

  return <span hidden></span>;
}

export default OpenLayerStrip;
