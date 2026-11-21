/**
 * Closed-shadow boundary element — consumer-authored, qualifies the closed-root
 * contract as an external consumer (#1226): SSR emits a `shadowrootmode="closed"`
 * template whose content renders but stays encapsulated
 * (`host.shadowRoot === null`).
 *
 * GENERATED lane (F16: class → function). `root: 'closed'` is the third root
 * family the authoring face can now spell: the shell has always resolved
 * `shadow-closed`, and the class lane was the only way to reach it until now.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'dogfood-closed', root: 'closed' });

export default function DogfoodClosed() {
  return <p id="closed-content">closed root boundary content</p>;
}
