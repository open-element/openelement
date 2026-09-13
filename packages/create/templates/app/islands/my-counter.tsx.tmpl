/**
 * my-counter — minimal counter island (v0.44 compiled, ADR-0143).
 *
 * Hydrates on idle; the buttons increment/decrement through the compiled
 * event Parts and the count renders through the compiled text Part. The
 * shadow root keeps the island a DSD citizen.
 */
import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement, property } from '@openelement/element';
import { counterStyles } from '../components/page-styles.ts';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });

@element('my-counter', { root: 'shadow-open' })
export default class MyCounter extends OpenElement {
  static override styles = counterStyles;

  @property({ reflect: false, attribute: false })
  count = 0;

  decrement(): void {
    this.count--;
  }

  increment(): void {
    this.count++;
  }

  render() {
    return (
      <div class='counter-row'>
        <button type='button' onClick={this.decrement}>-</button>
        <span id='count'>{this.count}</span>
        <button type='button' onClick={this.increment}>+</button>
      </div>
    );
  }
}
