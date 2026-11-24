/**
 * /visible-probe page element — the #606 visible-island geometry.
 *
 * The tall spacer keeps the client:visible island below the fold, so the island
 * module can only evaluate once the host scrolls into view. The page root is
 * shadow-open, so the island host lives inside the page's DSD shadow root —
 * the deep-query case a light-DOM scan never finds.
 *
 * GENERATED lane (F16: class → function). The class's `static styles =
 * [pageStyles]` becomes the sidecar `styles` list: the spacer's 5000px height
 * is what makes the island start below the fold, so a migration that dropped the
 * sheet would put the island in view at load and turn the #606 row green for the
 * wrong reason.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'visible-page',
  root: 'shadow',
  styles: ['./page-visible-probe.css'],
});

export default function VisiblePage() {
  return (
    <main>
      <h1>visible probe</h1>
      <div id='visible-probe-spacer' class='visible-probe-spacer'>spacer</div>
      <visible-probe></visible-probe>
    </main>
  );
}
