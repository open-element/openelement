/**
 * decoupled-view — content element for the /decoupled regression page (#960).
 *
 * v0.44 (ADR-0143): a compiled island — the page's compiled program nests it
 * as a custom-element host and the generated entry expands it server-side
 * through the admission plan. The request-scoped marker reaches it as the
 * `marker` property (the page binds it as a host attribute).
 */
import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('decoupled-view')
export default class DecoupledView extends OpenElement {
  @property({ reflect: false })
  marker = 'content element: no marker';

  render() {
    return <p id='decoupled-content'>{this.marker}</p>;
  }
}
