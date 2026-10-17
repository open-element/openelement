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
 */

import '@openelement/element';
import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import cardStyles from './light-probe-card.css';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('light-probe-card', { root: 'light' })
export default class LightProbeCard extends OpenElement {
  static override styles = [cardStyles];

  @property({ reflect: false })
  count = 0;

  render() {
    return (
      <article class='probe-shared card-shell'>
        <span class='card-mark'>{this.count}</span>
      </article>
    );
  }
}
