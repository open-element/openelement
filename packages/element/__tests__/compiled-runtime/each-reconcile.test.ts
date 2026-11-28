/**
 * Keyed-list minimal-move placement (`each-reconcile.ts`), the ONE placement
 * owner the emitted `__oe_eachSync` tail calls.
 *
 * The contract these rows pin is #1455's, mirrored from the retained
 * Part-Program runtime (`keyed-moves.test.ts`) onto the generated lane: a
 * distant swap places EXACTLY the swapped entries, the stationary entries in
 * between are never re-inserted (their nodes are never detached, so a focused
 * control inside one keeps focus), and the same-order case is zero operations.
 * The counting fake DOM (benchmarks/micro/counting-dom.ts) is the ONE
 * measurement harness — no second fake.
 */
import { expect, test } from 'vitest';
import {
  reconcileEachEntries,
  type EachReconcileEntryView,
} from '../../src/internal/compiled/runtime/each-reconcile.ts';
import {
  FComment,
  FDocument,
  FElement,
  type FNode,
} from '../../../../benchmarks/micro/counting-dom.ts';

interface Fixture {
  doc: FDocument;
  parent: FElement;
  tail: FComment;
  entries: EachReconcileEntryView[];
  firstNodes: FNode[];
}

/** `count` two-node entries (a marker and an element), placed in order. */
function fixture(count: number): Fixture {
  const doc = new FDocument();
  const parent = doc.createElement('list');
  const tail = doc.createComment('oe:/r:each');
  parent.appendChild(tail);
  const entries: EachReconcileEntryView[] = [];
  const firstNodes: FNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const marker = doc.createComment(`oe:k:s:${index}`);
    const element = doc.createElement('row');
    element.setAttribute('data-id', String(index));
    parent.insertBefore(marker, tail);
    parent.insertBefore(element, tail);
    entries.push({ nodes: [marker, element] });
    firstNodes.push(marker);
  }
  return { doc, parent, tail, entries, firstNodes };
}

test('#1455 mirror: a distant swap places exactly the two swapped entries', () => {
  const { doc, parent, tail, entries, firstNodes } = fixture(1000);
  const swapped = entries.slice();
  [swapped[1], swapped[998]] = [swapped[998], swapped[1]];

  doc.resetCounts();
  reconcileEachEntries(swapped, parent, tail, entries);

  // Two entries x two nodes: nothing else is inserted, nothing is removed.
  expect(doc.counts.insertions).toEqual(4);
  expect(doc.counts.removals).toEqual(0);
  // The stationary entry between them was never detached (a focused control
  // inside it keeps focus) — identity, plus the order it sits in.
  expect(firstNodes[500]!.parentNode).toBe(parent);
  const order = parent.childNodes.filter((node) => node instanceof FComment);
  // Comments before m500 in the final order: m0, m998, m2..m499.
  expect(order.indexOf(firstNodes[500]!)).toEqual(500);
  // The full order follows the keys.
  const expectedIds: string[] = [];
  for (let index = 0; index < 1000; index += 1) {
    if (index === 1) expectedIds.push('998');
    else if (index === 998) expectedIds.push('1');
    else expectedIds.push(String(index));
  }
  expect(
    parent.childNodes
      .filter((node) => node instanceof FElement)
      .map((node) => (node as FElement).getAttribute('data-id')),
  ).toEqual(expectedIds);
});

test('the same order is zero operations', () => {
  const { doc, parent, tail, entries } = fixture(200);
  doc.resetCounts();
  reconcileEachEntries(entries.slice(), parent, tail, entries);
  expect(doc.counts.insertions).toEqual(0);
  expect(doc.counts.removals).toEqual(0);
});

test('a two-entry reversal keeps the tail-side entry and moves the head', () => {
  const { doc, parent, tail, entries, firstNodes } = fixture(2);
  const reversed = entries.slice().reverse();
  doc.resetCounts();
  reconcileEachEntries(reversed, parent, tail, entries);
  // One entry moves (its two nodes); the LATER entry keeps its nodes
  // untouched, which is what keeps a focused control alive through a small
  // reorder (the old backward walker's tie-break, and the M06 S2 row's
  // contract).
  expect(doc.counts.insertions).toEqual(2);
  expect(firstNodes[1]!.parentNode).toBe(parent);
  expect(parent.childNodes.indexOf(firstNodes[1]!)).toEqual(0);
});

test('a new front entry places only itself', () => {
  const { doc, parent, tail, entries } = fixture(50);
  const marker = doc.createComment('oe:k:s:new');
  const element = doc.createElement('row');
  element.setAttribute('data-id', 'new');
  const fresh = [{ nodes: [marker, element] }, ...entries];
  doc.resetCounts();
  reconcileEachEntries(fresh, parent, tail, entries);
  // The new entry's two nodes are the only insertions; the 50 old entries
  // are an increasing chain and stay untouched.
  expect(doc.counts.insertions).toEqual(2);
  expect(parent.childNodes.indexOf(marker)).toEqual(0);
});

test('a stable entry whose nodes were detached is still placed', () => {
  const { doc, parent, tail, entries, firstNodes } = fixture(60);
  const stableMarker = firstNodes[30]!;
  const stableElement = entries[30]!.nodes[1] as FElement;
  parent.removeChild(stableMarker);
  parent.removeChild(stableElement);
  doc.resetCounts();
  reconcileEachEntries(entries.slice(), parent, tail, entries);
  // Exactly the detached entry returns; nothing else moved. Its marker sits
  // at its entry index (60 nodes precede it) and the element right after.
  expect(doc.counts.insertions).toEqual(2);
  expect(stableMarker.parentNode).toBe(parent);
  expect(parent.childNodes.indexOf(stableMarker)).toEqual(60);
  expect(parent.childNodes.indexOf(stableElement)).toEqual(61);
});

test('duplicate entries retain placement behavior even when the sequence is unchanged', () => {
  const { doc, parent, tail, entries } = fixture(2);
  const [a, b] = entries;
  // Put b ahead of a, then supply the same duplicated entry sequence twice.
  for (const node of b!.nodes) parent.insertBefore(node, a!.nodes[0]!);
  const duplicated = [a!, b!, a!];
  doc.resetCounts();
  reconcileEachEntries(duplicated.slice(), parent, tail, duplicated);
  expect(doc.counts.insertions).toEqual(2);
  expect(parent.childNodes.indexOf(a!.nodes[0] as FNode)).toEqual(0);
});

test('a detached anchor (parent null) is a no-op', () => {
  const { doc, entries, tail } = fixture(3);
  doc.resetCounts();
  expect(() => reconcileEachEntries(entries.slice(), null, tail, entries)).not.toThrow();
  expect(doc.counts.insertions).toEqual(0);
});
