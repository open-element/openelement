/**
 * The shadow-root half of the UnoCSS probe — a GENERATED function island
 * (2026-11-21 closeout: class → generated lane).
 *
 * Its control surface is authored as `tailwind4`-dialect utilities on the
 * component's markup; the compiler collects those static tokens (the lane's
 * `classCandidates`), the BUILD's shared component sheet and the DEV component
 * endpoint both compile them through UnoCSS, and the DSD template links that
 * sheet beside the authored `styles` assets — so the shadow root adopts both, in
 * dev and in a build alike. Nothing in this module knows which engine compiled
 * it: the class strings are the whole contract.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  root: 'shadow',
  styles: ['./probe-shadow-card.css'],
});

export default function ProbeUnocssCard() {
  return (
    <article class="card inline-flex items-center gap-2 rounded-lg bg-primary/14 px-3 py-2 text-foreground font-semibold">
      <span class="probe-marker size-4">◆</span>
      <span>The shadow control compiles through UnoCSS.</span>
    </article>
  );
}
