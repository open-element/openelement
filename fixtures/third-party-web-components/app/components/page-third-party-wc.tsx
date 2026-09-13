/**
 * /third-party-wc page element (v0.44 compiled) — static page hosting the
 * wc-fixture island. The path-derived tag is 'third-party-wc'; the
 * page class is the route element itself (no separate content element).
 */
import { element, OpenElement } from '@openelement/element';
import { wcPageStyles } from '../islands/wc-styles.ts';
// The Lit fixture creates this compiled child inside its own shadow root at
// runtime, so the page imports the capability explicitly to keep it reachable
// from the generated client delivery graph.
import '../islands/wc-open-child.tsx';

@element('third-party-wc', { root: 'shadow-open' })
export default class ThirdPartyWcPage extends OpenElement {
  static styles = wcPageStyles;

  render() {
    return (
      <main>
        <h1>Third-party Web Components interop</h1>
        <wc-fixture></wc-fixture>
      </main>
    );
  }
}
