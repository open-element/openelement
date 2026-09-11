/**
 * Deterministic self-checks for the OE microbenchmark suite (issue #1219).
 * These assert DOM-op counts and structural invariants — never durations.
 * Measured timings are evidence only (benchmarks/micro/micro-evidence.json).
 */
import { assert, assertEquals } from '@std/assert';
import { runMicroSuite } from './micro.ts';

Deno.test('micro suite: partial update and single-part paths are surgical', () => {
  const { facts } = runMicroSuite({
    partWriteReps: 200,
    churnCycles: 3,
    compilerSamples: 3,
    openElementSha: 'test',
  });

  // Signal -> single Part: one signal write produces exactly one DOM write.
  assertEquals(facts.textPartWrites, 200);
  assertEquals(facts.attrPartWrites, 200);
  // The property Part equality guard skips a write identical to the current
  // value (loop starts at 0 == initial), so 199 or 200 writes are both exact.
  assert(
    facts.propPartWrites === 199 || facts.propPartWrites === 200,
    `prop part writes must match the write count modulo the equality guard, got ${facts.propPartWrites}`,
  );

  // Partial update writes exactly every-10th row label and nothing else.
  assertEquals(facts.update10thTextWrites, 100);

  // Claim allocates zero DOM nodes.
  assertEquals(facts.claimAllocations, 0);

  // Remove disposes exactly one row; swap preserves keyed order.
  assertEquals(facts.removeRemovals, 1);
  assert(facts.swapOrderProbe[0] !== facts.swapOrderProbe[1]);
  assert(facts.swapOrderProbe.every((id) => id.length > 0));

  // Churn leaves no retained subscriptions or listeners.
  assertEquals(facts.retainedSubscriptions, 0);
  assertEquals(facts.retainedListeners, 0);
});

Deno.test('micro suite: report schema carries evidence fields', () => {
  const { report } = runMicroSuite({
    partWriteReps: 10,
    churnCycles: 1,
    compilerSamples: 1,
    openElementSha: 'test',
  });
  assertEquals(report.kind, 'micro-baseline');
  assertEquals(report.issue, 1219);
  assert(report.table1k.serialize.htmlBytes > 0);
  assert(report.table1k.claim.claimToFreshRatio > 0);
  assert(Number.isFinite(report.compiler.medianMs));
  for (
    const op of [
      report.granularity.textPart,
      report.granularity.attrPart,
      report.granularity.propPart,
      report.table1k.fresh,
      report.table1k.claim,
      report.table1k.replace1k,
      report.table1k.swap1k,
    ]
  ) {
    assert(Number.isFinite(op.totalMs) && op.totalMs >= 0, `${op.id} totalMs must be finite`);
  }
});
