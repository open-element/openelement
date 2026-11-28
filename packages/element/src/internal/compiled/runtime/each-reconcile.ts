/**
 * Keyed-list minimal-move placement (each blocks).
 *
 * ONE placement owner for every emitted `each` sync: the compiler's
 * `__oe_eachSync` reconciliation tail calls this helper with the next entry
 * order, the parent, the list's fixed tail reference (the wire's end anchor,
 * or the first non-list sibling after the non-wire anchor) and the previous
 * order; the helper decides which nodes to touch and touches nothing else.
 *
 * The contract is MINIMAL MOVE, and it is measured, not asserted: the previous
 * backward walk (place every entry from the tail inward, moving any node not
 * already before the running reference) is minimal for adjacent edits but not
 * for a distant swap — swapping entries 1 and 998 of a 1000-entry list leaves
 * the displaced entry parked at its old slot, the reference chain breaks at
 * that slot, and the walk re-inserts every entry between it and the tail
 * (measured 2026-11-24: 1994 insertBefore calls, 997 of 1000 entries, the
 * stationary entry's subtree detached and its focus lost — the class lane
 * moved only the swapped pair).
 *
 * The fix is the longest-increasing-subsequence rule React and Vue use: an
 * entry whose old position is on the LIS of the new order's old positions is
 * already in correct relative DOM order and is NEVER touched (a focused
 * control inside it keeps focus); every other entry is placed before the
 * running reference, which after a distant swap is exactly the swapped pair.
 * Among equally long stable chains the selection prefers keeping the LATER
 * old position, so a two-entry reversal moves the head-side entry and keeps
 * the tail-side entry's nodes untouched — the backward walker's own
 * behaviour, measured before this helper existed, and the difference between
 * a focused control surviving a reversal and losing focus to a body.
 * The same-order case is zero operations, an append/prepend moves only the
 * new or displaced entries, and a stable entry whose nodes were detached from
 * the parent is still placed (the stability guard checks attachment, not
 * just order).
 *
 * The helper touches ONLY the objects it is given (no DOM globals, no
 * document access), so the counting-DOM suites measure it exactly like the
 * platform would execute it.
 *
 * @module ./each-reconcile.ts
 */

/** The least an `each` entry must carry for placement: its node block. */
export interface EachReconcileEntryView {
  /** Contiguous nodes, marker first; never empty for a real entry. */
  readonly nodes: ReadonlyArray<Node>;
}

/**
 * The stable positions: the new order's entries whose old positions form a
 * longest strictly-increasing chain. Unmatched entries (-1) never qualify: a
 * fresh entry must be placed regardless.
 *
 * Among equally long chains the selection prefers keeping the LATER old
 * position, so a two-entry reversal moves the entry that HEADED the list and
 * keeps the tail-side entry's nodes untouched (a focused control inside it
 * keeps focus — the backward walker's behaviour, measured before this
 * helper existed). O(n log n): patience pass for the chain length ending at
 * each position, then a length-bucketed backward selection that takes the
 * largest old position satisfying the chain's descending bound.
 */
function longestIncreasingStablePositions(ordered: ReadonlyArray<number>): Set<number> {
  const tailValues: number[] = [];
  const buckets = new Map<number, Array<{ old: number; at: number }>>();
  for (let index = 0; index < ordered.length; index += 1) {
    const value = ordered[index]!;
    if (value < 0) continue;
    let low = 0;
    let high = tailValues.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tailValues[middle]! < value) low = middle + 1;
      else high = middle;
    }
    if (low === tailValues.length) tailValues.push(value);
    else tailValues[low] = value;

    // Within one chain length, old positions arrive in descending order.
    // A larger value would extend that chain, landing in a longer bucket.
    const length = low + 1;
    const bucket = buckets.get(length) ?? [];
    bucket.push({ old: value, at: index });
    buckets.set(length, bucket);
  }
  const positions = new Set<number>();
  let bound = Number.POSITIVE_INFINITY;
  for (let need = tailValues.length; need >= 1; need -= 1) {
    const bucket = buckets.get(need)!;
    const chosen = bucket.find((entry) => entry.old < bound);
    if (chosen === undefined) continue;
    positions.add(chosen.at);
    bound = chosen.old;
  }
  return positions;
}

/**
 * Place the next entry order into the parent with minimal node moves.
 *
 * Entries on the stable chain (LIS of matched old positions, and actually
 * attached) are untouched; every other entry is inserted before the running
 * reference from the tail inward. `parent === null` (the anchor detached) is
 * a no-op: the sync's callers own the detached case, and touching a detached
 * list would invent a placement the render never asked for.
 */
export function reconcileEachEntries(
  next: ReadonlyArray<EachReconcileEntryView>,
  parent: Node | null,
  tail: Node | null,
  previous: ReadonlyArray<EachReconcileEntryView>,
): void {
  if (parent === null) return;
  if (next.length === previous.length) {
    const seen = new Set<EachReconcileEntryView>();
    let unchanged = true;
    for (let index = 0; index < next.length; index += 1) {
      const entry = next[index]!;
      if (entry !== previous[index] || seen.has(entry) || entry.nodes[0]?.parentNode !== parent) {
        unchanged = false;
        break;
      }
      seen.add(entry);
    }
    if (unchanged) return;
  }
  const oldPosition = new Map<EachReconcileEntryView, number>();
  for (let index = 0; index < previous.length; index += 1) {
    oldPosition.set(previous[index]!, index);
  }
  const ordered = next.map((entry) => oldPosition.get(entry) ?? -1);
  const stable = longestIncreasingStablePositions(ordered);
  let reference = tail;
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const entry = next[index]!;
    const first = entry.nodes[0];
    // A stable entry is left exactly where it is: its relative DOM order is
    // already correct, so placing it again could only detach a focused or
    // animating subtree the platform was keeping alive.
    if (first !== undefined && stable.has(index) && first.parentNode === parent) {
      reference = first;
      continue;
    }
    for (let nodeIndex = entry.nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
      const node = entry.nodes[nodeIndex]!;
      if (node.parentNode !== parent || node.nextSibling !== reference) {
        parent.insertBefore(node, reference);
      }
      reference = node;
    }
  }
}
