/**
 * Second light-root component type of the light-style delivery probe
 * (alpha15 S lane, S-C1.2).
 *
 * Two instances of this component are rendered by the probe page, so the
 * spec can prove that N instances share ONE emitted stylesheet, and that a
 * component's scoped rules never reach the SIBLING component (open-light-probe)
 * or the unrelated document element that reuse the `.probe-shared` class.
 *
 * `ssr: true` admits the host to the SSR renderable set; `hydrate: 'load'`
 * makes the client entry evaluate this island's chunk immediately, so the
 * client adoption path runs without an interaction.
 *
 * GENERATED lane (F16: class → function). `root: 'light'` is the class lane's
 * `root: 'light'` spelled explicitly: an omitted root is light by DEFAULT on
 * this lane, and a fixture proving light delivery must not depend on a default
 * it never states. `count` keeps the class lane's `@property({ reflect: false })`
 * exactly — a NON-reflecting but still attribute-backed row, because the page
 * authors `<light-probe-card count='1'>` and that attribute is the value's only
 * channel on both the server render and the client claim. Keeping it as a
 * sidecar row (not folding it into local state) is what makes the `count`
 * attribute survive the upgrade instead of being dropped by it.
 *
 * The sheet also carries a shadow-tree half: `probe-shadow-card` renders one
 * instance of this component INSIDE its shadow root, and that instance reads
 * the same row.
 */

import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  root: 'light',
  styles: ['./light-probe-card.css'],
  properties: {
    // No `reflect`: the class lane never wrote this attribute back, and the
    // attribute name stays derived from the property name so the page's
    // `count='1'`/'2' attributes keep landing on it.
    count: { reflect: false, default: 0 },
  },
});

interface LightProbeCardProps {
  count: number;
}

export default function LightProbeCard(props: LightProbeCardProps) {
  const count = props.count ?? 0;
  return (
    <article class='probe-shared card-shell'>
      <span class='card-mark'>{count}</span>
    </article>
  );
}
