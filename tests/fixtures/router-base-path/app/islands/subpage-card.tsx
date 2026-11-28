/**
 * Non-root-base fixture — nested SHADOW component (S-C2/S-12).
 *
 * Generated lane (2026-11-21 closeout): the sidecar `styles` declaration is the
 * shadow sheet's one carrier — the compiler turns it into a module-graph import
 * and the DSD template declares a marked, base-prefixed `<link>` for the emitted
 * asset.
 */
import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  // Declared for the same reason as the note's: `app/components/` owns no tag
  // convention, so the sidecar is the identity source.
  tag: 'subpage-card',
  root: 'shadow',
  styles: ['./subpage-card.css'],
});

export default function SubpageCard() {
  const shown = signal(false);
  return (
    <section>
      <span class="subpage-card">carded</span>
      <button type="button" onClick={() => (shown.value = true)}>Show generated child</button>
      {shown.value ? <subpage-late></subpage-late> : null}
    </section>
  );
}
