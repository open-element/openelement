/**
 * /boom page element — loader always throws; the descriptor's error projector
 * maps the failure onto the numeric drivers and the compiled markup carries
 * one static Region branch per variant (ADR-0121 §7, status 500).
 */
import { element, OpenElement, property } from '@openelement/element';

@element('boom-page', { root: 'shadow-open' })
export default class BoomPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  boomNormal = 1;

  @property({ reflect: false, attribute: false })
  boomError = 0;

  render() {
    return (
      <main>
        {this.boomError > 0
          ? (
            <section data-variant='error'>
              <h1 id='boundary'>boom boundary: boom-loader</h1>
            </section>
          )
          : <span data-variant='off'></span>}
        {this.boomNormal > 0
          ? (
            <section data-variant='normal'>
              <h1>boom page</h1>
            </section>
          )
          : <span data-variant='off'></span>}
      </main>
    );
  }
}
