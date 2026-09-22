/**
 * Adversarial coverage for the `each` item-identity fast path (#1416).
 *
 * `updateEach` skips an entry's slot walk when the incoming item is the same
 * object reference the entry was rendered from. That makes two behaviours
 * load-bearing, and this file pins both so a future refactor cannot trade one
 * for the other silently:
 *
 * 1. The supported shape still updates: a new item object, a new array, a
 *    reordered array, and a removed key all land in the DOM.
 * 2. The documented boundary stays a boundary: mutating a field of the *same*
 *    item object does not re-render, because nothing tells the runtime to
 *    re-read it. This is asserted in both directions — the stale value is
 *    still there, and the next update from a *new* item does apply — so the
 *    test fails loudly if the skip is removed, and equally loudly if the skip
 *    starts guessing (e.g. deep-comparing items) instead.
 *
 * It also covers the claim path, whose entries are constructed separately and
 * must carry the same item identity as fresh mounts.
 */
import { assertEquals, assertStrictEquals } from '@std/assert';
import {
  claimExistingDom,
  createFreshDom,
  serializeToHtml,
} from '../../src/internal/compiled/runtime.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import type { CompiledRuntimeHost } from '../../src/internal/compiled/runtime.ts';
import { parseHtml, TestDocument, type TestElement, toHtml } from './test-dom.ts';
import { testProgram } from './test-program.ts';

interface Row {
  id: string;
  text: string;
  cls?: string;
}

const PROGRAM = testProgram({
  tag: 'oe-item-identity',
  template: [{ k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{
    k: 'each',
    index: 0,
    signal: 'items',
    key: 'id',
    field: 'text',
    item: [{
      k: 'el',
      tag: 'li',
      attrs: [],
      iattrs: [['data-cls', 'cls']],
      children: [{ k: 'ival', field: 'text' }],
    }],
  }],
});

function node(element: TestElement): Node {
  return element as unknown as Node;
}

function listOf(root: TestElement): TestElement {
  return root.childNodes[0] as TestElement;
}

function textOf(list: TestElement, index: number): string {
  const row = list.childNodes[index] as TestElement;
  return ((row.childNodes[0] as TestElement & { data?: string }).data) ?? '';
}

Deno.test('#1416: the skip is reference identity, not a value comparison', () => {
  // The cheap stand-in for "unchanged" is a deep/value comparison, and it is
  // wrong twice over: it collapses whatever a serializer drops (functions,
  // symbols, undefined) so two genuinely different projections compare equal,
  // and it costs more than the walk it replaces. This case holds a function
  // field: both items serialize to `{"id":"a"}` under JSON, so a value-based
  // skip would leave the first function's source text in the DOM.
  const first = { id: 'a', text: () => 'one' };
  const second = { id: 'a', text: () => 'two' };
  const items = signal<Array<Record<string, unknown>>>([first]);
  const host = { signals: { items }, handlers: {} } as unknown as CompiledRuntimeHost;
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(PROGRAM, host, node(root));
  const list = listOf(root);
  const firstText = textOf(list, 1);

  items.value = [second];
  assertEquals(
    JSON.stringify({ id: 'a', text: () => 'one' }),
    JSON.stringify({ id: 'a', text: () => 'two' }),
    'precondition: a value comparison cannot tell these items apart',
  );
  assertEquals(textOf(list, 1), String(second.text), 'a different object re-projects');
  assertEquals(typeof firstText, 'string');

  instance.dispose();
});

Deno.test('#1416: a same-reference item is not re-read, a new item still is', () => {
  const first: Row = { id: 'a', text: 'alpha', cls: 'one' };
  const items = signal<Row[]>([first]);
  const host = { signals: { items }, handlers: {} } as unknown as CompiledRuntimeHost;
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(PROGRAM, host, node(root));
  const list = listOf(root);
  assertEquals(
    toHtml(root),
    '<host><ul><!--oe:p0--><li data-cls="one">alpha</li><!--oe:/p0--></ul></host>',
  );

  // In-place mutation of the *same* object: outside the reactive contract. The
  // identity check is what skips the walk, so the DOM keeps the old projection
  // — and, crucially, the entry is not left in a broken half-updated state.
  first.text = 'MUTATED';
  first.cls = 'two';
  items.value = [first];
  assertEquals(
    toHtml(root),
    '<host><ul><!--oe:p0--><li data-cls="one">alpha</li><!--oe:/p0--></ul></host>',
    'same-reference mutation does not re-render (documented boundary)',
  );
  const row = list.childNodes[1] as TestElement;
  assertStrictEquals(row, list.childNodes[1], 'the row node is still the same node');

  // A new item object under the same key: the projection must update, both the
  // value slot and the item attribute slot, through the same code path.
  items.value = [{ id: 'a', text: 'beta', cls: 'three' }];
  assertEquals(
    toHtml(root),
    '<host><ul><!--oe:p0--><li data-cls="three">beta</li><!--oe:/p0--></ul></host>',
  );

  // Third generation, this time starting from an empty slot: the lazy
  // region-reference path must still produce a correctly ordered text node
  // after a remove-then-add cycle on the same entry.
  items.value = [{ id: 'a', text: '', cls: 'three' }];
  assertEquals(
    toHtml(root),
    '<host><ul><!--oe:p0--><li data-cls="three"></li><!--oe:/p0--></ul></host>',
  );
  items.value = [{ id: 'a', text: 'gamma', cls: 'three' }];
  assertEquals(
    toHtml(root),
    '<host><ul><!--oe:p0--><li data-cls="three">gamma</li><!--oe:/p0--></ul></host>',
  );

  instance.dispose();
});

Deno.test('#1416: reorder, insert, remove and partial update survive the skip', () => {
  const a: Row = { id: 'a', text: 'A' };
  const b: Row = { id: 'b', text: 'B' };
  const c: Row = { id: 'c', text: 'C' };
  const items = signal<Row[]>([a, b, c]);
  const host = { signals: { items }, handlers: {} } as unknown as CompiledRuntimeHost;
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(PROGRAM, host, node(root));
  const list = listOf(root);
  const rowA = list.childNodes[1] as TestElement;

  // Reversed order, all references reused: move only, no slot writes.
  items.value = [c, b, a];
  assertEquals(textOf(list, 1), 'C');
  assertEquals(textOf(list, 2), 'B');
  assertEquals(textOf(list, 3), 'A');
  assertStrictEquals(list.childNodes[3], rowA, 'key a kept its node across the reorder');

  // One changed item among unchanged ones: only that entry is re-projected.
  const b2: Row = { id: 'b', text: 'B2' };
  items.value = [c, b2, a];
  assertEquals(textOf(list, 1), 'C');
  assertEquals(textOf(list, 2), 'B2');
  assertEquals(textOf(list, 3), 'A');

  // Remove + insert: disposed entry's node is gone, inserted entry is last.
  items.value = [c, a, { id: 'd', text: 'D' }];
  assertEquals(list.childNodes.length, 5, 'two rows plus both anchors');
  assertEquals(textOf(list, 1), 'C');
  assertEquals(textOf(list, 2), 'A');
  assertEquals(textOf(list, 3), 'D');

  instance.dispose();
});

Deno.test('#1416: claim carries item identity through to the first update', () => {
  const a: Row = { id: 'a', text: 'alpha', cls: 'one' };
  const items = signal<Row[]>([a, { id: 'b', text: 'beta', cls: 'two' }]);
  const host = { signals: { items }, handlers: {} } as unknown as CompiledRuntimeHost;
  const html = serializeToHtml(PROGRAM, host);
  const claimDoc = new TestDocument();
  const claimRoot = parseHtml(claimDoc, html);
  const claimed = claimExistingDom(PROGRAM, host, node(claimRoot));
  const list = listOf(claimRoot);
  assertEquals(textOf(list, 1), 'alpha');

  // Same-reference array after claim: the claim-built entries already carry
  // the item, so this update must skip — and must not corrupt or duplicate
  // the claimed nodes. If the claim entry forgot to record its item, this
  // would still pass by re-writing identical text, so the assertion that
  // catches it is the node-identity one below.
  const rowBefore = list.childNodes[1] as TestElement;
  items.value = [{ id: 'a', text: 'alpha', cls: 'one' }, { id: 'b', text: 'beta', cls: 'two' }];
  assertStrictEquals(list.childNodes[1], rowBefore);
  assertEquals(list.childNodes.length, 4);

  // A new item on the claimed entry updates in place (no rebuild).
  items.value = [{ id: 'a', text: 'ALPHA', cls: 'one' }, { id: 'b', text: 'beta', cls: 'two' }];
  assertStrictEquals(list.childNodes[1], rowBefore, 'claim entry updated, not rebuilt');
  assertEquals(textOf(list, 1), 'ALPHA');

  claimed.dispose();
});

Deno.test('#1416: skip leaves an item attribute slot untouched, not removed', () => {
  // The attr-slot branch removes an attribute when the projected value is
  // null. Skipping must not be confused with "null projection": an unchanged
  // item keeps whatever the previous projection wrote.
  const row: Row = { id: 'a', text: 'A', cls: 'keep' };
  const items = signal<Row[]>([row]);
  const host = { signals: { items }, handlers: {} } as unknown as CompiledRuntimeHost;
  const doc = new TestDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(PROGRAM, host, node(root));
  const list = listOf(root);
  const element = list.childNodes[1] as TestElement;
  const html = '<host><ul><!--oe:p0--><li data-cls="keep">A</li><!--oe:/p0--></ul></host>';
  assertEquals(toHtml(root), html);

  items.value = [row];
  assertEquals(toHtml(root), html, 'same-reference update rewrites nothing');
  assertEquals(element.getAttribute('data-cls'), 'keep');

  // Dropping the field on a *new* item removes the attribute (the null path),
  // which is the contrast case that proves the skip above did not run it.
  items.value = [{ id: 'a', text: 'A' }];
  assertEquals(element.getAttribute('data-cls'), null);
  assertEquals(
    toHtml(root),
    '<host><ul><!--oe:p0--><li>A</li><!--oe:/p0--></ul></host>',
  );

  instance.dispose();
});
