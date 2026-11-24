/**
 * OE-specific microbenchmarks (issue #1219).
 *
 * These measure the canonical compiled path on the lane that SHIPS — the
 * generated element lane — against the counting fake DOM in
 * ./counting-dom.ts. The fake DOM contributes no layout/paint cost, so these
 * numbers isolate the generated mount/claim/list code and the real
 * @preact/signals-core engine; the upstream js-framework-benchmark lane (on the
 * fork) owns layout-inclusive numbers.
 *
 * WHAT CHANGED AND WHY (Alpha16 closeout). This suite used to call
 * `compileElementProgram` (the class lane) and feed its Part Program to the
 * interpreter endpoints `createFreshDom` / `hydrateExistingDom` /
 * `serializeCompiledProgram`. That lane was deleted, so the suite now compiles
 * the same fixtures with `compileGeneratedElementIfAdmitted` and drives the
 * emitted module's own mount/claim/SSR functions through the shipped recipe
 * primitives (`insertRecipe`, `claimRecipe`). The subject — compiler throughput
 * and the cost of one 1 000-row keyed list through mount, claim, and the block
 * ops — is unchanged.
 *
 * The phases, and what each one now measures:
 *
 * - compiler: compile the keyed-list fixture through the generated lane and
 *   record wall time plus the emitted module's byte size. The class lane also
 *   reported `programBytes` (the JSON size of the interpreted Part Program);
 *   the generated lane has NO interpreted program — the emitted module IS the
 *   artifact — so that field is dropped rather than reported as a second copy
 *   of `generatedModuleBytes`.
 * - granularity: one signal write -> one DOM write. The class lane counted
 *   Part writes; the generated lane counts the leaf binding writes they became
 *   (text slot, attribute, property), plus the same engine floor with no
 *   consumer.
 * - table1k: the 1 000-row keyed list through exactly the shipped paths:
 *   the generated `<Name>__ssr` producer (the suite's serialize phase; its
 *   bytes are the content the claim adopts), a fresh `insertRecipe` mount, a
 *   `claimRecipe` over the server bytes (parse cost belongs to the harness,
 *   not the op), and the block ops (replace, update every 10th row, swap two
 *   distant rows, remove one, append 1 000, clear) driven by writing the
 *   instance's own `rows` signal.
 * - stability: repeated create+mount+dispose cycles must leave neither
 *   subscriptions nor listeners behind. The generated module creates its own
 *   signals, so the loader substitutes a counting wrapper around the REAL
 *   engine signal for this probe only (the same measurement the class lane
 *   performed with its CountingSignal host wrapper).
 *
 * DELIBERATE MEASUREMENT DIFFERENCES FROM THE CLASS LANE (recorded here so a
 * reader does not mistake them for harness bugs):
 *
 * 1. The fixture's rows are `<li>` inside `<ul>`, not `<tr>` inside `<tbody>`.
 *    A keyed list is claimable and SSR-producible only in a flow parser
 *    context; the generated lane's list slice excludes table contexts, so a
 *    table-shaped list would emit no claim/SSR producer and this suite would
 *    fail loudly (missing `__ssr`/`claim`) rather than measure those phases.
 *    The row's DOM shape is preserved.
 * 2. `update10th` rewrites every matched row's slots on the generated lane.
 *    The leaf entry refresh is forced on reuse (`update(next)` calls each slot
 *    refresh), because the mapper parameter is rebound — there is no per-slot
 *    equality guard like the class lane's Part equality check. The reported
 *    `textWrites` is therefore O(rows), not O(changed rows).
 * 3. `swap1k` re-inserts the displaced node range (the placement walk moves
 *    every node whose `nextSibling` is not the reference), so
 *    `insertions` scales with the distance between the swapped rows rather
 *    than with the two moved entries.
 * 4. `remove1` removes the entry's two nodes (its key comment plus its `<li>`),
 *    so `removals` is 2 per removed row.
 *
 * These are facts about the shipped lane, not weakened assertions. Note for
 * the self-check owner: micro.test.ts still pins two CLASS-lane counts
 * (`update10thTextWrites === 100`, `removeRemovals === 1`); those expectations
 * are the old Part equality guard and the old one-node row, so they must be
 * re-pinned to the generated-lane facts measured here (text writes = rows x 2
 * text slots, removals = 2 nodes per removed row). This file does not own the
 * test, and it has not been edited to make the old numbers pass.
 *
 * Timings are recorded as evidence only; CI asserts deterministic DOM-op
 * counts, never durations (see micro.test.ts).
 *
 * Internal benchmark by design: this suite imports
 * packages/element/src/internal/** (the leaf runtime, the recipe primitives,
 * the signal engine) to measure the shipped path, which the public surface
 * deliberately does not export. It must stay benchmark-local — shipped packages
 * and product code never import from here. The root `bench` script (vitest
 * `--project benchmarks`) exercises it through the deterministic self-checks in
 * micro.test.ts; standalone evidence runs use the import.meta.main entry below.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
import { compileGeneratedElementIfAdmitted } from '../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { LifetimeScope } from '../../packages/element/src/internal/compiled/lifetime-scope.ts';
import * as leafRuntime from '../../packages/element/src/internal/compiled/leaf-runtime.ts';
import {
  claimRecipe,
  insertRecipe,
  type Projection,
  type Recipe,
} from '../../packages/element/src/internal/compiled/runtime/recipe.ts';
import {
  signal as engineSignal,
  type WritableSignal,
} from '../../packages/element/src/internal/signal/index.ts';
import {
  FComment,
  FDocument,
  FElement,
  allocationCount,
  parseHtml,
  toHtml,
  type FNode,
} from './counting-dom.ts';
import { buildData, type BenchRow } from './row-data.ts';

/**
 * Platform facts the generated claim reads but the counting fake DOM never
 * needed while only the class-lane interpreter consumed it.
 *
 * WHY THIS BLOCK EXISTS. The leaf claim walks a real DOM by platform API:
 * `parent.firstChild` / `node.nextSibling`, `element.namespaceURI` and
 * `localName`, the `Comment.nodeValue` marker text, and an `attributes`
 * NamedNodeMap (`length` + `item(i)`) for the static-attribute seed check. The
 * counting DOM models `childNodes` + a `Map` of attributes, which the class-lane
 * kernel read instead. These definitions are additive platform mirrors, not a
 * second renderer: every getter derives from the data the fake DOM already
 * holds, and the attribute map delegates every mutation to itself so the
 * existing counters keep firing exactly as before.
 *
 * This lives in the benchmark rather than in counting-dom.ts because the
 * benchmark file owns the generated-lane harness (see the file list for this
 * change); folding it into the shared fake DOM would change a file other
 * harnesses depend on.
 */
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** The `Element.attributes` surface the claim's seed check reads. */
class FAttributeMap extends Map<string, string> {
  get length(): number {
    return this.size;
  }

  item(index: number): { readonly name: string; readonly value: string } | null {
    let ordinal = 0;
    for (const [name, value] of this) {
      if (ordinal++ === index) return { name, value };
    }
    return null;
  }
}

Object.defineProperties(FElement.prototype, {
  firstChild: {
    get(this: FElement): FNode | null {
      return this.childNodes[0] ?? null;
    },
    configurable: true,
  },
  namespaceURI: {
    get(): string {
      return HTML_NAMESPACE;
    },
    configurable: true,
  },
  localName: {
    get(this: FElement): string {
      return this.tagName.toLowerCase();
    },
    configurable: true,
  },
  nodeName: {
    get(this: FElement): string {
      return this.tagName;
    },
    configurable: true,
  },
});
Object.defineProperty(FComment.prototype, 'nodeValue', {
  get(this: FComment): string {
    return this.data;
  },
  configurable: true,
});

/**
 * Re-shape one parsed tree for the generated claim: element attribute maps get
 * the NamedNodeMap read surface (the write methods stay the Map's, so the
 * counters are untouched). Comments and text need no per-node work: their
 * platform reads are the prototype getters above.
 */
function alignCountingTreeForClaim(node: FNode): void {
  if (!(node instanceof FElement)) return;
  if (!(node.attributes instanceof FAttributeMap)) {
    Object.defineProperty(node, 'attributes', {
      value: new FAttributeMap(node.attributes),
      configurable: true,
      writable: false,
    });
  }
  for (const child of node.childNodes) alignCountingTreeForClaim(child);
}

/**
 * The granularity fixture: one signal per binding channel, no props.
 *
 * The class lane's fixture declared three `@property` rows and counted the Part
 * writes those properties drove. The generated lane equivalent is three local
 * signals owned by the element's retained setup (the emitted root instance
 * returns them), so the benchmark can still write them one at a time and count
 * exactly one DOM write per write.
 */
const GRANULARITY_SOURCE = `
import { defineIslandConfig } from '@openelement/router';
import { signal } from '@openelement/element';

export const openElement = defineIslandConfig({ root: 'light' });

function MicroGranularity() {
  const label = signal('ready');
  const title = signal('initial');
  const count = signal(0);
  return (
    <div>
      <h1>{label.value}</h1>
      <p title={title.value}>fixed</p>
      <input value={count.value} />
    </div>
  );
}

export default MicroGranularity;
`;

/** Where the granularity fixture is compiled from (diagnostics + source map). */
const GRANULARITY_ID = '/benchmarks/micro/granularity.tsx';
/** Where the keyed-list fixture is compiled from. */
const TABLE_ID = '/benchmarks/micro/oe-table.tsx';
/** The site tag the benchmark's fixture is registered under in a real build. */
const TABLE_TAG = 'oe-bench-table';
const GRANULARITY_TAG = 'oe-micro-granularity';

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
    /** Host runtime version — Node (the only supported host). */
    node: string;
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
    /**
     * Byte size of the emitted generated module — the compiled artifact the
     * browser loads. There is no separate interpreted program on this lane, so
     * the class lane's `programBytes` has no counterpart here (see the module
     * comment).
     */
    generatedModuleBytes: number;
  };
}

/** The host record the emitted recipe reads: props in, retained bindings out. */
interface GeneratedHost {
  props: Record<string, unknown>;
  bindings: Record<string, unknown> | null;
}

/** One evaluated generated module: only the surfaces the benchmark drives. */
interface LoadedFixture {
  readonly rootInstance: (
    owner: LifetimeScope,
    host: GeneratedHost,
  ) => Readonly<Record<string, unknown>>;
  readonly createRecipe: (owner: LifetimeScope, host: GeneratedHost) => Recipe<unknown>;
  /** `<Component>__ssr(props, host)`; absent when the shape emits no producer. */
  readonly ssr: (
    props: Record<string, unknown>,
    host: { bindings: Record<string, unknown> },
  ) => string;
}

/** Counting wrapper around the REAL engine signal: exact retention probe. */
class CountingSignal<T> {
  readonly inner: WritableSignal<T>;
  activeSubscriptions = 0;

  constructor(initial: T) {
    this.inner = engineSignal(initial);
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

/**
 * Evaluate the emitted module with the leaf runtime as its import surface.
 *
 * WHY `new Function`. The emitted bytes are the compiled artifact; importing
 * them as a real module would need a bundler or a temp file. The narrowest
 * loader that keeps the REAL emitted text (not a hand-written lookalike) is a
 * function whose parameters are the module's own imported symbols. The one
 * shell symbol (the CE-tail class factory) is a marker here: the benchmark
 * drives the emitted mount/claim/SSR functions directly and never registers a
 * custom element.
 *
 * `overrides` exists for the stability probe: replacing the leaf `signal`
 * symbol with the counting wrapper is how the suite observes a subscription
 * count on signals the generated module creates itself.
 */
function loadFixture(
  compiledCode: string,
  component: string,
  overrides: Readonly<Record<string, unknown>> = {},
): LoadedFixture {
  const importLines = compiledCode.split('\n').filter((line) => line.startsWith('import {'));
  const names: string[] = [];
  for (const importLine of importLines) {
    names.push(
      ...importLine
        .slice(importLine.indexOf('{') + 1, importLine.indexOf('}'))
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    );
  }
  const body = compiledCode
    .replace(/^import \{[^}]*\} from "[^"]+";$/gm, '')
    .replace(/^export default .*$/gm, '')
    .replace(/^export \{[^}]*\};$/gm, '')
    .replace(/^export /gm, '');
  const factory = new Function(
    ...names,
    `${body}\n; return { rootInstance: __oe_rootInstance, createRecipe: create${component}Recipe, ` +
      `ssr: ${component}__ssr };`,
  ) as (...values: unknown[]) => LoadedFixture;
  const values = names.map((name) => {
    if (name in overrides) return overrides[name];
    if (name === 'createGeneratedElementClass') return (descriptor: unknown) => descriptor;
    const value = (leafRuntime as unknown as Record<string, unknown>)[name];
    if (value === undefined) {
      throw new Error(
        `[micro] the emitted module imports "${name}", which the benchmark cannot provide`,
      );
    }
    return value;
  });
  return factory(...values);
}

/** One compiled generated fixture plus its evaluated module. */
interface CompiledFixture {
  readonly compiledBytes: number;
  readonly load: (overrides?: Readonly<Record<string, unknown>>) => LoadedFixture;
}

function compileFixture(source: string, id: string, tag: string): CompiledFixture {
  const compiled = compileGeneratedElementIfAdmitted(source, id, {
    site: { tag },
    authoredSource: source,
  });
  // A null result means the generated lane declined the module, which would
  // mean the benchmark's own fixture no longer belongs to the shipped lane —
  // a coded harness failure, never a skipped phase.
  if (compiled === null) {
    throw new Error(`[micro] the generated lane declined ${id}`);
  }
  return {
    compiledBytes: new TextEncoder().encode(compiled.code).byteLength,
    load: (overrides = {}) => loadFixture(compiled.code, compiled.component, overrides),
  };
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

/** The `rows`-shaped signal the emitted root setup returns in its record. */
type RowsSignal = { value: BenchRow[] };

/** Mount one fresh instance into `parent` through the shipped insert path. */
function mountFixture(
  loaded: LoadedFixture,
  owner: LifetimeScope,
  props: Record<string, unknown>,
  parent: FNode,
): { readonly host: GeneratedHost; readonly projection: Projection<unknown> } {
  const host: GeneratedHost = { props, bindings: null };
  const record = loaded.rootInstance(owner, host);
  host.bindings = record;
  const recipe = loaded.createRecipe(owner, host);
  const projection = insertRecipe(owner, recipe, parent as unknown as Node);
  return { host, projection };
}

/** Claim one existing region through the shipped claim path. */
function claimFixture(
  loaded: LoadedFixture,
  owner: LifetimeScope,
  props: Record<string, unknown>,
  parent: FNode,
): { readonly host: GeneratedHost; readonly projection: Projection<unknown> } {
  const host: GeneratedHost = { props, bindings: null };
  const record = loaded.rootInstance(owner, host);
  host.bindings = record;
  const recipe = loaded.createRecipe(owner, host);
  const projection = claimRecipe(owner, recipe, parent as unknown as Node);
  return { host, projection };
}

/** The keyed `<li>` ids of a mounted region, in document order. */
function rowIdsInDomOrder(nodes: readonly FNode[]): string[] {
  const container = nodes[0] as FElement;
  const list = container.childNodes.find(
    (node): node is FElement => node instanceof FElement && node.tagName === 'UL',
  );
  if (list === undefined) throw new Error('[micro] the fixture rendered no list');
  return list.childNodes
    .filter((node): node is FElement => node instanceof FElement && node.tagName === 'LI')
    .map((row) => row.getAttribute('data-id')!);
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

  // ── Compiler cost + artifacts (keyed-list fixture) ──────────────
  const tableSource = readFileSync(
    fileURLToPath(new URL('./oe-table.tsx', import.meta.url)),
    'utf8',
  );
  const compileOnce = (): CompiledFixture => compileFixture(tableSource, TABLE_ID, TABLE_TAG);
  const compileSampleValues: number[] = [];
  let tableFixture = compileOnce();
  for (let i = 0; i < compilerSamples; i++) {
    const started = performance.now();
    tableFixture = compileOnce();
    compileSampleValues.push(round3(performance.now() - started));
  }
  const tableLoaded = tableFixture.load();

  // ── Signal -> single leaf binding granularity ────────────────────
  const granularityFixture = compileFixture(GRANULARITY_SOURCE, GRANULARITY_ID, GRANULARITY_TAG);
  const granularityLoaded = granularityFixture.load();
  const gDoc = new FDocument();
  attachDocument(gDoc);
  const gOwner = new LifetimeScope();
  const gHostElement = gDoc.createElement('host');
  const gChurn = mountFixture(granularityLoaded, gOwner, {}, gHostElement);
  const gRecord = gChurn.host.bindings as Record<string, WritableSignal<unknown>>;

  const textPart = timed('signal->text-binding', partWriteReps, gDoc, () => {
    for (let i = 0; i < partWriteReps; i++) gRecord.label!.value = `label-${i}`;
  });
  const attrPart = timed('signal->attr-binding', partWriteReps, gDoc, () => {
    for (let i = 0; i < partWriteReps; i++) gRecord.title!.value = `title-${i}`;
  });
  const propPart = timed('signal->prop-binding', partWriteReps, gDoc, () => {
    for (let i = 0; i < partWriteReps; i++) gRecord.count!.value = i;
  });
  const floorSignal = engineSignal(0);
  const engineFloor = timed('engine-floor-no-binding', partWriteReps, gDoc, () => {
    for (let i = 0; i < partWriteReps; i++) floorSignal.value = i;
  });
  gChurn.projection.dispose(true);
  gOwner.dispose();

  // ── Generated list at 1,000-row scale ───────────────────────────
  // One shared dataset: the SSR bytes, the fresh mount and the claim all
  // describe the same rows, so the paths are directly comparable.
  const sharedRows = buildData(1000);

  // Serialize: the generated `<Name>__ssr` producer. It creates the instance's
  // resources per call (ADR-0183 D-4) and returns content-only bytes — the
  // class lane measured `serializeCompiledProgram` plus a host wrapper, so
  // `htmlBytes` here counts exactly the bytes the claim adopts, with no wrapper.
  const serializeDoc = new FDocument();
  attachDocument(serializeDoc);
  let serializedHtml = '';
  const serialize = {
    ...timed('ssr-content-1k', 1, serializeDoc, () => {
      serializedHtml = tableLoaded.ssr({ rows: sharedRows }, { bindings: {} });
    }),
    htmlBytes: new TextEncoder().encode(serializedHtml).byteLength,
  };
  if (serializedHtml.length === 0) {
    throw new Error('[micro] the fixture emitted no SSR producer content');
  }

  // Fresh: the shipped insert path. The mounted bytes must equal the SSR bytes,
  // which is the lane's own mount/SSR parity contract (any divergence is a
  // harness failure, not a slower path).
  const freshDoc = new FDocument();
  attachDocument(freshDoc);
  const freshRoot = freshDoc.createElement('host');
  const freshOwner = new LifetimeScope();
  let freshMount: ReturnType<typeof mountFixture> | null = null;
  const fresh = timed('fresh-1k', 1, freshDoc, () => {
    freshMount = mountFixture(
      tableLoaded,
      freshOwner,
      { rows: sharedRows.map((row) => ({ ...row })) },
      freshRoot,
    );
  });
  const freshInstance = freshMount!;
  const freshHtml = freshInstance.projection.nodes
    .map((node) => toHtml(node as unknown as FNode))
    .join('');
  if (freshHtml !== serializedHtml) {
    throw new Error('[micro] the generated mount diverges from the generated SSR bytes');
  }
  const rowsSignal = freshInstance.host.bindings!.rows as RowsSignal;

  // Claim: parse cost belongs to the harness, not the claim op. The parsed
  // tree is re-shaped for the platform reads the generated claim performs.
  const claimDoc = new FDocument();
  attachDocument(claimDoc);
  const claimRoot = parseHtml(claimDoc, serializedHtml);
  alignCountingTreeForClaim(claimRoot);
  const claimOwner = new LifetimeScope();
  let claimMount: ReturnType<typeof claimFixture> | null = null;
  const claim = {
    ...timed('claim-1k', 1, claimDoc, () => {
      claimMount = claimFixture(tableLoaded, claimOwner, { rows: sharedRows }, claimRoot);
    }),
    claimToFreshRatio: 0,
  };
  claim.claimToFreshRatio = round3(claim.totalMs / Math.max(fresh.totalMs, 0.001));

  // Block ops run against the fresh instance (its host record owns the signal).
  // The global `document` points back at the fresh document here: a rebuild
  // (all-new full replace) creates nodes through `document`, so the counting
  // document must be the one that owns the tree under test, exactly as the
  // browser's global document owns the page.
  attachDocument(freshDoc);
  const currentRows = (): BenchRow[] => rowsSignal.value;

  const replace1k = timed('list-replace-1k', 1, freshDoc, () => {
    rowsSignal.value = buildData(1000);
  });
  const update10th = timed('list-update-10th', 1, freshDoc, () => {
    const data = currentRows().slice();
    for (let i = 0; i < data.length; i += 10) {
      const row = data[i];
      data[i] = { id: row.id, label: `${row.label} !!!`, cls: row.cls };
    }
    rowsSignal.value = data;
  });
  const swap1k = timed('list-swap-1k', 1, freshDoc, () => {
    const data = currentRows().slice();
    const tmp = data[1];
    data[1] = data[998];
    data[998] = tmp;
    rowsSignal.value = data;
  });
  const domOrder = rowIdsInDomOrder(freshInstance.projection.nodes as unknown as FNode[]);
  const modelOrder = currentRows().map((row) => String(row.id));
  if (domOrder.join('|') !== modelOrder.join('|')) {
    throw new Error('[micro] keyed list DOM order diverges from model after swap');
  }
  const swapOrderProbe: [string, string, string] = [domOrder[0], domOrder[1], domOrder[2]];

  const remove1 = timed('list-remove-1', 1, freshDoc, () => {
    const data = currentRows();
    rowsSignal.value = data.slice(1);
  });
  const append1k = timed('list-append-1k', 1, freshDoc, () => {
    rowsSignal.value = currentRows().concat(buildData(1000));
  });
  const clear1k = timed('list-clear', 1, freshDoc, () => {
    rowsSignal.value = [];
  });
  freshInstance.projection.dispose(true);
  freshOwner.dispose();
  claimMount!.projection.dispose(true);
  claimOwner.dispose();

  // ── Churn stability: repeated create+mount+dispose leaves nothing behind ──
  const heapBefore = process.memoryUsage().heapUsed;
  const churnStarted = performance.now();
  let retainedSubscriptions = 0;
  let retainedListeners = 0;
  const churnRows = 200;
  const churnDoc = new FDocument();
  attachDocument(churnDoc);
  for (let cycle = 0; cycle < churnCycles; cycle++) {
    // The counting signal factory is the ONLY substitution: every signal the
    // emitted module creates for this instance is a wrapper around the real
    // engine signal, so the observed subscription count is exact.
    const loaded = tableFixture.load({
      signal: (initial: unknown) => new CountingSignal(initial),
    });
    const owner = new LifetimeScope();
    const root = churnDoc.createElement('host');
    const instance = mountFixture(loaded, owner, { rows: buildData(churnRows) }, root);
    const rows = instance.host.bindings!.rows as unknown as CountingSignal<unknown>;
    instance.projection.dispose(true);
    owner.dispose();
    retainedSubscriptions = Math.max(retainedSubscriptions, rows.activeSubscriptions);
    retainedListeners = Math.max(retainedListeners, (root as FElement).listenerCount());
  }
  const churnMs = performance.now() - churnStarted;
  const heapAfter = process.memoryUsage().heapUsed;

  const report: MicroReport = {
    schemaVersion: 1,
    kind: 'micro-baseline',
    issue: 1219,
    recordedAt: new Date().toISOString(),
    provenance: {
      openElementSha: options.openElementSha ?? 'unknown',
      // host runtime version — Node, the only supported host
      node: process.version,
      note:
        'fake-DOM generated-lane numbers isolate algorithmic behavior (no layout/paint); ' +
        'browser-inclusive numbers come from the upstream js-framework-benchmark ' +
        'lane on the fork (the in-repo harness was removed 2026-10-03)',
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
      generatedModuleBytes: tableFixture.compiledBytes,
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

/**
 * Point the `document` global at one counting document for the duration of a
 * phase. The generated mount/claim bodies call the DOM through the real global
 * (`document.createElement` etc.), exactly as emitted code does in a browser,
 * so the harness supplies the counting document the same way a page supplies
 * the real one.
 */
function attachDocument(doc: FDocument): void {
  (globalThis as { document?: unknown }).document = doc;
}

if (import.meta.main) {
  const sha = (await execFile('git', ['rev-parse', 'HEAD'])).stdout.trim();
  const { report } = runMicroSuite({ openElementSha: sha });
  if (process.argv.includes('--write')) {
    const out = fileURLToPath(new URL('./micro-evidence.json', import.meta.url));
    await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${out}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}
