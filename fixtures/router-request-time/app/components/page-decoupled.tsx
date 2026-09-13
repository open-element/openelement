/**
 * /decoupled page element — regression page for #960 (registration
 * decoupling), compiled v0.44.
 *
 * The page class registers under the path-derived fallback tag
 * ('decoupled-page') and nests the compiled content element
 * <decoupled-view>; the request-scoped marker flows through the page's
 * `marker` property onto the host as a compiled prop Part (emitted as the
 * host attribute at SSR, expanded into the island's own render by the
 * generated entry).
 */
import { element, OpenElement, property } from '@openelement/element';

@element('decoupled-page', { root: 'shadow-open' })
export default class DecoupledPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  marker = 'content element: no marker';

  render() {
    return (
      <main id='decoupled-page-render'>
        <decoupled-view marker={this.marker}></decoupled-view>
      </main>
    );
  }
}
