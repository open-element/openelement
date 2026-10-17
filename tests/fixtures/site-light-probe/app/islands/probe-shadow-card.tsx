/**
 * Shadow-root half of the resource-resolution probe (alpha15 S lane, S-C1.3
 * follow-up).
 *
 * The sheet is delivered to the shadow root as an ADOPTED `CSSStyleSheet` whose
 * text is the emitted asset — so every resource reference in it must already be
 * resolved (an `@import` chain inlined, `url()` rewritten by the build's own
 * asset handling). The imported token proves the import was inlined; the image
 * proves the relative asset URL still names a served file.
 */

import '@openelement/element';
import { element, OpenElement } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import shadowStyles from './probe-shadow-card.css';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('probe-shadow-card', { root: 'shadow-open' })
export default class ProbeShadowCard extends OpenElement {
  static override styles = [shadowStyles];

  render() {
    return (
      <article class='shadow-card'>
        <span class='probe-shadow-imported'>shadow</span>
        {/* A LIGHT-root component INSIDE this component's shadow tree: its
            content lands in the shadow tree, so its scoped sheets must be
            declared in THIS template — a document-head link cannot match
            content inside a shadow root (audit C). */}
        <light-probe-card class='nested-light-card' count='3'></light-probe-card>
      </article>
    );
  }
}
