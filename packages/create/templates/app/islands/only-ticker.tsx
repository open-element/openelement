/**
 * only-ticker — client-only island (v0.44 compiled, ADR-0143).
 *
 * hydrate: 'only' with ssr: false renders nothing on the server; the client
 * entry creates the DOM fresh from the compiled Part Program and binds the
 * tick event Part. Each hydrated island gets its own compiled property state,
 * so multiple tickers on one page never share state.
 */
import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement, property } from '@openelement/element';
import { tickerStyles } from '../components/page-styles.ts';

export const openElement = defineIslandConfig({ hydrate: 'only', ssr: false, dsd: false });

@element('only-ticker', { root: 'shadow-open' })
export default class OnlyTicker extends OpenElement {
  static override styles = tickerStyles;

  @property({ reflect: false, attribute: false })
  tick = 0;

  bump(): void {
    this.tick++;
  }

  render() {
    return (
      <div class='ticker-row'>
        <span id='tick'>{this.tick}</span>
        <button type='button' onClick={this.bump}>tick</button>
      </div>
    );
  }
}
