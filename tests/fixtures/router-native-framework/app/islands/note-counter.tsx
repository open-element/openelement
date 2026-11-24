/**
 * note-counter — minimal counter island, the app-flow-native sibling of the
 * request-time fixture's live-counter.
 *
 * GENERATED lane (2026-11-21 Alpha16 closeout). Hydrates on load; clicking the
 * button increments a signal. Used on /notes to prove activation (SSR claim, not
 * double render) on a request-time page.
 *
 * `root: 'shadow'` reproduces the class lane's `shadow-open` and is load-bearing
 * twice over: app-flow.spec asserts the /notes wire format contains
 * `<note-counter><template shadowrootmode="open">` (only a shadow root emits that
 * DSD template), and the morph client decides an island is intact by comparing
 * its LIGHT DOM — a light root would put the counter's markup in that comparison
 * and let a morph replace the node, resetting the count.
 */
import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  dsd: true,
  root: 'shadow',
});

export default function NoteCounter() {
  // The class declared this `@property({ attribute: false })`, so the count was
  // never observable from outside the element; a signal keeps it element-local
  // state without inventing an attribute channel the class refused.
  const count = signal(0);

  return (
    <div class="counter-row">
      {/* The button's label stays on one line: a wrapped text child would
          serialize as " + " instead of the class lane's "+", and the point of
          this migration is that the DOM is unchanged. */}
      <button id="increment" type="button" onClick={() => (count.value = count.value + 1)}>+</button>
      <span id="count">{count.value}</span>
    </div>
  );
}
