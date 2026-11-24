/**
 * /decoupled page element — regression page for #960 (registration
 * decoupling), compiled v0.44.
 *
 * The page registers under the path-derived tag 'decoupled-page' and nests the
 * compiled content element <decoupled-view>; the request-scoped marker flows
 * through the page's `marker` property onto the host as a host attribute at
 * SSR, expanded into the island's own render by the generated entry.
 *
 * GENERATED lane (F16: class → function). `marker` stays `attribute: false` —
 * the ROUTE passes it in-process — but it is also the attribute the island
 * itself is driven through, and that channel is written by the PAGE's JSX
 * (`<decoupled-view marker={marker}>`), not by this page's own host row, so it
 * is unaffected. The typed props record still needs a sidecar entry, so the row
 * keeps the property-only spelling.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'decoupled-page',
  root: 'shadow',
  properties: {
    marker: { attribute: false, default: 'content element: no marker' },
  },
});

interface DecoupledPageProps {
  marker: string;
}

export default function DecoupledPage(props: DecoupledPageProps) {
  return (
    <main id='decoupled-page-render'>
      <decoupled-view marker={props.marker}></decoupled-view>
    </main>
  );
}
