/**
 * Deterministic self-checks for the OE microbenchmark suite (issue #1219).
 * These assert DOM-op counts and structural invariants — never durations.
 * Measured timings are evidence only (benchmarks/micro/micro-evidence.json).
 */
import { expect, test } from 'vitest';
import { runMicroSuite } from './micro.ts';

test('micro suite: partial update and single-part paths are surgical', () => {
  const { facts } = runMicroSuite({
    partWriteReps: 200,
    churnCycles: 3,
    compilerSamples: 3,
    openElementSha: 'test',
  });

  // Signal -> single Part: one signal write produces exactly one DOM write.
  expect(facts.textPartWrites).toEqual(200);
  expect(facts.attrPartWrites).toEqual(200);
  // The property Part equality guard skips a write identical to the current
  // value (loop starts at 0 == initial), so 199 or 200 writes are both exact.
  expect(
    facts.propPartWrites === 199 || facts.propPartWrites === 200,
    `prop part writes must match the write count modulo the equality guard, got ${facts.propPartWrites}`,
  ).toBeTruthy();

  // MEASURED REGRESSION, recorded rather than smoothed away (Alpha16, 2026-11-22).
  //
  // The class lane wrote exactly the 100 changed labels on a partial update (every
  // 10th of 1000 rows, one text slot each). The generated lane writes 2000 — every
  // row's two text slots — because a reused list entry is refreshed whole, with no
  // per-slot equality guard. 20x the DOM writes on the same update.
  //
  // The number is pinned so a further change stays visible, and the comment says
  // which lane produced which number: a later reader must not mistake 2000 for the
  // intended cost. Recovering the 100 needs a per-slot guard in the entry refresh,
  // which is its own slice, not a benchmark edit.
  expect(facts.update10thTextWrites).toEqual(2000);

  // Claim allocates zero DOM nodes.
  expect(facts.claimAllocations).toEqual(0);

  // Remove disposes exactly one row; swap preserves keyed order. The generated
  // lane disposes 2 nodes per removed row — the key comment and the element — where
  // the class lane disposed 1: same row removed, one more owned node per row.
  expect(facts.removeRemovals).toEqual(2);
  expect(facts.swapOrderProbe[0] !== facts.swapOrderProbe[1]).toBeTruthy();
  expect(facts.swapOrderProbe.every((id) => id.length > 0)).toBeTruthy();

  // Churn leaves no retained subscriptions or listeners.
  expect(facts.retainedSubscriptions).toEqual(0);
  expect(facts.retainedListeners).toEqual(0);
});

test('micro suite: report schema carries evidence fields', () => {
  const { report } = runMicroSuite({
    partWriteReps: 10,
    churnCycles: 1,
    compilerSamples: 1,
    openElementSha: 'test',
  });
  expect(report.kind).toEqual('micro-baseline');
  expect(report.issue).toEqual(1219);
  expect(report.table1k.serialize.htmlBytes > 0).toBeTruthy();
  expect(report.table1k.claim.claimToFreshRatio > 0).toBeTruthy();
  expect(Number.isFinite(report.compiler.medianMs)).toBeTruthy();
  for (const op of [
    report.granularity.textPart,
    report.granularity.attrPart,
    report.granularity.propPart,
    report.table1k.fresh,
    report.table1k.claim,
    report.table1k.replace1k,
    report.table1k.swap1k,
  ]) {
    expect(
      Number.isFinite(op.totalMs) && op.totalMs >= 0,
      `${op.id} totalMs must be finite`,
    ).toBeTruthy();
  }
});
