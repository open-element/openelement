/**
 * probe-panel — control experiment: the IDENTICAL component rendered from a
 * prerendered static route and from an ordinary request-time dynamic route.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  dsd: true,
  // The class lane declared `shadow-open`; a generated element omitting `root`
  // falls back to a LIGHT root, which would serialise the marker into the page's
  // own tree instead of a DSD template and lose the sheet assertion.
  root: 'shadow',
  styles: ['./probe-panel.css'],
});

export default function ProbePanel() {
  return (
    <section class='probe-panel-body'>
      <span id='probe-panel-marker'>probe panel marker</span>
    </section>
  );
}
