/**
 * Element browser conformance (#1333): composed event across the shadow boundary on the REAL
 * browser platform.
 *
 * Migrated from the simulated-DOM suite packages/element/__tests__/
 * compiled-runtime/facade-activation.test.ts (facade-dom.ts harness): the
 * open-shadow CSR shape of 'activation: open shadow CSR fires onCsrRendered
 * only' and the live-handler click dispatch of 'activation: closed shadow DSD
 * claim fires onDsdHydrated (H3)', re-expressed against a real open shadow
 * root with a native composed click. The simulated suite could only assert on
 * its own event bookkeeping; here the browser's composed path is the truth.
 */
import { assert } from 'chai';
import { OpenButtonElement, OpenButton__ssrHost } from '../generated/open-button.ts';
import { WtrShadowButtonElement } from '../generated/wtr-shadow-button.ts';
import { waitFor } from './helpers.js';

customElements.define('open-button', OpenButtonElement);
customElements.define('wtr-shadow-button', WtrShadowButtonElement);
await customElements.whenDefined('wtr-shadow-button');

describe('composed event across the shadow boundary', () => {
  it('a click inside the shadow root reaches a document listener via the composed path', () => {
    const element = document.createElement('wtr-shadow-button');
    document.body.appendChild(element);

    assert.isNotNull(element.shadowRoot, 'the compiled program attached an open shadow root');
    const button = element.shadowRoot.querySelector('button');
    assert.include(button.textContent, 'Clicks: 0');

    const seen = [];
    const listener = (event) =>
      seen.push({
        bubbles: event.bubbles,
        composed: event.composed,
        target: event.target,
        // composedPath() is only populated during dispatch; capture it here.
        path: event.composedPath(),
      });
    document.addEventListener('click', listener);
    try {
      button.click();
    } finally {
      document.removeEventListener('click', listener);
    }

    assert.lengthOf(seen, 1, 'the document observes exactly one click');
    const [event] = seen;
    assert.isTrue(event.bubbles, 'click bubbles');
    assert.isTrue(event.composed, 'click is composed: it crosses the shadow boundary');
    assert.strictEqual(event.target, element, 'target retargets to the host at document level');
    const path = event.path;
    assert.include(path, button, 'the composed path starts inside the shadow root');
    assert.include(path, element.shadowRoot, 'the path contains the shadow root');
    assert.include(path, element, 'the path crosses the boundary through the host');

    assert.strictEqual(element.count, 1, 'the compiled handler ran exactly once');
    assert.include(button.textContent, 'Clicks: 1', 'the text part updated in place');

    element.remove();
  });

  it('attribute-driven updates keep working through the shadow root', () => {
    const element = document.createElement('wtr-shadow-button');
    document.body.appendChild(element);
    const button = element.shadowRoot.querySelector('button');

    element.setAttribute('count', '3');
    assert.strictEqual(element.count, 3);
    assert.include(button.textContent, 'Clicks: 3');

    element.remove();
  });

  it('the production button loads its declared sheet and publishes a composed click', async () => {
    const container = document.createElement('div');
    const stylesheet = new URL('../generated/open-button.css', import.meta.url).pathname;
    container.setHTMLUnsafe(OpenButton__ssrHost({}, 'Save', undefined, [stylesheet]));
    const host = container.querySelector('open-button');
    const control = host.shadowRoot.querySelector('button');
    document.body.append(container);
    try {
      await waitFor(() => getComputedStyle(host).display === 'inline-block', 'the button sheet');
      assert.strictEqual(host.shadowRoot.querySelector('button'), control, 'retained server control');
      const clicks = [];
      container.addEventListener('open-click', (event) => clicks.push(event.target));
      control.click();
      assert.deepEqual(clicks, [host]);
    } finally {
      container.remove();
    }
  });
});
