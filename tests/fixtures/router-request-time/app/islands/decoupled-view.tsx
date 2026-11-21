/**
 * decoupled-view — content element for the /decoupled regression page (#960).
 *
 * v0.44 (ADR-0143): a compiled island — the page's compiled program nests it
 * as a custom-element host and the generated entry expands it server-side
 * through the admission plan. The request-scoped marker reaches it as the
 * `marker` property (the page binds it as a host attribute).
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  dsd: true,
  // The class lane declared no root, which is LIGHT — not the generated lane's
  // shadow default. The Q1-D spec drives the island through `marker` ATTRIBUTE
  // writes on the host and reads the text back out of the host's own tree, so a
  // shadow root here would move both the attribute channel's result and the
  // observed node.
  root: 'light',
  properties: {
    // The class's `@property({ reflect: false })` kept a non-reflecting but
    // attribute-backed row: the spec's `setAttribute('marker', …)` is that
    // channel, so the attribute name must stay derived from the property name.
    marker: { default: 'content element: no marker' },
  },
});

export default function DecoupledView(props: { marker: string }) {
  return <p id='decoupled-content'>{props.marker}</p>;
}
