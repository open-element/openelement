/**
 * Light-root boundary element — consumer-authored, qualifies the light-root
 * contract as an external consumer (#1226): SSR emits the content inline with
 * the generated data-oe-light marker, no shadowroot template.
 *
 * GENERATED lane (2026-11-21 closeout: class → function). The sidecar declares
 * `root: 'light'` from the class lane: the /boundaries SSR row asserts the
 * `data-oe-light` marker and inline `<p id="light-content">`, and the e2e row
 * asserts `host.shadowRoot === null`, so a shadow root here would invert the
 * contract the fixture exists to prove.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'dogfood-light', root: 'light' });

export default function DogfoodLight() {
  return <p id="light-content">light root boundary content</p>;
}
