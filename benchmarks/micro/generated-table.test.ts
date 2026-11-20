/**
 * Deterministic self-checks for the generated-lane micro baseline (2026-11-21).
 *
 * These assert DOM-operation counts and rendered structure — never durations —
 * so the baseline is a stable subject for `benchmarks/micro/oe-table.tsx`'s
 * retirement. The measurement itself lives in `generated-table.ts`.
 */
import { expect, test } from 'vitest';
import {
  buildGeneratedRows,
  compileGeneratedTable,
  GENERATED_TABLE_SOURCE,
  runGeneratedTableBenchmark,
} from './generated-table.ts';

test('the generated-lane baseline compiles its fixture through the real lane', () => {
  const compiled = compileGeneratedTable();
  expect(compiled.compiledBytes).toBeGreaterThan(1000);
  expect(GENERATED_TABLE_SOURCE).toContain('key={row.id}');
  expect(buildGeneratedRows(3).map((row) => row.id)).toEqual([0, 1, 2]);
});

test('the generated-lane keyed table: mount, 10th-label update, swap and remove are surgical', () => {
  const facts = runGeneratedTableBenchmark();
  // 1k keyed rows mount: one <tr> per row.
  expect(facts.mountedRowCount).toEqual(1000);
  // MEASURED lane semantics: the keyed list reuses every entry node (zero
  // insertions) and each reused entry rewrites BOTH of its text slots
  // unconditionally — 1000 entries x 2 text nodes. The measured fact is recorded
  // as-is; it is not the retired input's per-field diff and the baseline does not
  // pretend otherwise.
  expect(facts.updateInsertions).toEqual(0);
  expect(facts.update10thTextWrites).toEqual(2000);
  // Keyed movement: row 1 now shows id 998 and row 998 shows id 1.
  expect(facts.swappedIds[0]).toEqual('998');
  expect(facts.swappedIds[1]).toEqual('1');
  // Removing one row removes exactly one node.
  expect(facts.removeRemovals).toEqual(1);
  expect(facts.removeLeftRowCount).toEqual(999);
});
