/**
 * /tailwind-probe page (alpha15 S lane) — hosts the RED consumer component.
 *
 * The page itself is an ordinary compiled shadow component; the probe is a
 * nested local component (the same shape the fixture already uses for its
 * boundary probes), so the whole subtree is server-rendered DSD with no
 * client JavaScript: the probe's utilities must therefore arrive as an
 * external CSS resource referenced from the emitted HTML.
 *
 * GENERATED lane (2026-11-21 closeout: class → function). The page keeps the
 * class lane's `shadow` root: `e2e/shadow-tailwind.spec.ts` locates the probe
 * as a direct child of the page's shadow tree.
 */
import { defineIslandConfig } from '@openelement/router';
import './shadow-tailwind-probe.tsx';

export const openElement = defineIslandConfig({ tag: 'tailwind-probe-page', root: 'shadow' });

export default function TailwindProbePage() {
  return (
    <main>
      <h1 id="probe-heading">shadow-native tailwind probe</h1>
      <oe-tailwind-probe label="probe"></oe-tailwind-probe>
    </main>
  );
}
