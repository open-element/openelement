/**
 * Per-item event bindings (#1556 IR v2): ItemEventBinding entries on an each
 * Region attach a listener to every item — root-targeted by default, or a
 * structural `selector` match inside the item — and dispatch the named host
 * handler with (event, item). The listener reads the item from the entry's
 * live box, so keyed reuse (same key, new item object) keeps dispatch
 * current without re-attaching, and entry disposal removes the listener.
 */

import { expect, test } from 'vitest';
import {
  claimExistingDom,
  createFreshDom,
  serializeToHtml,
  type CompiledRuntimeHost,
} from '../../src/internal/compiled/runtime.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { parseHtml, TestDocument, type TestElement } from './test-dom.ts';
import { testProgram } from './test-program.ts';

interface Row {
  id: string;
  label: string;
}

const PROGRAM = testProgram({
  tag: 'oe-item-events',
  template: [
    {
      k: 'el',
      tag: 'ul',
      attrs: [],
      children: [{ k: 'part', index: 0 }],
    },
  ],
  parts: [
    {
      k: 'each',
      index: 0,
      signal: 'items',
      key: 'id',
      field: 'label',
      item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'label' }] }],
      itemEvents: [{ event: 'click', handler: 'pick', action: { kind: 'method', name: 'pick' } }],
    },
  ],
});

const NESTED_PROGRAM = testProgram({
  tag: 'oe-item-events-nested',
  template: [
    {
      k: 'el',
      tag: 'ul',
      attrs: [],
      children: [{ k: 'part', index: 0 }],
    },
  ],
  parts: [
    {
      k: 'each',
      index: 0,
      signal: 'items',
      key: 'id',
      item: [
        {
          k: 'el',
          tag: 'li',
          attrs: [],
          children: [
            { k: 'ival', field: 'label' },
            { k: 'el', tag: 'button', attrs: [], children: [{ k: 'text', value: 'select' }] },
          ],
        },
      ],
      itemEvents: [
        {
          event: 'pointerdown',
          handler: 'press',
          action: { kind: 'method', name: 'press' },
          selector: ':scope > *:nth-child(1)',
        },
      ],
    },
  ],
});

function eventsHost() {
  const items = signal<Row[]>([
    { id: 'a', label: 'alpha' },
    { id: 'b', label: 'beta' },
  ]);
  const calls: Array<{ handler: string; item: unknown; eventType: string }> = [];
  const host = {
    signals: { items },
    handlers: {
      pick: (event: { type: string }, item: unknown) => {
        calls.push({ handler: 'pick', item, eventType: event.type });
      },
      press: (event: { type: string }, item: unknown) => {
        calls.push({ handler: 'press', item, eventType: event.type });
      },
    },
  } as unknown as CompiledRuntimeHost;
  return { host, items, calls };
}

function listUnder(root: TestElement): TestElement {
  return root.childNodes[0] as TestElement;
}

function asNode(element: TestElement): Node {
  return element as unknown as Node;
}

test('item events dispatch the handler with (event, item) per row', () => {
  const state = eventsHost();
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(PROGRAM, state.host, asNode(root));
  const list = listUnder(root);
  (list.childNodes[2] as TestElement).dispatch('click');

  expect(state.calls).toEqual([
    { handler: 'pick', item: { id: 'b', label: 'beta' }, eventType: 'click' },
  ]);

  instance.dispose();
});

test('a selector binding targets the nested element, not the item root', () => {
  const state = eventsHost();
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(NESTED_PROGRAM, state.host, asNode(root));
  const list = listUnder(root);
  const firstRow = list.childNodes[1] as TestElement;
  firstRow.dispatch('pointerdown');
  expect(state.calls, 'the li root carries no listener').toEqual([]);

  const firstButton = firstRow.childNodes.filter(
    (child) => (child as TestElement).tagName === 'BUTTON',
  )[0] as TestElement;
  firstButton.dispatch('pointerdown');
  expect(state.calls).toEqual([
    { handler: 'press', item: { id: 'a', label: 'alpha' }, eventType: 'pointerdown' },
  ]);

  instance.dispose();
});

test('keyed reuse refreshes the dispatched item without re-attaching', () => {
  const state = eventsHost();
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(PROGRAM, state.host, asNode(root));
  const list = listUnder(root);
  const rowNode = list.childNodes[1] as TestElement;

  const replacement: Row = { id: 'a', label: 'ALPHA' };
  state.items.value = [replacement, { id: 'b', label: 'beta' }];
  expect(list.childNodes[1], 'same key kept its DOM node').toBe(rowNode);

  rowNode.dispatch('click');
  expect(state.calls).toEqual([{ handler: 'pick', item: replacement, eventType: 'click' }]);

  instance.dispose();
});

test('claiming serialized DOM attaches the same per-item listeners', () => {
  const state = eventsHost();
  const html = serializeToHtml(PROGRAM, state.host);
  const claimDoc = new TestDocument();
  const claimRoot = parseHtml(claimDoc, html);
  const claimed = claimExistingDom(PROGRAM, state.host, asNode(claimRoot));
  const list = listUnder(claimRoot);
  (list.childNodes[2] as TestElement).dispatch('click');
  expect(state.calls).toEqual([
    { handler: 'pick', item: { id: 'b', label: 'beta' }, eventType: 'click' },
  ]);

  // Keyed reuse after claim: the claimed entry's box refreshes too.
  const replacement: Row = { id: 'b', label: 'BETA' };
  state.items.value = [{ id: 'a', label: 'alpha' }, replacement];
  (list.childNodes[2] as TestElement).dispatch('click');
  expect(state.calls).toEqual([
    { handler: 'pick', item: { id: 'b', label: 'beta' }, eventType: 'click' },
    { handler: 'pick', item: replacement, eventType: 'click' },
  ]);

  claimed.dispose();
});

test('entry disposal removes its item listeners', () => {
  const state = eventsHost();
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(PROGRAM, state.host, asNode(root));
  const list = listUnder(root);
  const rowNode = list.childNodes[1] as TestElement;
  rowNode.dispatch('click');
  expect(state.calls.length).toEqual(1);

  // Removing the row disposes its scope — the listener must go with it.
  state.items.value = [{ id: 'b', label: 'beta' }];
  rowNode.dispatch('click');
  expect(state.calls.length, 'disposed row no longer dispatches').toEqual(1);

  instance.dispose();
});
