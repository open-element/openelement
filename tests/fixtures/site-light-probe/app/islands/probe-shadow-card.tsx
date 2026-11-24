/**
 * Shadow-root half of the resource-resolution probe (alpha15 S lane, S-C1.3
 * follow-up).
 *
 * The sheet is delivered to the shadow root as an ADOPTED `CSSStyleSheet` whose
 * text is the emitted asset — so every resource reference in it must already be
 * resolved (an `@import` chain inlined, `url()` rewritten by the build's own
 * asset handling). The imported token proves the import was inlined; the image
 * proves the relative asset URL still names a served file.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` is the class lane's
 * `shadow-open`. This root is the fixture's load-bearing half, not a default:
 * both specs read this component's content out of `host.shadowRoot`
 * (`.shadow-card`, `.probe-shadow-imported`, the marked link inside the
 * template), and the nested light card only has a tree to be delivered into
 * because this component HAS a shadow boundary. A light root would move the
 * card into the document, where the audit-C assertion is not measuring
 * anything.
 *
 * `styles` replaces the class lane's `static styles = [shadowStyles]`. The
 * sidecar form is what admits the sheet for a property-less shadow element:
 * the compiler emits the content-only producer, the build emits the asset, and
 * the generated server entry declares the canonical marked `<link>` INSIDE the
 * shadow template — which is the delivery the specs measure.
 */

import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  root: 'shadow',
  styles: ['./probe-shadow-card.css'],
});

export default function ProbeShadowCard() {
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
