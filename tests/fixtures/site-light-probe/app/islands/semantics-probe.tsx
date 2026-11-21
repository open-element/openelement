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
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` is the class lane's
 * `shadow-open`, and the whole probe depends on it being a REAL shadow boundary:
 * `:host`, `:host ::slotted(...)` and the "shadow sheet stops at the boundary"
 * assertion are all statements about a shadow tree, and the spec reads the
 * subtree through `host.shadowRoot` and calls `host.getAnimations()`. A light
 * root would make every one of those measurements meaningless.
 *
 * `styles` replaces the class lane's `static styles = [semanticsStyles]`; the
 * sidecar admits the sheet so the emitted asset arrives as the marked `<link>`
 * inside this component's DSD template, and the shadow root adopts those bytes.
 */

import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  root: 'shadow',
  styles: ['./semantics-probe.css'],
});

export default function SemanticsProbe() {
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
