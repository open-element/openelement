/**
 * Deterministic self-checks for the JFB harness (issue #1219). These tests
 * never launch a browser and assert no timings; they prove the harness is
 * structurally fair and internally consistent:
 *
 * - the benchmark spec reproduces stock JFB warmup/verification semantics
 *   (proven by executing every spec against a pure model of stock store
 *   behavior)
 * - the OE implementation has the required granularity: ONE component
 *   boundary, ONE keyed Region over plain <tr> DOM, no per-row custom
 *   elements, no per-item event handlers
 * - the OE data generator is the verbatim stock algorithm
 * - the stock comparator pin table is well-formed
 * - the committed evidence file has the required provenance shape and
 *   contains only finite measured numbers
 */
import { assert, assertEquals, assertMatch, assertStringIncludes } from '@std/assert';
import { compileElementProgram } from '../../packages/element/src/internal/compiler/semantic-core/compile.ts';
import type {
  ProgramElementNode,
  ProgramTreeNode,
} from '../../packages/element/src/internal/compiler/semantic-core/program.ts';
import { executeIteration, JfbModel, verifyAllSpecsAgainstModel } from './harness/model.ts';
import {
  CPU_BENCHMARKS,
  CPU_ITERATIONS,
  geometricMean,
  mean,
  median,
  MEM_BENCHMARKS,
} from './harness/spec.ts';
import { JFB_COMMIT, PINNED_STOCK_FILES } from './harness/fetch-stock.ts';

Deno.test('jfb spec reproduces stock store semantics (model check)', () => {
  verifyAllSpecsAgainstModel();
});

Deno.test('jfb spec matches stock warmup counts and benchmark set', () => {
  assertEquals(CPU_BENCHMARKS.map((spec) => spec.id), [
    '01_run1k',
    '02_replace1k',
    '03_update10th',
    '04_select1k',
    '05_swap1k',
    '06_remove1k',
    '07_create10k',
    '08_append1k',
    '09_clear1k',
  ]);
  // Stock warmupCount values from webdriver-ts benchmarksCommon.ts.
  assertEquals(CPU_BENCHMARKS.map((spec) => spec.warmupCount), [5, 5, 3, 1, 5, 5, 5, 5, 5]);
  // Stock select benchmark records additionalNumberOfRuns: 10.
  assertEquals(CPU_BENCHMARKS.find((spec) => spec.id === '04_select1k')?.subRuns, 10);
  assert(CPU_ITERATIONS >= 5, 'iteration count must be meaningful');
  // Memory probes: three stock (21/22/25) plus the labeled OE extension.
  assertEquals(MEM_BENCHMARKS.map((spec) => spec.id), [
    '21_ready-memory',
    '22_run1k-memory',
    '25_run-clear-memory',
    '26_run10k-memory',
  ]);
  assertEquals(MEM_BENCHMARKS.filter((spec) => spec.stock).length, 3);
});

Deno.test('jfb model: repeated iterations stay consistent (id counter monotonic)', () => {
  const model = new JfbModel();
  const spec = CPU_BENCHMARKS.find((candidate) => candidate.id === '01_run1k')!;
  executeIteration(model, spec);
  // Second iteration on the same model: 5 warmups + 1 measured run consumed
  // 6000 ids, so the next run starts at 6001.
  model.run();
  assertEquals(String(model.rows[0].id), '6001');
});

Deno.test('jfb aggregation helpers are correct', () => {
  assertEquals(median([3, 1, 2]), 2);
  assertEquals(median([1, 2, 3, 4]), 2.5);
  assertEquals(mean([1, 2, 3]), 2);
  const gm = geometricMean([2, 8]);
  assert(Math.abs(gm - 4) < 1e-9);
  let threw = false;
  try {
    geometricMean([0, 1]);
  } catch {
    threw = true;
  }
  assert(threw, 'geometric mean must reject non-positive values');
});

Deno.test('oe implementation granularity: one component, one keyed region, plain table DOM', () => {
  const source = Deno.readTextFileSync(new URL('./src/oe/jfb-table.tsx', import.meta.url));
  const { program } = compileElementProgram(source, '/bench/jfb-table.tsx');
  const eachParts = program.parts.filter((part) => part.k === 'each');
  assertEquals(eachParts.length, 1, 'exactly one keyed Region owns the rows');
  const each = eachParts[0];
  assert(each.k === 'each');
  assertEquals(each.key, 'id', 'rows are keyed by the stock row id');

  const walk = (nodes: ProgramTreeNode[]): ProgramElementNode[] =>
    nodes.flatMap((node) => node.k === 'el' ? [node, ...walk(node.children)] : []);
  const itemElements = walk(each.item);
  assertEquals(each.item[0].k, 'el');
  assertEquals(
    (each.item[0] as ProgramElementNode).tag,
    'tr',
    'region item root must be a plain table row',
  );
  for (const element of itemElements) {
    assert(
      !element.tag.includes('-'),
      `region item must not instantiate custom elements, found <${element.tag}>`,
    );
  }
  // No event parts at all inside the region item template (grammar v1 cannot
  // express them); row interaction is one delegated handler on the table.
  const eventParts = program.parts.filter((part) => part.k === 'event');
  assertEquals(eventParts.length, 7, 'six jumbotron buttons plus one delegated table handler');
});

Deno.test('oe data generator is the verbatim stock JFB algorithm', () => {
  const data = Deno.readTextFileSync(new URL('./src/oe/data.ts', import.meta.url));
  for (const word of ['pretty', 'quaint', 'unsightly', 'inexpensive', 'fancy']) {
    assertStringIncludes(data, `'${word}'`);
  }
  for (const word of ['table', 'bbq', 'pony', 'keyboard']) {
    assertStringIncludes(data, `'${word}'`);
  }
  // The stock _random formula and a module-level monotonic id counter.
  assertStringIncludes(data, 'Math.round(Math.random() * 1000) % max');
  assertStringIncludes(data, 'let idCounter = 1');
  // Word list sizes must match stock (25 adjectives, 11 colours, 13 nouns).
  const adjectives = data.match(/const adjectives = \[([\s\S]*?)\];/)![1].match(/'[^']+'/g)!;
  const colours = data.match(/const colours = \[([\s\S]*?)\];/)![1].match(/'[^']+'/g)!;
  const nouns = data.match(/const nouns = \[([\s\S]*?)\];/)![1].match(/'[^']+'/g)!;
  assertEquals(adjectives.length, 25);
  assertEquals(colours.length, 11);
  assertEquals(nouns.length, 13);
});

Deno.test('stock comparator pin table is well-formed', () => {
  assertMatch(JFB_COMMIT, /^[0-9a-f]{40}$/);
  assert(PINNED_STOCK_FILES.length >= 15, 'pin table must cover css plus all comparator sources');
  for (const pinned of PINNED_STOCK_FILES) {
    assertMatch(pinned.sha256, /^[0-9a-f]{64}$/);
    assert(!pinned.path.startsWith('/'), 'pinned paths are repo-relative');
  }
  // Every required comparator family is covered.
  const paths = PINNED_STOCK_FILES.map((pinned) => pinned.path).join('\n');
  for (const impl of ['vanillajs', 'preact-signals', 'lit', 'solid', 'vue', 'svelte']) {
    assertStringIncludes(paths, `frameworks/keyed/${impl}/`);
  }
});

Deno.test('committed evidence has the required provenance and finite numbers', async () => {
  const evidenceUrl = new URL('./evidence.json', import.meta.url);
  let raw: string;
  try {
    raw = await Deno.readTextFile(evidenceUrl);
  } catch {
    throw new Error('benchmarks/jfb/evidence.json must be committed (run harness/run.ts)');
  }
  const evidence = JSON.parse(raw) as Record<string, unknown>;
  assertEquals(evidence.kind, 'jfb-local-baseline');
  assertEquals(evidence.issue, 1219);
  const provenance = evidence.provenance as Record<string, unknown>;
  const oe = provenance.openElement as { sha: string };
  assertMatch(oe.sha, /^[0-9a-f]{40}$/);
  const jfb = provenance.jfb as { commit: string };
  assertEquals(jfb.commit, JFB_COMMIT);
  const browser = provenance.browser as { engine: string; version: string };
  assert(browser.engine.length > 0 && browser.version.length > 0);
  assert(Array.isArray(provenance.deviationsFromStock));

  const results = evidence.results as Array<Record<string, unknown>>;
  const ids = results.map((result) => result.id);
  assert(ids.includes('oe') && ids.includes('vanillajs'), 'oe and vanillajs are mandatory');
  for (const result of results) {
    const cpu = result.cpu as Array<Record<string, unknown>>;
    assertEquals(cpu.length, CPU_BENCHMARKS.length, `${result.id} must cover the full CPU set`);
    for (const bench of cpu) {
      const samples = bench.samplesMs as number[];
      assert(samples.length >= CPU_ITERATIONS, `${result.id}/${bench.id} has all samples`);
      for (const key of ['medianMs', 'meanMs', 'minMs', 'maxMs']) {
        const value = bench[key] as number;
        // minMs may legitimately be 0: stock select1k re-clicks the already
        // selected row, which is a no-op frame for guarded implementations.
        const lowerBound = key === 'minMs' ? 0 : Number.MIN_VALUE;
        assert(
          Number.isFinite(value) && value >= lowerBound,
          `${result.id}/${bench.id}.${key} finite`,
        );
      }
      for (const sample of samples) {
        assert(Number.isFinite(sample) && sample >= 0, `${result.id}/${bench.id} sample finite`);
      }
    }
    const geomean = result.cpuGeomeanMs as number;
    assert(Number.isFinite(geomean) && geomean > 0);
    const pageErrors = result.pageErrors as string[];
    assertEquals(pageErrors, [], `${result.id} recorded page errors`);
  }
});
