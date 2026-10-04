import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import {
  claimExistingDom,
  createFreshDom,
  serializeToHtml,
} from '../../src/internal/compiled/runtime.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import type { CompiledRuntimeHost } from '../../src/internal/compiled/runtime.ts';
import { parseHtml, TestDocument, type TestElement, type TestText, toHtml } from './test-dom.ts';
import { testProgram } from './test-program.ts';

const REGION_PROGRAM = testProgram({
  tag: 'oe-regions',
  template: [
    {
      k: 'el',
      tag: 'div',
      attrs: [],
      children: [
        { k: 'part', index: 0 },
        { k: 'part', index: 1 },
        { k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 2 }] },
      ],
    },
  ],
  parts: [
    { k: 'text', index: 0, signal: 'message' },
    {
      k: 'when',
      index: 1,
      signal: 'visible',
      test: { signal: 'visible', op: 'greater-than', value: 0 },
      on: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'text', value: 'nested' }] }],
      off: [{ k: 'el', tag: 'em', attrs: [], children: [{ k: 'text', value: 'hidden' }] }],
    },
    {
      k: 'each',
      index: 2,
      signal: 'items',
      key: 'id',
      field: 'text',
      item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'text' }] }],
    },
  ],
});

function regionHost() {
  const message = signal('hello');
  const visible = signal(1);
  const items = signal([
    { id: 'a', text: 'alpha' },
    { id: 'b', text: 'beta' },
  ]);
  const host = {
    signals: { message, visible, items },
    handlers: {},
  } as unknown as CompiledRuntimeHost;
  return { host, message, visible, items };
}

function node(element: TestElement): Node {
  return element as unknown as Node;
}

function divOf(root: TestElement): TestElement {
  return root.childNodes[0] as TestElement;
}

test('Regions own branch lifetimes and keyed identity in fresh DOM', () => {
  const state = regionHost();
  const html = serializeToHtml(REGION_PROGRAM, state.host);
  expect(html).toEqual(
    '<div><!--oe:p0-->hello<!--oe:p1--><p>nested</p><!--oe:/p1-->' +
      '<ul><!--oe:p2--><li>alpha</li><li>beta</li><!--oe:/p2--></ul></div>',
  );

  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(REGION_PROGRAM, state.host, node(root));
  const div = divOf(root);
  const list = div.childNodes[5] as TestElement;
  const first = list.childNodes[1] as TestElement;
  const second = list.childNodes[2] as TestElement;
  expect(toHtml(root)).toEqual(`<host>${html}</host>`);

  state.visible.value = 0;
  expect((div.childNodes[3] as TestElement).tagName).toEqual('EM');

  state.visible.value = 1;
  const restoredParagraph = div.childNodes[3] as TestElement;
  expect((restoredParagraph.childNodes[0] as TestText).data).toEqual('nested');

  state.items.value = [
    { id: 'b', text: 'beta' },
    { id: 'a', text: 'ALPHA' },
    { id: 'c', text: 'gamma' },
  ];
  expect(list.childNodes[1], 'key b moved with its DOM node').toBe(second);
  expect(list.childNodes[2], 'key a moved with its DOM node').toBe(first);
  expect(((list.childNodes[2] as TestElement).childNodes[0] as TestText).data).toEqual('ALPHA');
  expect(((list.childNodes[3] as TestElement).childNodes[0] as TestText).data).toEqual('gamma');

  state.items.value = [{ id: 'a', text: 'ALPHA' }];
  expect(list.childNodes[1]).toBe(first);
  expect(list.childNodes.length, 'Region retains only its anchors and live entries').toEqual(3);

  instance.dispose();
  state.message.value = 'disposed';
  expect((div.childNodes[1] as TestText).data).toEqual('hello');
});

test('item value slots create their text node when an item becomes non-empty', () => {
  const items = signal([{ id: 'a', text: '' }]);
  const program = testProgram({
    tag: 'oe-item-values',
    template: [{ k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [
      {
        k: 'each',
        index: 0,
        signal: 'items',
        key: 'id',
        field: 'text',
        item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'text' }] }],
      },
    ],
  });
  const host = { signals: { items }, handlers: {} } as unknown as CompiledRuntimeHost;
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const fresh = createFreshDom(program, host, node(root));
  expect(
    ((root.childNodes[0] as TestElement).childNodes[1] as TestElement).childNodes.length,
  ).toEqual(0);

  items.value = [{ id: 'a', text: 'now visible' }];
  expect(toHtml(root)).toEqual(
    '<host><ul><!--oe:p0--><li>now visible</li><!--oe:/p0--></ul></host>',
  );
  items.value = [{ id: 'a', text: '' }];
  expect(
    ((root.childNodes[0] as TestElement).childNodes[1] as TestElement).childNodes.length,
  ).toEqual(0);

  fresh.dispose();
  items.value = [{ id: 'a', text: '' }];
  const html = serializeToHtml(program, host);
  const claimDoc = new TestDocument();
  const claimRoot = parseHtml(claimDoc, html);
  const claimed = claimExistingDom(program, host, node(claimRoot));
  expect(
    ((claimRoot.childNodes[0] as TestElement).childNodes[1] as TestElement).childNodes.length,
  ).toEqual(0);
  items.value = [{ id: 'a', text: 'claimed visible' }];
  expect(toHtml(claimRoot)).toEqual(
    '<host><ul><!--oe:p0--><li>claimed visible</li><!--oe:/p0--></ul></host>',
  );
  items.value = [{ id: 'a', text: '' }];
  expect(
    ((claimRoot.childNodes[0] as TestElement).childNodes[1] as TestElement).childNodes.length,
  ).toEqual(0);
  claimed.dispose();
});

test('direct item value slots keep empty and multi-node item ranges ordered', () => {
  const items = signal([
    { id: 'a', text: '' },
    { id: 'b', text: 'B' },
  ]);
  const program = testProgram({
    tag: 'oe-direct-item-values',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [
      {
        k: 'each',
        index: 0,
        signal: 'items',
        key: 'id',
        field: 'text',
        item: [
          { k: 'text', value: '[' },
          { k: 'ival', field: 'text' },
          { k: 'text', value: ']' },
        ],
      },
    ],
  });
  const host = { signals: { items }, handlers: {} } as unknown as CompiledRuntimeHost;
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(program, host, node(root));

  expect(toHtml(root)).toEqual('<host><div><!--oe:p0-->[][B]<!--oe:/p0--></div></host>');
  items.value = [
    { id: 'b', text: '' },
    { id: 'a', text: 'A' },
  ];
  expect(toHtml(root)).toEqual('<host><div><!--oe:p0-->[][A]<!--oe:/p0--></div></host>');
  items.value = [
    { id: 'a', text: '' },
    { id: 'b', text: 'B' },
  ];
  expect(toHtml(root)).toEqual('<host><div><!--oe:p0-->[][B]<!--oe:/p0--></div></host>');
  instance.dispose();
});

test('Region update errors propagate when the host has no update-error sink (#1375)', () => {
  const items = signal<unknown>([{ id: 'a', text: 'alpha' }]);
  const program = testProgram({
    tag: 'oe-unguarded-each',
    template: [{ k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [
      {
        k: 'each',
        index: 0,
        signal: 'items',
        key: 'id',
        field: 'text',
        item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'text' }] }],
      },
    ],
  });
  const host = { signals: { items }, handlers: {} } as unknown as CompiledRuntimeHost;
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(program, host, node(root));
  // The isolation contract is a kernel feature: a bare runtime host without
  // onUpdateError keeps the propagating behavior. #1413: the thrown message
  // names the authored property, not the compiler's part index.
  assertThrowsIncludes(
    () => {
      items.value = 'not-an-array';
    },
    Error,
    'expects an array',
  );
  instance.dispose();
});

test('each validates every reused item projection before mutating and keeps its subscription', () => {
  const items = signal<unknown>([
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ]);
  const errors: unknown[] = [];
  const program = testProgram({
    tag: 'oe-each-update-preflight',
    template: [{ k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [
      {
        k: 'each',
        index: 0,
        signal: 'items',
        key: 'id',
        field: 'text',
        item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'text' }] }],
      },
    ],
  });
  const host = {
    signals: { items },
    handlers: {},
    onUpdateError: (error: unknown) => errors.push(error),
  } as CompiledRuntimeHost;
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(program, host, node(root));
  const before = toHtml(root);
  items.value = [
    { id: 'a', text: 'changed-too-early' },
    {
      id: 'b',
      get text() {
        throw new Error('later item failed');
      },
    },
  ];
  expect(errors.length).toEqual(1);
  expect(toHtml(root)).toEqual(before);

  items.value = [
    { id: 'a', text: 'A2' },
    { id: 'b', text: 'B2' },
  ];
  expect(toHtml(root).includes('<li>A2</li><li>B2</li>')).toEqual(true);
  instance.dispose();
});
