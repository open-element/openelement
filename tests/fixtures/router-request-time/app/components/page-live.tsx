/**
 * /live page element — request-time rendered (renderIntent mode 'dynamic').
 *
 * The loader derives data from the incoming request (query param `x`) and a
 * per-process counter, so two requests must never return identical HTML. The
 * route module's props projector maps that data onto the compiled
 * `xText`/`nonceText` properties; the compiled render() only reads
 * this.<property>. A live-counter island verifies hydration behaves the same
 * as on static pages.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('live-page', { root: 'shadow-open' })
export default class LivePage extends OpenElement {
  @property({ reflect: false, attribute: false })
  xText = 'x=';

  @property({ reflect: false, attribute: false })
  nonceText = 'nonce=0';

  render() {
    return (
      <main>
        <h1>request-time live</h1>
        <p id='x-value'>{this.xText}</p>
        <p id='nonce'>{this.nonceText}</p>
        <live-counter></live-counter>
      </main>
    );
  }
}
