/**
 * /boundaries page — qualifies the open/light/closed root contracts side by
 * side (#1226): @openelement/ui primitives are shadow-open (observable
 * shadowRoot), while the consumer-authored dogfood-light and dogfood-closed
 * elements prove the other two root modes through the same compiled path.
 */
import { element, OpenElement } from '@openelement/element';
import '@openelement/ui/open-badge';
import './boundary-closed.tsx';
import './boundary-light.tsx';

@element('boundaries-page', { root: 'shadow-open' })
export default class BoundariesPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>ui dogfood — boundaries</h1>
        <open-badge id='open-boundary' tone='brand'>open shadow boundary</open-badge>
        <dogfood-light></dogfood-light>
        <dogfood-closed></dogfood-closed>
      </main>
    );
  }
}
