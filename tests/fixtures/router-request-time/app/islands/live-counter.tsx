/**
 * live-counter — minimal counter island.
 *
 * GENERATED lane (2026-11-21 Alpha16 closeout). Hydrates on load; clicking the
 * button increments a signal. `root: 'shadow'` matches the class lane's
 * `shadow-open`: the island's content lives in the shadow tree, which is also
 * what makes the morph client's light-DOM comparison see it as intact.
 */
import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  dsd: true,
  root: 'shadow',
});

export default function LiveCounter() {
  const count = signal(0);
  return (
    <div class="counter-row">
      <button id="increment" type="button" onClick={() => (count.value = count.value + 1)}>
        +
      </button>
      <span id="count">{count.value}</span>
    </div>
  );
}
