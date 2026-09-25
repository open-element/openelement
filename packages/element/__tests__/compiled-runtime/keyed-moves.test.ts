import { assertEquals, assertStrictEquals } from '@std/assert';
import { FDocument, FElement, type FNode } from '../../../../benchmarks/micro/counting-dom.ts';
import {
  claimExistingDom,
  createFreshDom,
  serializeToHtml,
} from '../../src/internal/compiled/runtime.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import type { CompiledRuntimeHost } from '../../src/internal/compiled/runtime.ts';
import { testProgram } from './test-program.ts';
import { parseHtml, TestDocument, type TestElement, toHtml } from './test-dom.ts';

interface Row {
  id: string;
  text: string;
}

const program = testProgram({
  tag: 'oe-keyed-moves',
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
      iattrs: [['data-id', 'id']],
      children: [{ k: 'ival', field: 'text' }],
    }],
  }],
});

const multiNodeProgram = testProgram({
  tag: 'oe-keyed-ranges',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{
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
  }],
});

function host(items: ReturnType<typeof signal<Row[]>>): CompiledRuntimeHost {
  return { signals: { items }, handlers: {} } as unknown as CompiledRuntimeHost;
}

function rows(root: FElement): FElement[] {
  return (root.childNodes[0] as FElement).childNodes.filter(
    (node): node is FElement => node instanceof FElement,
  );
}

Deno.test('#1455: a distant swap moves only two keyed rows', () => {
  const initial = Array.from({ length: 1000 }, (_, index) => ({
    id: String(index),
    text: String(index),
  }));
  const items = signal(initial);
  const doc = new FDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(program, host(items), root as unknown as Node);
  const original = rows(root);

  doc.resetCounts();
  items.value = initial.slice();
  assertEquals(doc.counts.insertions, 0);
  const swapped = initial.slice();
  [swapped[1], swapped[998]] = [swapped[998], swapped[1]];
  doc.resetCounts();
  items.value = swapped;
  assertEquals(doc.counts.insertions, 2);
  assertEquals(doc.counts.removals, 0);
  assertStrictEquals(rows(root)[500], original[500]);
  assertStrictEquals(rows(root)[1], original[998]);
  assertStrictEquals(rows(root)[998], original[1]);
  assertEquals(rows(root).map((row) => row.getAttribute('data-id')), swapped.map((row) => row.id));

  doc.resetCounts();
  items.value = initial.slice();
  assertEquals(doc.counts.insertions, 2);
  assertEquals(rows(root).every((row, index) => row === original[index]), true);
  instance.dispose();
});

Deno.test('#1455: reordered suffixes retain keyed identity through mixed edits', () => {
  const source = Array.from({ length: 60 }, (_, index) => ({
    id: String(index),
    text: String(index),
  }));
  const items = signal(source.slice());
  const doc = new FDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(program, host(items), root as unknown as Node);
  const originals = new Map(rows(root).map((row) => [row.getAttribute('data-id'), row]));
  let current = source.slice();
  let seed = 1455;
  const nextRandom = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  try {
    for (let step = 0; step < 80; step++) {
      const next = current.slice();
      if (step % 3 === 0) {
        next.splice(Math.floor(nextRandom() * next.length), 1);
      } else if (step % 3 === 1) {
        const candidate = source.find((row) => !next.includes(row));
        if (candidate) next.splice(Math.floor(nextRandom() * (next.length + 1)), 0, candidate);
      } else {
        const a = Math.floor(nextRandom() * next.length);
        const b = Math.floor(nextRandom() * next.length);
        [next[a], next[b]] = [next[b], next[a]];
      }
      items.value = next;
      assertEquals(rows(root).map((row) => row.getAttribute('data-id')), next.map((row) => row.id));
      for (const row of rows(root)) {
        const original = originals.get(row.getAttribute('data-id'));
        if (original?.parentNode) assertStrictEquals(row, original);
        originals.set(row.getAttribute('data-id'), row);
      }
      current = next;
    }
  } finally {
    instance.dispose();
  }
});

Deno.test('#1455: multi-node entries move as ordered ranges and retain direct slots', () => {
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((text) => ({ id: text, text }));
  const items = signal([a, b, c, d]);
  const doc = new FDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(multiNodeProgram, host(items), root as unknown as Node);
  const original = [...(root.childNodes[0] as FElement).childNodes];

  doc.resetCounts();
  items.value = [a, c, b, d];
  assertEquals(doc.counts.insertions, 3, 'only one three-node entry moves');
  assertEquals(doc.counts.removals, 0);
  const actual = (root.childNodes[0] as FElement).childNodes;
  const expected: FNode[] = [
    original[0],
    ...original.slice(1, 4),
    ...original.slice(7, 10),
    ...original.slice(4, 7),
    ...original.slice(10),
  ];
  assertEquals(actual.every((node, index) => node === expected[index]), true);

  items.value = [c, b, { id: 'A', text: '' }, d, { id: 'E', text: 'E' }];
  items.value = [d, { id: 'A', text: 'again' }, c, b];
  assertEquals(
    actual.filter((node) => node.nodeType === 3)
      .map((node) => (node as { data: string }).data).join(''),
    '[D][again][C][B]',
  );
  instance.dispose();
});

Deno.test('#1455: claimed keyed entries also preserve stationary node identity', () => {
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((text) => ({ id: text, text }));
  const items = signal([a, b, c, d]);
  const state = host(items);
  const doc = new TestDocument();
  const root = parseHtml(doc, serializeToHtml(program, state));
  const claimed = claimExistingDom(program, state, root as unknown as Node);
  const list = root.childNodes[0] as TestElement;
  const original = [...list.childNodes];

  items.value = [a, c, b, d];
  assertStrictEquals(list.childNodes[1], original[1]);
  assertStrictEquals(list.childNodes[2], original[3]);
  assertStrictEquals(list.childNodes[3], original[2]);
  assertStrictEquals(list.childNodes[4], original[4]);
  assertEquals(
    toHtml(root),
    '<host><ul><!--oe:p0--><li data-id="A">A</li><li data-id="C">C</li>' +
      '<li data-id="B">B</li><li data-id="D">D</li><!--oe:/p0--></ul></host>',
  );
  claimed.dispose();
});

Deno.test('#1455: insert, delete and reorder retain surviving rows without extra moves', () => {
  const [a, b, c, d, e] = ['A', 'B', 'C', 'D', 'E'].map((text) => ({ id: text, text }));
  const items = signal([a, b, c, d]);
  const doc = new FDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(program, host(items), root as unknown as Node);
  const originals = new Map(rows(root).map((row) => [row.getAttribute('data-id'), row]));
  const steps = [
    { next: [d, a, e, c], moves: 3, removals: 1 },
    { next: [e, d, c, a], moves: 2, removals: 0 },
    { next: [a, c, d, e], moves: 3, removals: 0 },
    { next: [], moves: 0, removals: 4 },
    { next: [a, b], moves: 4, removals: 0 },
  ];
  for (const { next, moves, removals } of steps) {
    doc.resetCounts();
    items.value = next;
    assertEquals(rows(root).map((row) => row.getAttribute('data-id')), next.map((row) => row.id));
    assertEquals(doc.counts.insertions, moves, next.map((row) => row.id).join(','));
    assertEquals(doc.counts.removals, removals, next.map((row) => row.id).join(','));
    for (const row of rows(root)) {
      const original = originals.get(row.getAttribute('data-id'));
      if (original?.parentNode) assertStrictEquals(row, original);
    }
  }
  instance.dispose();
});

Deno.test('#1455: empty direct entries can gain text while moving past existing entries', () => {
  const direct = testProgram({
    tag: 'oe-keyed-empty',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{
      k: 'each',
      index: 0,
      signal: 'items',
      key: 'id',
      field: 'text',
      item: [{ k: 'ival', field: 'text' }],
    }],
  });
  const items = signal([{ id: 'a', text: '' }, { id: 'b', text: 'B' }, {
    id: 'c',
    text: 'C',
  }]);
  const doc = new FDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(direct, host(items), root as unknown as Node);
  const list = root.childNodes[0] as FElement;
  const bNode = list.childNodes[1];
  const cNode = list.childNodes[2];
  doc.resetCounts();
  items.value = [{ id: 'c', text: 'C' }, { id: 'a', text: 'A' }, { id: 'b', text: 'B' }];
  assertEquals(
    list.childNodes.filter((node) => node.nodeType === 3).map((node) =>
      (node as { data: string }).data
    ),
    ['C', 'A', 'B'],
  );
  assertStrictEquals(list.childNodes[1], cNode);
  assertStrictEquals(list.childNodes[3], bNode);
  assertEquals(doc.counts.texts, 1);
  items.value = [{ id: 'b', text: 'B' }, { id: 'a', text: '' }, { id: 'c', text: 'C' }];
  assertEquals(
    list.childNodes.filter((node) => node.nodeType === 3).map((node) =>
      (node as { data: string }).data
    ),
    ['B', 'C'],
  );
  instance.dispose();
});

Deno.test('#1455: a reused trailing slot stays with its range after reorder and fill', () => {
  const trailing = testProgram({
    tag: 'oe-keyed-trailing',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{
      k: 'each',
      index: 0,
      signal: 'items',
      key: 'id',
      field: 'text',
      item: [{ k: 'text', value: '[' }, { k: 'ival', field: 'text' }],
    }],
  });
  const items = signal([{ id: 'a', text: '' }, { id: 'b', text: 'B' }, {
    id: 'c',
    text: 'C',
  }]);
  const doc = new FDocument();
  const root = doc.createElement('host');
  const instance = createFreshDom(trailing, host(items), root as unknown as Node);
  const list = root.childNodes[0] as FElement;
  items.value = [{ id: 'c', text: 'C' }, { id: 'a', text: 'A' }, { id: 'b', text: 'B' }];
  assertEquals(
    list.childNodes.filter((node) => node.nodeType === 3).map((node) =>
      (node as { data: string }).data
    ).join(''),
    '[C[A[B',
  );
  instance.dispose();
});
