/**
 * /playground page element (#1339 §5B) — enhancement-guard probes (compiled):
 * - #blank-form: data-open-enhance with target='_blank' — the contract
 *   expects the browser's new-tab behavior to be preserved (no interception);
 * - #cross-form: data-open-enhance with a cross-origin action (port 4399 sink
 *   owned by the e2e) — the contract expects a plain cross-origin navigation;
 * - #get-form: data-open-enhance with method='get' — the enhance client
 *   deliberately skips GET (form-enhance.ts), so this must navigate natively;
 * - #download-link / #frag-link: plain anchors that must keep browser
 *   behavior on an enhanced page.
 */
import { element, OpenElement } from '@openelement/element';

@element('playground-page', { root: 'shadow-open' })
export default class PlaygroundPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>playground</h1>
        <form id='plain-form' method='post' data-open-enhance>
          <input id='plain-field' name='plain' type='text' value='z' />
          <button id='plain-submit' type='submit'>Plain enhanced submit</button>
        </form>
        <form id='blank-form' method='post' target='_blank' data-open-enhance>
          <input id='blank-field' name='blank' type='text' value='x' />
          <button id='blank-submit' type='submit'>New tab submit</button>
        </form>
        <form id='cross-form' method='post' action='http://127.0.0.1:4399/sink' data-open-enhance>
          <input id='cross-field' name='cross' type='text' value='y' />
          <button id='cross-submit' type='submit'>Cross-origin submit</button>
        </form>
        <form id='get-form' method='get' data-open-enhance>
          <input id='get-q' name='q' type='text' />
          <button id='get-submit' type='submit'>Search</button>
        </form>
        <a id='download-link' href='/notes' download>Download notes</a>
        <a id='frag-link' href='#frag-target'>Jump to fragment</a>
        <div id='frag-target'>fragment target</div>
      </main>
    );
  }
}
