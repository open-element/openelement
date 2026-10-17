/**
 * Shadow-native Tailwind probe (alpha15 S lane) — the RED consumer.
 *
 * Authored exactly the way the product contract promises: an ordinary
 * `@element` shadow component whose ONLY styling is Tailwind utility classes
 * written in TSX. There is deliberately
 *   - no authored `.css` file,
 *   - no `static styles`,
 *   - no manual CSSStyleSheet creation/adoption,
 *   - no per-component scan configuration.
 *
 * Document-level stylesheets cannot reach a shadow tree, so these utilities
 * only work when the build compiles them for the component and delivers the
 * result as a real external CSS asset (adopted through `adoptedStyleSheets`
 * on the client; referenced as `<link rel="stylesheet">` inside the DSD
 * template on the server). Until that pipeline exists the shadow content is
 * unstyled — which is exactly what `e2e/shadow-tailwind.spec.ts` pins.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('oe-tailwind-probe', { root: 'shadow-open' })
export default class OeTailwindProbe extends OpenElement {
  @property({ reflect: false }) label = '';

  render() {
    return (
      <article class='probe-card rounded-xl bg-primary p-8 text-white'>
        <h2 class='text-2xl font-semibold'>{this.label}</h2>
        <p class='mt-2 opacity-80'>shadow-native utilities</p>
      </article>
    );
  }
}
