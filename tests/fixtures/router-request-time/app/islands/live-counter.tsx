/**
 * live-counter — minimal counter island (v0.44 compiled, ADR-0143).
 *
 * Hydrates on load; clicking the button increments the count through the
 * compiled event Part. Used on the request-time /live page to prove
 * hydration is identical to static pages. The shadow root keeps the island
 * a DSD citizen (nested-DSD morph tests assert shadowRoot presence).
 */
import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('live-counter', { root: 'shadow-open' })
export default class LiveCounter extends OpenElement {
  @property({ reflect: false, attribute: false })
  count = 0;

  increment(): void {
    this.count++;
  }

  render() {
    return (
      <div class='counter-row'>
        <button id='increment' type='button' onClick={this.increment}>+</button>
        <span id='count'>{this.count}</span>
      </div>
    );
  }
}
