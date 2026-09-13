/**
 * guards-page — `/guards` enhancement-guard probes (Beta.2.2 #1339 §5B,
 * Lit port of the native /playground page):
 * - #plain-form: same-origin enhanced POST — the control proving the enhance
 *   layer is live on this page;
 * - #blank-form: target='_blank' must keep the browser's new-tab behavior;
 * - #cross-form: cross-origin action (port 4399 sink owned by the e2e) must
 *   keep the browser's plain cross-origin navigation;
 * - #get-form: method='get' is deliberately skipped by the enhance client —
 *   a native navigation;
 * - #urlenc-form / #nl-form: effective-tuple wire probes — the enhanced
 *   (fetch) and native (JS-disabled) submissions must be byte-identical on
 *   the wire, including the platform's urlencoded newline normalization;
 * - #download-link / #frag-link: plain anchors keep browser behavior.
 */
import { html, LitElement } from 'lit';

export class GuardsPage extends LitElement {
  override render() {
    return html`
      <main>
        <h1>guards</h1>
        <form id="plain-form" method="post" data-open-enhance>
          <input id="plain-field" name="plain" type="text" value="z" />
          <button id="plain-submit" type="submit">Plain enhanced submit</button>
        </form>
        <form id="blank-form" method="post" target="_blank" data-open-enhance>
          <input id="blank-field" name="blank" type="text" value="x" />
          <button id="blank-submit" type="submit">New tab submit</button>
        </form>
        <form id="cross-form" method="post" action="http://127.0.0.1:4399/sink" data-open-enhance>
          <input id="cross-field" name="cross" type="text" value="y" />
          <button id="cross-submit" type="submit">Cross-origin submit</button>
        </form>
        <form id="get-form" method="get" data-open-enhance>
          <input id="get-q" name="q" type="text" />
          <button id="get-submit" type="submit">Search</button>
        </form>
        <form id="urlenc-form" method="post" data-open-enhance>
          <input id="urlenc-title" name="title" type="text" value="hello world" />
          <input id="urlenc-tag" name="tag" type="text" value="a&amp;b" />
          <button id="urlenc-submit" type="submit" name="intent" value="urlenc">Send</button>
        </form>
        <form id="nl-form" method="post" data-open-enhance>
          <textarea id="nl-note" name="note"></textarea>
          <button id="nl-submit" type="submit" name="intent" value="nl">Send note</button>
        </form>
        <a id="download-link" href="/notes" download>Download notes</a>
        <a id="frag-link" href="#frag-target">Jump to fragment</a>
        <div id="frag-target">fragment target</div>
      </main>
    `;
  }
}
