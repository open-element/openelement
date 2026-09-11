/**
 * OE-specific microbenchmarks (issue #1219).
 *
 * These measure the canonical compiled path (one Part Program through the
 * real runtime and the real @preact/signals-core engine) against the
 * counting fake DOM in ./counting-dom.ts. The fake DOM
 * contributes no layout/paint cost, so these numbers isolate kernel/region
 * algorithmic behavior — the browser JFB harness owns layout-inclusive
 * numbers. SSR serialization uses the CANONICAL server serializer
 * (serializeCompiledProgram); the test-only serializeToHtml in runtime.ts
 * diverges for multi-field each Regions (serializes ival slots as
 * "[object Object]") and is deliberately not used — see the packet report.
 *
 * Diagnostics targeted (per the packet): Signal -> single Part latency,
 * attribute/property Part writes, keyed Region behavior at JFB scale, SSR
 * serialize / claim / fresh costs, and listener/subscription stability under
 * churn.
 *
 * Timings are recorded as evidence only; CI asserts deterministic DOM-op
 * counts, never durations (see micro.test.ts).
 */
import { compileElementProgram } from '../../packages/element/src/internal/compiler/semantic-core/compile.ts';
import {
  claimExistingDom,
  createFreshDom,
} from '../../packages/element/src/internal/compiled/runtime.ts';
import { serializeCompiledProgram } from '../../packages/element/src/internal/compiled/server/index.ts';
import { signal, type WritableSignal } from '../../packages/element/src/internal/signal/index.ts';
import { buildData } from '../jfb/src/oe/data.ts';
import { allocationCount, FDocument, type FElement, parseHtml, toHtml } from './counting-dom.ts';

const GRANULARITY_SOURCE = `
import { element, OpenElement, property } from '@openelement/element';

@element('oe-micro-granularity')
export class MicroGranularity extends OpenElement {
  @property({ reflect: false })
  label = 'ready';

  @property({ reflect: false })
  title = 'initial';

  @property({ reflect: false })
  count = 0;

  render() {
    return (
      <div>
        <h1>{this.label}</h1>
        <p title={this.title}>fixed</p>
        <input value={this.count} />
      </div>
    );
  }
}
`;

export interface TimedOp {
  id: string;
  /** Wall time for the whole op loop, milliseconds. */
  totalMs: number;
  /** Repetitions inside the op loop. */
  repetitions: number;
  /** totalMs / repetitions * 1000, microseconds per repetition. */
  perOpUs: number;
  /** Deterministic fake-DOM counters observed during the op. */
  counts: {
    allocations: number;
    textWrites: number;
    attrWrites: number;
    valueWrites: number;
    insertions: number;
    removals: number;
    listenerAdds: number;
  };
}

export interface MicroReport {
  schemaVersion: 1;
  kind: 'micro-baseline';
  issue: 1219;
  recordedAt: string;
  provenance: {
    openElementSha: string;
    deno: string;
    note: string;
  };
  granularity: {
    textPart: TimedOp;
    attrPart: TimedOp;
    propPart: TimedOp;
    engineFloor: TimedOp;
  };
  table1k: {
    serialize: TimedOp & { htmlBytes: number };
    fresh: TimedOp;
    claim: TimedOp & { claimToFreshRatio: number };
    replace1k: TimedOp;
    update10th: TimedOp;
    swap1k: TimedOp;
    remove1: TimedOp;
    append1k: TimedOp;
    clear1k: TimedOp;
  };
  stability: {
    churnCycles: number;
    churnRowsPerCycle: number;
    churnMs: number;
    retainedSubscriptions: number;
    retainedListeners: number;
    heapGrowthBytes: number;
  };
  compiler: {
    samplesMs: number[];
    medianMs: number;
    programBytes: number;
    generatedModuleBytes: number;
  };
}

interface AnyHost {
  signals: Record<string, WritableSignal<unknown>>;
  handlers: Record<string, (event: unknown) => void>;
}

/** Counting wrapper around the REAL engine signal: exact retention probe. */
class CountingSignal<T> {
  readonly inner: WritableSignal<T>;
  activeSubscriptions = 0;

  constructor(initial: T) {
    this.inner = signal(initial);
  }

  get value(): T {
    return this.inner.value;
  }

  set value(next: T) {
    this.inner.value = next;
  }

  subscribe(fn: (value: T) => void): () => void {
    this.activeSubscriptions++;
    const unsubscribe = this.inner.subscribe(fn);
    return () => {
      this.activeSubscriptions--;
      unsubscribe();
    };
  }
}

function countsOf(doc: FDocument): TimedOp['counts'] {
  return {
    allocations: allocationCount(doc.counts),
    textWrites: doc.counts.textWrites,
    attrWrites: doc.counts.attrWrites,
    valueWrites: doc.counts.valueWrites,
    insertions: doc.counts.insertions,
    removals: doc.counts.removals,
    listenerAdds: doc.counts.listenerAdds,
  };
}

function timed(id: string, repetitions: number, doc: FDocument, run: () => void): TimedOp {
  doc.resetCounts();
  const started = performance.now();
  run();
  const totalMs = performance.now() - started;
  return {
    id,
    totalMs: round3(totalMs),
    repetitions,
    perOpUs: round3((totalMs / repetitions) * 1000),
    counts: countsOf(doc),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function medianOf(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type Program = ReturnType<typeof compileElementProgram>['program'];

function runtimeArgs(program: Program, host: AnyHost, root: unknown) {
  return [
    program as unknown as Parameters<typeof createFreshDom>[0],
    host as unknown as Parameters<typeof createFreshDom>[1],
    root as Parameters<typeof createFreshDom>[2],
  ] as const;
}

function serializeProgram(program: Program, host: AnyHost): string {
  return serializeCompiledProgram(program, host, { mode: 'light' });
}

export interface MicroOptions {
  /** Repetitions for single-part write loops (default 2000). */
  partWriteReps?: number;
  /** Churn cycles for the stability probe (default 25). */
  churnCycles?: number;
  /** Compiler timing samples (default 25). */
  compilerSamples?: number;
  /** Recorded OE revision; the runner passes git HEAD. */
  openElementSha?: string;
}

export interface MicroSuiteResult {
  report: MicroReport;
  /** Deterministic facts consumed by micro.test.ts assertions. */
  facts: {
    claimAllocations: number;
    update10thTextWrites: number;
    swapInsertions: number;
    removeRemovals: number;
    clearRemovals: number;
    textPartWrites: number;
    attrPartWrites: number;
    propPartWrites: number;
    retainedSubscriptions: number;
    retainedListeners: number;
    /** Row order after swap, first three ids — proves keyed move correctness. */
    swapOrderProbe: [string, string, string];
  };
}

export function runMicroSuite(options: MicroOptions = {}): MicroSuiteResult {
  const partWriteReps = options.partWriteReps ?? 2000;
  const churnCycles = options.churnCycles ?? 25;
  const compilerSamples = options.compilerSamples ?? 25;

  // ── Compiler cost + artifacts (JFB table component) ─────────────
  const tableSource = Deno.readTextFileSync(
    new URL('../jfb/src/oe/jfb-table.tsx', import.meta.url),
  );
  const compileOnce = () =>
    compileElementProgram(tableSource, '/benchmarks/jfb/src/oe/jfb-table.tsx');
  const compileSampleValues: number[] = [];
  let compiled = compileOnce();
  for (let i = 0; i < compilerSamples; i++) {
    const started = performance.now();
    compiled = compileOnce();
    compileSampleValues.push(round3(performance.now() - started));
  }
  const tableProgram = compiled.program;
  const encoder = new TextEncoder();

  // ── Signal -> single Part granularity ────────────────────────────
  const granularityProgram = compileElementProgram(GRANULARITY_SOURCE, '/bench/micro.tsx').program;
  const gDoc = new FDocument();
  const gRoot = gDoc.createElement('host');
  const gHost: AnyHost = {
    signals: {
      label: signal('ready'),
      title: signal('initial'),
      count: signal(0),
    },
    handlers: {},
  };
  const gInstance = createFreshDom(...runtimeArgs(granularityProgram, gHost, gRoot));

  const textPart = timed('signal->text-part', partWriteReps, gDoc, () => {
    for (let i = 0; i < partWriteReps; i++) gHost.signals.label.value = `label-${i}`;
  });
  const attrPart = timed('signal->attr-part', partWriteReps, gDoc, () => {
    for (let i = 0; i < partWriteReps; i++) gHost.signals.title.value = `title-${i}`;
  });
  const propPart = timed('signal->prop-part', partWriteReps, gDoc, () => {
    for (let i = 0; i < partWriteReps; i++) gHost.signals.count.value = i;
  });
  const floorSignal = signal(0);
  const engineFloor = timed('engine-floor-no-part', partWriteReps, gDoc, () => {
    for (let i = 0; i < partWriteReps; i++) floorSignal.value = i;
  });
  gInstance.dispose();

  // ── Keyed Region + SSR claim at JFB scale (1,000 rows) ───────────
  const makeTableHost = (rows: ReturnType<typeof buildData>): AnyHost => ({
    signals: { rows: signal(rows) },
    handlers: {
      run: () => undefined,
      runLots: () => undefined,
      add: () => undefined,
      update: () => undefined,
      clear: () => undefined,
      swapRows: () => undefined,
      handleTableClick: () => undefined,
    },
  });

  // One shared dataset: SSR output, fresh creation and claim all describe the
  // same rows so the three paths are directly comparable.
  const sharedRows = buildData(1000);
  const ssrHost = makeTableHost(sharedRows);
  let serializedHostHtml = '';
  const serialize = {
    ...timed('serialize-1k', 1, new FDocument(), () => {
      serializedHostHtml = serializeProgram(tableProgram, ssrHost);
    }),
    htmlBytes: encoder.encode(serializedHostHtml).byteLength,
  };
  // The canonical serializer wraps content in the host tag; the claim/fresh
  // paths operate on the root's inner content.
  const serializedHtml = serializedHostHtml
    .replace(/^<jfb-oe-table data-oe-light>/, '')
    .replace(/<\/jfb-oe-table>$/, '');
  if (serializedHtml === serializedHostHtml) {
    throw new Error('[micro] canonical serializer output shape changed');
  }

  const freshDoc = new FDocument();
  const freshRoot = freshDoc.createElement('host');
  const freshHost = makeTableHost(sharedRows.map((row) => ({ ...row })));
  const fresh = timed('fresh-1k', 1, freshDoc, () => {
    createFreshDom(...runtimeArgs(tableProgram, freshHost, freshRoot));
  });
  const freshHtml = toHtml(freshRoot);
  // Harness normalization for one known-benign difference: SSR omits falsy
  // item attributes (bare `class`), fresh creation writes `class=""`. Both
  // mean an empty class list; claim treats empty as absent.
  const normalizeEmptyClass = (html: string): string =>
    html.replaceAll(' class=""', '').replaceAll(' class>', '>');
  if (
    normalizeEmptyClass(freshHtml) !== `<host>${normalizeEmptyClass(serializedHtml)}</host>`
  ) {
    throw new Error('[micro] fresh DOM diverges from SSR output');
  }

  // Claim: parse cost belongs to the harness, not the claim op.
  const claimDoc = new FDocument();
  const claimRoot = parseHtml(claimDoc, serializedHtml);
  const claimHost = makeTableHost(sharedRows.map((row) => ({ ...row })));
  const claim = {
    ...timed('claim-1k', 1, claimDoc, () => {
      claimExistingDom(...runtimeArgs(tableProgram, claimHost, claimRoot));
    }),
    claimToFreshRatio: 0,
  };
  claim.claimToFreshRatio = round3(claim.totalMs / Math.max(fresh.totalMs, 0.001));

  // Region ops run against the fresh instance (freshHost owns its signal).
  const rowsSignal = freshHost.signals.rows;
  const currentRows = () => rowsSignal.value as ReturnType<typeof buildData>;

  const replace1k = timed('region-replace-1k', 1, freshDoc, () => {
    rowsSignal.value = buildData(1000);
  });
  const update10th = timed('region-update-10th', 1, freshDoc, () => {
    const data = currentRows().slice();
    for (let i = 0; i < data.length; i += 10) {
      const row = data[i];
      data[i] = { id: row.id, label: `${row.label} !!!`, cls: row.cls };
    }
    rowsSignal.value = data;
  });
  const swap1k = timed('region-swap-1k', 1, freshDoc, () => {
    const data = currentRows().slice();
    const tmp = data[1];
    data[1] = data[998];
    data[998] = tmp;
    rowsSignal.value = data;
  });
  const rowIdsInDomOrder = (): string[] => {
    const container = freshRoot.childNodes[0] as FElement;
    const table = container.childNodes.find(
      (node) => (node as FElement).tagName === 'TABLE',
    ) as FElement;
    const body = table.childNodes.find(
      (node) => (node as FElement).tagName === 'TBODY',
    ) as FElement;
    return body.childNodes
      .filter((node): node is FElement => (node as FElement).tagName === 'TR')
      .map((row) => row.getAttribute('data-id')!);
  };
  const domOrder = rowIdsInDomOrder();
  const modelOrder = currentRows().map((row) => String(row.id));
  if (domOrder.join('|') !== modelOrder.join('|')) {
    throw new Error('[micro] keyed Region DOM order diverges from model after swap');
  }
  const swapOrderProbe: [string, string, string] = [domOrder[0], domOrder[1], domOrder[2]];

  const remove1 = timed('region-remove-1', 1, freshDoc, () => {
    const data = currentRows();
    rowsSignal.value = data.slice(1);
  });
  const append1k = timed('region-append-1k', 1, freshDoc, () => {
    rowsSignal.value = currentRows().concat(buildData(1000));
  });
  const clear1k = timed('region-clear', 1, freshDoc, () => {
    rowsSignal.value = [];
  });

  // ── Churn stability: repeated create+dispose leaves nothing behind ──
  const heapBefore = Deno.memoryUsage().heapUsed;
  const churnStarted = performance.now();
  let retainedSubscriptions = 0;
  let retainedListeners = 0;
  const churnRows = 200;
  for (let cycle = 0; cycle < churnCycles; cycle++) {
    const rows = new CountingSignal(buildData(churnRows));
    const host: AnyHost = {
      signals: { rows: rows as unknown as WritableSignal<unknown> },
      handlers: {
        run: () => undefined,
        runLots: () => undefined,
        add: () => undefined,
        update: () => undefined,
        clear: () => undefined,
        swapRows: () => undefined,
        handleTableClick: () => undefined,
      },
    };
    const doc = new FDocument();
    const root = doc.createElement('host');
    const instance = createFreshDom(...runtimeArgs(tableProgram, host, root));
    instance.dispose();
    retainedSubscriptions = Math.max(retainedSubscriptions, rows.activeSubscriptions);
    retainedListeners = Math.max(retainedListeners, root.listenerCount());
  }
  const churnMs = performance.now() - churnStarted;
  const heapAfter = Deno.memoryUsage().heapUsed;

  const report: MicroReport = {
    schemaVersion: 1,
    kind: 'micro-baseline',
    issue: 1219,
    recordedAt: new Date().toISOString(),
    provenance: {
      openElementSha: options.openElementSha ?? 'unknown',
      deno: Deno.version.deno,
      note: 'fake-DOM kernel/region numbers isolate algorithmic behavior (no layout/paint); ' +
        'browser-inclusive numbers live in benchmarks/jfb/evidence.json',
    },
    granularity: { textPart, attrPart, propPart, engineFloor },
    table1k: {
      serialize,
      fresh,
      claim,
      replace1k,
      update10th,
      swap1k,
      remove1,
      append1k,
      clear1k,
    },
    stability: {
      churnCycles,
      churnRowsPerCycle: churnRows,
      churnMs: round3(churnMs),
      retainedSubscriptions,
      retainedListeners,
      heapGrowthBytes: Math.max(0, heapAfter - heapBefore),
    },
    compiler: {
      samplesMs: compileSampleValues,
      medianMs: round3(medianOf(compileSampleValues)),
      programBytes: encoder.encode(JSON.stringify(tableProgram)).byteLength,
      generatedModuleBytes: encoder.encode(compiled.code).byteLength,
    },
  };

  return {
    report,
    facts: {
      claimAllocations: claim.counts.allocations,
      update10thTextWrites: update10th.counts.textWrites,
      swapInsertions: swap1k.counts.insertions,
      removeRemovals: remove1.counts.removals,
      clearRemovals: clear1k.counts.removals,
      textPartWrites: textPart.counts.textWrites,
      attrPartWrites: attrPart.counts.attrWrites,
      propPartWrites: propPart.counts.valueWrites,
      retainedSubscriptions,
      retainedListeners,
      swapOrderProbe,
    },
  };
}

if (import.meta.main) {
  const sha = await (async () => {
    const result = await new Deno.Command('git', {
      args: ['rev-parse', 'HEAD'],
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    return new TextDecoder().decode(result.stdout).trim();
  })();
  const { report } = runMicroSuite({ openElementSha: sha });
  if (Deno.args.includes('--write')) {
    const out = new URL('./micro-evidence.json', import.meta.url).pathname;
    await Deno.writeTextFile(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${out}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}
