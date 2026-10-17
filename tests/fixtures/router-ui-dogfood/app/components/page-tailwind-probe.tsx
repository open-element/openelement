/**
 * /tailwind-probe page (alpha15 S lane) — hosts the RED consumer component.
 *
 * The page itself is an ordinary compiled shadow component; the probe is a
 * nested local component (the same shape the fixture already uses for its
 * boundary probes), so the whole subtree is server-rendered DSD with no
 * client JavaScript: the probe's utilities must therefore arrive as an
 * external CSS resource referenced from the emitted HTML.
 */
import { element, OpenElement } from '@openelement/element';
import './shadow-tailwind-probe.tsx';

@element('tailwind-probe-page', { root: 'shadow-open' })
export default class TailwindProbePage extends OpenElement {
  render() {
    return (
      <main>
        <h1 id='probe-heading'>shadow-native tailwind probe</h1>
        <oe-tailwind-probe label='probe'></oe-tailwind-probe>
      </main>
    );
  }
}
