/**
 * /boom page element — error-boundary parity (ADR-0121 §7), compiled v0.44.
 *
 * The legacy error() render function became the descriptor's error
 * projector: the route module maps the caught error onto the numeric
 * `boomNormal`/`boomLoader`/`boomAction` drivers, and the compiled markup
 * carries one static Region branch per variant (compiled conditional
 * branches are fully static — the boundary texts are the two constant
 * failure messages this page can raise).
 */
import { element, OpenElement, property } from '@openelement/element';

@element('boom-page', { root: 'shadow-open' })
export default class BoomPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  boomNormal = 1;

  @property({ reflect: false, attribute: false })
  boomLoader = 0;

  @property({ reflect: false, attribute: false })
  boomAction = 0;

  render() {
    return (
      <main>
        {this.boomLoader > 0
          ? (
            <section data-variant='loader'>
              <h1 id='boundary'>boom boundary: boom-loader</h1>
              <form method='post' data-open-enhance>
                <button id='boom-submit' type='submit'>Boom</button>
              </form>
            </section>
          )
          : <span data-variant='off'></span>}
        {this.boomAction > 0
          ? (
            <section data-variant='action'>
              <h1 id='boundary'>boom boundary: boom-action</h1>
              <form method='post' data-open-enhance>
                <button id='boom-submit' type='submit'>Boom</button>
              </form>
            </section>
          )
          : <span data-variant='off'></span>}
        {this.boomNormal > 0
          ? (
            <section data-variant='normal'>
              <h1>boom page</h1>
              <form method='post' data-open-enhance>
                <button id='boom-submit' type='submit'>Boom</button>
              </form>
            </section>
          )
          : <span data-variant='off'></span>}
      </main>
    );
  }
}
