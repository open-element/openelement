/**
 * Shared specification for the local js-framework-benchmark (JFB) harness
 * (issue #1219). This module is dependency-free: it is imported by the runner
 * (Deno), the self-check tests, and serialized into the evidence file. It
 * encodes the stock JFB webdriver-ts "afterframe" driver semantics copied from
 * JFB commit pinned in fetch-stock.ts:
 *
 * - timing: t0 = performance.now(); element.click(); resolve after one
 *   animation frame + one MessageChannel task (verbatim afterframe semantics,
 *   MIT-licensed helper by Andrew Ingram reimplemented inline below)
 * - warmup counts and DOM verification invariants per benchmark, matching
 *   webdriver-ts/src/benchmarksWebdriverAfterframe.ts
 * - the CPU benchmark set 01-09 plus memory probes 21/22/25 and one
 *   OE-diagnostic extension (26 run-10k memory), clearly labeled
 */

/** Verbatim afterframe helper semantics (https://github.com/andrewiggins/afterframe, MIT). */
export const AFTERFRAME_SOURCE = `
let callbacks = [];
let channel = new MessageChannel();
let postMessage = (function() { this.postMessage(undefined); }).bind(channel.port2);
channel.port1.onmessage = () => {
  let toFlush = callbacks;
  callbacks = [];
  let time = performance.now();
  for (let i = 0; i < toFlush.length; i++) { toFlush[i](time); }
};
channel = null;
window.afterFrame = function(callback) {
  if (callbacks.push(callback) === 1) { requestAnimationFrame(postMessage); }
};
`;

export type CpuBenchmarkId =
  | '01_run1k'
  | '02_replace1k'
  | '03_update10th'
  | '04_select1k'
  | '05_swap1k'
  | '06_remove1k'
  | '07_create10k'
  | '08_append1k'
  | '09_clear1k';

export type MemBenchmarkId =
  | '21_ready-memory'
  | '22_run1k-memory'
  | '25_run-clear-memory'
  | '26_run10k-memory';

export interface ClickTarget {
  /** Button id inside the jumbotron, or a row target. */
  kind: 'button' | 'row';
  /** Button id when kind === 'button'. */
  id?: 'run' | 'runlots' | 'add' | 'update' | 'clear' | 'swaprows';
  /** 1-based row index and cell target when kind === 'row' (mirrors the stock XPaths). */
  rowIndex?: number;
  cell?: 'label' | 'remove';
}

export interface Verification {
  /** Human description plus machine check executed in page. */
  description: string;
  check: RowCheck;
}

export type RowCheck =
  | { kind: 'rowIdText'; rowIndex: number; expected: string }
  | { kind: 'rowLabelContains'; rowIndex: number; expected: string }
  | { kind: 'rowClassContains'; rowIndex: number; expected: string }
  | { kind: 'rowCount'; expected: number }
  | { kind: 'rowExists'; rowIndex: number };

export interface CpuBenchmarkSpec {
  id: CpuBenchmarkId;
  label: string;
  stockId: string;
  /** Number of unmeasured warmup executions of the init sequence. */
  warmupCount: number;
  /** Measured sub-runs per iteration (stock additionalNumberOfRuns; 10 for select). */
  subRuns: number;
  /** Init steps run once per measured iteration before the measured click. */
  init: ClickTarget[];
  /** Extra verification steps interleaved into init (after the step at the same index). */
  initVerify: Array<{ afterStep: number; check: RowCheck }>;
  /** The measured click. */
  measured: ClickTarget;
  /** Verification after the measured click. */
  verify: RowCheck[];
}

const run: ClickTarget = { kind: 'button', id: 'run' };
const runLots: ClickTarget = { kind: 'button', id: 'runlots' };
const add: ClickTarget = { kind: 'button', id: 'add' };
const update: ClickTarget = { kind: 'button', id: 'update' };
const clear: ClickTarget = { kind: 'button', id: 'clear' };
const swapRows: ClickTarget = { kind: 'button', id: 'swaprows' };

export const CPU_BENCHMARKS: CpuBenchmarkSpec[] = [
  {
    id: '01_run1k',
    label: 'create rows',
    stockId: '01_run1k',
    warmupCount: 5,
    subRuns: 1,
    init: [run, clear, run, clear, run, clear, run, clear, run, clear],
    initVerify: [
      { afterStep: 0, check: { kind: 'rowIdText', rowIndex: 1, expected: '1' } },
      { afterStep: 2, check: { kind: 'rowIdText', rowIndex: 1, expected: '1001' } },
      { afterStep: 8, check: { kind: 'rowIdText', rowIndex: 1, expected: '4001' } },
      { afterStep: 9, check: { kind: 'rowCount', expected: 0 } },
    ],
    measured: run,
    verify: [
      { kind: 'rowIdText', rowIndex: 1, expected: '5001' },
      {
        kind: 'rowCount',
        expected: 1000,
      },
    ],
  },
  {
    id: '02_replace1k',
    label: 'replace all rows',
    stockId: '02_replace1k',
    warmupCount: 5,
    subRuns: 1,
    init: [run, run, run, run, run],
    initVerify: [
      { afterStep: 0, check: { kind: 'rowIdText', rowIndex: 1, expected: '1' } },
      { afterStep: 4, check: { kind: 'rowIdText', rowIndex: 1, expected: '4001' } },
    ],
    measured: run,
    verify: [
      { kind: 'rowIdText', rowIndex: 1, expected: '5001' },
      {
        kind: 'rowCount',
        expected: 1000,
      },
    ],
  },
  {
    id: '03_update10th',
    label: 'partial update',
    stockId: '03_update10th1k_x16',
    warmupCount: 3,
    subRuns: 1,
    init: [run, update, update, update],
    initVerify: [
      { afterStep: 0, check: { kind: 'rowExists', rowIndex: 1000 } },
      { afterStep: 1, check: { kind: 'rowLabelContains', rowIndex: 991, expected: ' !!!' } },
      {
        afterStep: 3,
        check: { kind: 'rowLabelContains', rowIndex: 991, expected: ' !!! !!! !!!' },
      },
    ],
    measured: update,
    verify: [{ kind: 'rowLabelContains', rowIndex: 991, expected: ' !!! !!! !!! !!!' }],
  },
  {
    id: '04_select1k',
    label: 'select row',
    stockId: '04_select1k',
    warmupCount: 1,
    subRuns: 10,
    init: [run],
    initVerify: [{ afterStep: 0, check: { kind: 'rowExists', rowIndex: 1000 } }],
    measured: { kind: 'row', rowIndex: 2, cell: 'label' },
    verify: [{ kind: 'rowClassContains', rowIndex: 2, expected: 'danger' }],
  },
  {
    id: '05_swap1k',
    label: 'swap rows',
    stockId: '05_swap1k',
    warmupCount: 5,
    subRuns: 1,
    // Stock init clicks swaprows warmupCount+1 = 6 times with alternating checks.
    init: [run, swapRows, swapRows, swapRows, swapRows, swapRows, swapRows],
    initVerify: [
      { afterStep: 0, check: { kind: 'rowIdText', rowIndex: 1, expected: '1' } },
      { afterStep: 1, check: { kind: 'rowIdText', rowIndex: 999, expected: '2' } },
      { afterStep: 2, check: { kind: 'rowIdText', rowIndex: 999, expected: '999' } },
      { afterStep: 6, check: { kind: 'rowIdText', rowIndex: 999, expected: '999' } },
    ],
    measured: swapRows,
    verify: [
      { kind: 'rowIdText', rowIndex: 999, expected: '2' },
      { kind: 'rowIdText', rowIndex: 2, expected: '999' },
    ],
  },
  {
    id: '06_remove1k',
    label: 'remove row',
    stockId: '06_remove-one-1k',
    warmupCount: 5,
    subRuns: 1,
    // Stock init (rowsToSkip=4): remove rows 9,8,7,6,5 then row 6 (id 11).
    init: [
      run,
      { kind: 'row', rowIndex: 9, cell: 'remove' },
      { kind: 'row', rowIndex: 8, cell: 'remove' },
      { kind: 'row', rowIndex: 7, cell: 'remove' },
      { kind: 'row', rowIndex: 6, cell: 'remove' },
      { kind: 'row', rowIndex: 5, cell: 'remove' },
      { kind: 'row', rowIndex: 6, cell: 'remove' },
    ],
    initVerify: [
      { afterStep: 0, check: { kind: 'rowIdText', rowIndex: 1000, expected: '1000' } },
      { afterStep: 1, check: { kind: 'rowIdText', rowIndex: 9, expected: '10' } },
      { afterStep: 5, check: { kind: 'rowIdText', rowIndex: 5, expected: '10' } },
      { afterStep: 5, check: { kind: 'rowIdText', rowIndex: 4, expected: '4' } },
      { afterStep: 6, check: { kind: 'rowIdText', rowIndex: 6, expected: '12' } },
    ],
    measured: { kind: 'row', rowIndex: 4, cell: 'remove' },
    verify: [
      { kind: 'rowIdText', rowIndex: 4, expected: '10' },
      {
        kind: 'rowCount',
        expected: 993,
      },
    ],
  },
  {
    id: '07_create10k',
    label: 'create many rows',
    stockId: '07_create10k',
    warmupCount: 5,
    subRuns: 1,
    init: [run, clear, run, clear, run, clear, run, clear, run, clear],
    initVerify: [
      { afterStep: 0, check: { kind: 'rowIdText', rowIndex: 1, expected: '1' } },
      { afterStep: 9, check: { kind: 'rowCount', expected: 0 } },
    ],
    measured: runLots,
    verify: [
      { kind: 'rowExists', rowIndex: 10000 },
      { kind: 'rowCount', expected: 10000 },
    ],
  },
  {
    id: '08_append1k',
    label: 'append rows to large table',
    stockId: '08_create1k-after10k',
    warmupCount: 5,
    subRuns: 1,
    init: [run, clear, run, clear, run, clear, run, clear, run, clear, run],
    initVerify: [
      { afterStep: 0, check: { kind: 'rowIdText', rowIndex: 1, expected: '1' } },
      { afterStep: 10, check: { kind: 'rowExists', rowIndex: 1000 } },
    ],
    measured: add,
    verify: [
      { kind: 'rowExists', rowIndex: 2000 },
      { kind: 'rowCount', expected: 2000 },
    ],
  },
  {
    id: '09_clear1k',
    label: 'clear rows',
    stockId: '09_clear1k',
    warmupCount: 5,
    subRuns: 1,
    init: [run, clear, run, clear, run, clear, run, clear, run, clear, run],
    initVerify: [
      { afterStep: 1, check: { kind: 'rowCount', expected: 0 } },
      { afterStep: 10, check: { kind: 'rowExists', rowIndex: 1000 } },
    ],
    measured: clear,
    verify: [{ kind: 'rowCount', expected: 0 }],
  },
];

export interface MemBenchmarkSpec {
  id: MemBenchmarkId;
  label: string;
  stock: boolean;
  /** Ops executed before the forced GC + heap read. */
  ops: ClickTarget[];
}

export const MEM_BENCHMARKS: MemBenchmarkSpec[] = [
  { id: '21_ready-memory', label: 'ready memory', stock: true, ops: [] },
  { id: '22_run1k-memory', label: 'run memory', stock: true, ops: [run] },
  {
    id: '25_run-clear-memory',
    label: 'run/clear memory x5',
    stock: true,
    ops: [run, clear, run, clear, run, clear, run, clear, run, clear],
  },
  // OE diagnostic extension (stock JFB comments this one out): growth under a
  // 10k table directly addresses the packet's leak/growth question.
  { id: '26_run10k-memory', label: 'run 10k memory (OE extension)', stock: false, ops: [runLots] },
];

/** Measured iterations per CPU benchmark. Stock JFB uses 15; recorded deviation. */
export const CPU_ITERATIONS = 10;
/** Stock JFB value, recorded for provenance. */
export const CPU_ITERATIONS_STOCK = 15;
/** Memory probes run once per implementation (stock NUM_ITERATIONS_FOR_BENCHMARK_MEM = 1). */
export const MEM_ITERATIONS = 1;

export function median(samples: readonly number[]): number {
  if (samples.length === 0) throw new Error('median of empty sample set');
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(samples: readonly number[]): number {
  if (samples.length === 0) throw new Error('mean of empty sample set');
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

/** Geometric mean across benchmark medians (JFB's aggregate shape). */
export function geometricMean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('geometric mean of empty value set');
  for (const value of values) {
    if (!(value > 0)) throw new Error('geometric mean requires positive values');
  }
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
