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
 * - recorded evidence is identity-free, reproducible in shape, and written to
 *   local output rather than a committed baseline
 */
import { assert, assertEquals, assertMatch, assertStringIncludes } from '@std/assert';
import { compileElementProgram } from '../../packages/element/src/internal/compiler/semantic-core/compile.ts';
import type {
  ProgramElementNode,
  ProgramTreeNode,
} from '../../packages/element/src/internal/protocol/part-program.ts';
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
import {
  DEFAULT_EVIDENCE_PATH,
  findIdentityLeaks,
  redactEvidence,
  validateEvidence,
} from './harness/evidence.ts';

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

const IDENTITY = {
  hostname: 'bench-host',
  username: 'bench-user',
  homeDir: '/Users/bench-user',
  repoRoot: '/Users/bench-user/code/openelement',
  buildDir: '/var/folders/bench/openelement-jfb-abcd',
  tmpDir: '/var/folders/bench',
};

function validEvidence() {
  return {
    schemaVersion: 1,
    kind: 'jfb-local-baseline',
    issue: 1219,
    recordedAt: '2026-09-14T00:00:00.000Z',
    provenance: {
      openElement: { sha: 'a'.repeat(40), package: '@openelement/element workspace source' },
      jfb: { repo: 'krausest/js-framework-benchmark', commit: JFB_COMMIT },
      browser: { engine: 'chromium', version: '152.0.0', launchArgs: [] },
      toolchain: {
        platform: 'darwin',
        release: '25.0.0',
        arch: 'arm64',
        cpuModel: 'Apple M4',
        cpuCount: 10,
        totalMemoryBytes: 16_000_000_000,
        deno: { deno: '2.9.0' },
        node: 'v24.18.0',
        npm: '11.0.0',
      },
      iterations: { cpu: 10, cpuStock: 15, mem: 5 },
    },
    results: [{
      id: 'oe',
      stock: false,
      pageErrors: [],
      cpu: [{
        id: '01_run1k',
        samplesMs: [1.2, 1.1],
        medianMs: 1.1,
        meanMs: 1.15,
        minMs: 1.1,
        maxMs: 1.2,
      }],
      cpuGeomeanMs: 1.1,
      memory: [],
    }],
  };
}

Deno.test('jfb evidence redaction strips hostname, account, and absolute paths', () => {
  const dirty = {
    ...validEvidence(),
    note: `recorded on ${IDENTITY.hostname} by ${IDENTITY.username}`,
    build: { error: `${IDENTITY.buildDir}/oe-src/main.ts missing under ${IDENTITY.repoRoot}` },
  };
  assert(findIdentityLeaks(dirty, IDENTITY).length > 0, 'raw identity must be detectable');

  const clean = redactEvidence(dirty, IDENTITY);
  assertEquals(findIdentityLeaks(clean, IDENTITY), []);
  assertEquals(validateEvidence(clean, { jfbCommit: JFB_COMMIT }), []);
});

Deno.test('jfb evidence validation keeps the reproducible JFB commit and schema', () => {
  assertEquals(validateEvidence(validEvidence(), { jfbCommit: JFB_COMMIT }), []);
  const drifted = validEvidence();
  drifted.provenance.jfb.commit = 'b'.repeat(40);
  assert(validateEvidence(drifted, { jfbCommit: JFB_COMMIT }).length > 0);
  const broken = validEvidence();
  broken.results[0].cpu[0].samplesMs = [Number.NaN];
  assert(validateEvidence(broken, { jfbCommit: JFB_COMMIT }).length > 0);
  const missingVersion = validEvidence();
  missingVersion.provenance.toolchain.node = '';
  assert(validateEvidence(missingVersion, { jfbCommit: JFB_COMMIT }).length > 0);
});

Deno.test('jfb results default to local output, never a committed baseline', async () => {
  assertEquals(DEFAULT_EVIDENCE_PATH, '.artifacts/jfb-evidence.json');
  assert(DEFAULT_EVIDENCE_PATH.endsWith('.json'));
  const runner = await Deno.readTextFile(new URL('./harness/run.ts', import.meta.url));
  assertStringIncludes(runner, 'DEFAULT_EVIDENCE_PATH');
  assert(
    !runner.includes("'../evidence.json'"),
    'the runner must not write benchmarks/jfb/evidence.json by default',
  );
});
