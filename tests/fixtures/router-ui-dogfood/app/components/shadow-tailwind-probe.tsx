/**
 * Shadow-native Tailwind probe (alpha15 S lane) — the RED consumer.
 *
 * GENERATED lane (2026-11-21 closeout: class → function). Authored exactly the
 * way the product contract promises: an ordinary shadow component whose ONLY
 * styling is Tailwind utility classes written in TSX. There is deliberately
 *   - no authored `.css` file,
 *   - no `styles` declaration,
 *   - no manual CSSStyleSheet creation/adoption,
 *   - no per-component scan configuration.
 *
 * Document-level stylesheets cannot reach a shadow tree, so these utilities only
 * work when the build compiles them for the component (the generated lane's
 * `classCandidates`, P-1) and delivers the result as a real external CSS asset
 * referenced by the DSD template (P-1b). `e2e/shadow-tailwind.spec.ts` pins the
 * computed styles without any client JavaScript.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'oe-tailwind-probe',
  root: 'shadow',
  // Static SSR with DSD: no hydration, exactly the pre-migration delivery.
  hydrate: 'none',
  properties: { label: { reflect: false } },
});

export default function OeTailwindProbe(props: { label: string }) {
  return (
    <article class="probe-card rounded-xl bg-primary p-8 text-white">
      <h2 class="text-2xl font-semibold">{props.label}</h2>
      <p class="mt-2 opacity-80">shadow-native utilities</p>
    </article>
  );
}
