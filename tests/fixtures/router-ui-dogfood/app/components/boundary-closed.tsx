/**
 * Closed-shadow boundary element — consumer-authored, qualifies the
 * closed-root contract as an external consumer (#1226): SSR emits a
 * shadowrootmode="closed" template whose content renders but stays
 * encapsulated (host.shadowRoot === null).
 */
import { element, OpenElement } from '@openelement/element';

@element('dogfood-closed', { root: 'shadow-closed' })
export default class DogfoodClosed extends OpenElement {
  render() {
    return <p>closed root boundary content</p>;
  }
}
