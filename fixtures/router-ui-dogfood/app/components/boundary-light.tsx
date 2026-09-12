/**
 * Light-root boundary element — consumer-authored, qualifies the light-root
 * contract as an external consumer (#1226): SSR emits the content inline with
 * the generated data-oe-light marker, no shadowroot template.
 */
import { element, OpenElement } from '@openelement/element';

@element('dogfood-light', { root: 'light' })
export default class DogfoodLight extends OpenElement {
  render() {
    return <p id='light-content'>light root boundary content</p>;
  }
}
