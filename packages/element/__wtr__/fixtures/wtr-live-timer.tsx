/**
 * `wtr-live-timer` — the client-only style-adoption fixture (2026-11-20).
 *
 * The shape is the starter's `live-timer` reduced to what the browser row needs
 * to prove: `ssr: false` + a shadow root (so the browser creates the root and
 * NO DSD template exists to carry a `<link>`), one declared sheet whose
 * `:host { display: inline-block }` rule is observable through computed style,
 * and an `onConnect` clock that writes a retained `signal` the compiled text
 * Part reads.
 *
 * The compiler must turn the sidecar's `styles` list into a real
 * `import sheet from './wtr-live-timer.css'`; the element-browser project's
 * sheet plugin answers it with a constructed `StyleSheet` (the same
 * `StyleSheetLike` contract the router build's intercept serves as a
 * `CSSStyleSheet`). The shell then adopts that object into the root it created.
 * Without either half the host's computed `display` would be `inline` (the
 * default for a custom element), which is exactly what the test watches.
 */
import { signal } from '@openelement/element';
import { onConnect } from '@openelement/element/lifecycle';

/**
 * Local stand-in for the router's `defineIslandConfig` (the element-browser
 * project resolves only the element package and the ui modules). The compiler's
 * sidecar locator matches the STATEMENT SHAPE — `export const openElement =
 * <call>({...})` — and never the callee, so this fixture exercises the real
 * reader without pulling the router into the browser graph. The emitted module
 * keeps no authored statement, so the stand-in itself never ships.
 */
function defineIslandConfig<T extends object>(config: T): T {
  return config;
}

export const openElement = defineIslandConfig({
  hydrate: 'only',
  ssr: false,
  dsd: false,
  root: 'shadow',
  styles: ['./wtr-live-timer.css'],
});

function WtrLiveTimer() {
  const elapsed = signal('0.0');

  onConnect(() => {
    const interval = globalThis.setInterval(() => {
      elapsed.value = (Math.round(globalThis.performance.now()) / 1000).toFixed(1);
    }, 50);
    return () => globalThis.clearInterval(interval);
  });

  return (
    <div class="row">
      <span id="elapsed">{elapsed.value}</span>
      <span>seconds</span>
    </div>
  );
}

export default WtrLiveTimer;
