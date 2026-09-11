/**
 * note-counter — minimal counter island (compiled, ADR-0143), the
 * app-flow-native sibling of the request-time fixture's live-counter.
 *
 * Hydrates on load; clicking the button increments the count through the
 * compiled event Part. Used on /notes to prove activation (SSR claim, not
 * double render) on a request-time page.
 */
import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('note-counter', { root: 'shadow-open' })
export default class NoteCounter extends OpenElement {
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
