/**
 * Element browser conformance (#1333): compiled element lifecycle against the REAL browser
 * platform.
 *
 * Migrated from the simulated-DOM suite packages/element/__tests__/
 * compiled-runtime/facade.test.ts (facade-dom.ts harness), merging the
 * connected behavior of these source tests into one lifecycle journey:
 *   - 'facade: fresh connect renders the compiled program end to end'
 *   - 'facade: attribute writes convert and drive Parts and Regions'
 *   - 'facade: reflect properties mirror post-connect writes to attributes'
 *   - 'facade: event handlers wire to instance methods and survive reconnect
 *     once'
 * Node identity and observable behavior are asserted (not HTML snapshots);
 * the component is the byte-for-byte compiled output of the repo's canonical
 * compiler fixture packages/element/__fixtures__/compiled-element-v1/
 * counter.tsx.
 */
import { assert } from 'chai';
import { ProgramCounter } from '../generated/oe-program-counter.ts';

customElements.define('oe-program-counter', ProgramCounter);
await customElements.whenDefined('oe-program-counter');

describe('compiled element lifecycle', () => {
  it('fresh create -> connect -> attribute reflection -> disconnect -> reconnect', () => {
    const element = document.createElement('oe-program-counter');
    document.body.appendChild(element);

    // Fresh connect renders the program (light root).
    assert.strictEqual(element.count, 0);
    assert.strictEqual(element.label, 'ready');
    const root = element.shadowRoot ?? element;
    const div = root.querySelector('div.proof');
    const h1 = div.querySelector('h1');
    const input = div.querySelector('input');
    const button = div.querySelector('button');
    assert.include(h1.textContent, 'Count: 0');
    assert.strictEqual(input.value, 'ready');
    assert.strictEqual(div.querySelector('p.parity').textContent, 'zero');
    assert.deepEqual(
      [...div.querySelectorAll('li')].map((li) => li.textContent),
      ['alpha', 'beta'],
      'each region renders the keyed items',
    );

    // Attribute write converts to the property and drives Parts and Regions.
    element.setAttribute('count', '5');
    assert.strictEqual(element.count, 5);
    assert.include(h1.textContent, 'Count: 5');
    assert.strictEqual(div.querySelector('p.parity').textContent, 'positive');

    // Property write reflects to the attribute; the mirror does not re-enter.
    element.count = 7;
    assert.strictEqual(element.getAttribute('count'), '7');
    assert.strictEqual(element.count, 7);
    // label does not reflect.
    element.label = 'changed';
    assert.isNull(element.getAttribute('label'));
    assert.strictEqual(input.value, 'changed');

    // Disconnect -> reconnect: node identity preserved, no duplicate parts.
    document.body.removeChild(element);
    document.body.appendChild(element);
    const divAfter = (element.shadowRoot ?? element).querySelector('div.proof');
    assert.strictEqual(divAfter, div, 'reconnect preserves the rendered root node');
    assert.strictEqual(divAfter.querySelector('h1'), h1, 'reconnect preserves part nodes');
    assert.lengthOf(
      divAfter.querySelectorAll('button'),
      1,
      'reconnect never duplicates rendered parts',
    );

    // Exactly one listener survives: a single click increments exactly once.
    button.click();
    assert.strictEqual(element.count, 8, 'one dispatch fires the handler exactly once');
    assert.include(h1.textContent, 'Count: 8');
    assert.strictEqual(div.querySelector('p.parity').textContent, 'positive');

    element.remove();
  });

  it('SSR-delivered attributes win at connect; removal restores the default', () => {
    const element = document.createElement('oe-program-counter');
    element.setAttribute('count', '41');
    document.body.appendChild(element);
    assert.strictEqual(element.count, 41);
    const h1 = (element.shadowRoot ?? element).querySelector('h1');
    assert.include(h1.textContent, 'Count: 41');

    element.removeAttribute('count');
    assert.strictEqual(element.count, 0, 'removal restores the compiled default');
    assert.strictEqual(element.getAttribute('count'), '0', 'reflect mirror re-appears');

    element.remove();
  });
});
