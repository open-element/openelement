/**
 * CSS-semantics probe (alpha15 S lane, S-C2/S-11).
 *
 * A shadow-root island whose authored sheet is the only styling channel for its
 * subtree: nesting, `@keyframes`, a registered `@property`, `:host` and
 * `:host ::slotted(...)`. The spec measures the computed result in Chromium,
 * Firefox and WebKit after the build's own CSS processing produced the emitted
 * asset the shadow root parses — so a construct the pipeline dropped, flattened
 * wrongly, or scoped when it must not be shows up as a wrong computed value.
 *
 * The slotted child is authored by the PAGE (light DOM): `::slotted()` is the
 * only rule form that reaches it, which is exactly what the probe measures.
 */

import '@openelement/element';
import { element, OpenElement } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import semanticsStyles from './semantics-probe.css';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('semantics-probe', { root: 'shadow-open' })
export default class SemanticsProbe extends OpenElement {
  static override styles = [semanticsStyles];

  render() {
    return (
      <section class='semantics-shell'>
        <slot name='label'></slot>
        <p class='nested-owner'>
          <span class='nested-target'>nested</span>
        </p>
        <span class='ratio-default'>ratio default</span>
        <span class='ratio-invalid'>ratio invalid</span>
      </section>
    );
  }
}
