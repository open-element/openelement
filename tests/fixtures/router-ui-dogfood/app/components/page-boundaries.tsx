/**
 * /boundaries page — qualifies the open/light/closed root contracts side by
 * side (#1226): @openelement/ui primitives are shadow-open (observable
 * shadowRoot), while the consumer-authored dogfood-light and dogfood-closed
 * elements prove the other two root modes through the same compiled path.
 * The ui primitive here is open-button (#1557 retired open-badge to a CSS
 * recipe; the boundary evidence keeps a retained interactive component).
 */
import { element, OpenElement } from '@openelement/element';
import '@openelement/ui/open-button';
import './boundary-closed.tsx';
import './boundary-light.tsx';

@element('boundaries-page', { root: 'shadow-open' })
export default class BoundariesPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>ui dogfood — boundaries</h1>
        <open-button id='open-boundary' variant='primary'>open shadow boundary</open-button>
        <dogfood-light></dogfood-light>
        <dogfood-closed></dogfood-closed>
      </main>
    );
  }
}
