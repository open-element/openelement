/**
 * Element browser conformance (#1333): minimal Lit host/lifecycle case with Lit's own runtime
 * (lit@3.3.3 from this directory's node_modules), plus a same-page
 * coexistence check with the compiled OE element. This is interoperability
 * evidence only — not Lit Framework Mode.
 */
import { assert } from 'chai';
import { html, LitElement } from 'lit';
import { ProgramCounter } from '../generated/oe-program-counter.ts';

class WtrLitHost extends LitElement {
  static properties = { message: { type: String } };

  constructor() {
    super();
    this.message = 'hello';
  }

  render() {
    return html`<p id="msg">${this.message}</p>`;
  }
}
customElements.define('wtr-lit-host', WtrLitHost);
customElements.define('oe-program-counter', ProgramCounter);
await Promise.all([
  customElements.whenDefined('wtr-lit-host'),
  customElements.whenDefined('oe-program-counter'),
]);

describe('Lit host lifecycle (interop evidence)', () => {
  it('connects, renders, reacts to a property change, disconnects/reconnects cleanly', async () => {
    const element = document.createElement('wtr-lit-host');
    document.body.appendChild(element);
    await element.updateComplete;

    const paragraph = element.shadowRoot.querySelector('#msg');
    assert.strictEqual(paragraph.textContent, 'hello', 'initial render');

    element.message = 'changed';
    await element.updateComplete;
    assert.strictEqual(element.shadowRoot.querySelector('#msg').textContent, 'changed');

    document.body.removeChild(element);
    document.body.appendChild(element);
    await element.updateComplete;
    assert.strictEqual(
      element.shadowRoot.querySelector('#msg'),
      paragraph,
      'reconnect preserves the rendered node identity',
    );
    assert.strictEqual(paragraph.textContent, 'changed', 'state survives reconnect');

    element.remove();
  });

  it('a Lit host and a compiled OE element coexist on one page', async () => {
    const lit = document.createElement('wtr-lit-host');
    const oe = document.createElement('oe-program-counter');
    document.body.append(lit, oe);
    await lit.updateComplete;

    oe.querySelector('button').click();
    assert.strictEqual(oe.count, 1, 'OE compiled handler ran beside the Lit host');
    assert.strictEqual(
      lit.shadowRoot.querySelector('#msg').textContent,
      'hello',
      'Lit render is unaffected',
    );

    lit.remove();
    oe.remove();
  });
});
