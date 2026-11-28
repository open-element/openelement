/**
 * Generated-lane micro baseline (2026-11-21, closeout: the class-lane benchmark
 * input must not be deleted before the generated lane has its own baseline).
 *
 * WHAT THIS MEASURES, AND WHY IT IS NOT A PORT OF `oe-table.tsx`. The retired
 * input measured the CLASS lane's Part Program kernel (one compiled program
 * through `createFreshDom`/`hydrateExistingDom`). The generated lane has no Part
 * Program: its mount body is plain generated code over the leaf runtime, and its
 * keyed list is the `oe:each` wire with `encodeListKey` tokens. So the honest
 * baseline is the SAME keyed-table WORK measured on the lane that ships: compile
 * one function component, mount its 1k keyed rows, update every 10th label, swap
 * two rows, remove one row, and count the DOM operations each path performs
 * against the shared counting fake DOM.
 *
 * Like the class-lane suite next to it, timings are evidence only and the
 * committed self-checks assert deterministic DOM counts and rendered markup,
 * never durations. The suite imports each package's internal source tree on
 * purpose: the emitted module imports the internal leaf runtime, which the
 * public surface deliberately does not export.
 */
import { compileGeneratedElementIfAdmitted } from '../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/compile.ts';
import type { GeneratedElementSite } from '../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { LifetimeScope } from '../../packages/element/src/internal/compiled/lifetime-scope.ts';
import { FDocument, FElement, FText, type FNode } from './counting-dom.ts';
import { loadGeneratedBenchmarkModule } from './load-generated-module.ts';

/** The generated-lane keyed table: the same rows/ops the retired input drove. */
export const GENERATED_TABLE_SOURCE = `
import { defineIslandConfig } from '@openelement/router';
import { signal } from '@openelement/element';

export const openElement = defineIslandConfig({ root: 'light' });

function GeneratedTable() {
  const rows = signal([]);
  return (
    <table>
      <tbody>
        {rows.value.map((row) => (
          <tr key={row.id} data-id={row.id}>
            <td class="col-md-1">{row.id}</td>
            <td class="col-md-4"><a data-id={row.linkId}>{row.label}</a></td>
            <td><a data-id={row.id}>Remove</a></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default GeneratedTable;
`;

/** The generated-lane fixture's site fact (the tag the host would register). */
const SITE: GeneratedElementSite = { tag: 'oe-bench-generated' };

/** One row of the benchmark data set (the retired input's shape). */
export interface GeneratedBenchRow {
  readonly id: number;
  readonly label: string;
  readonly linkId: number | null | { toString(): string };
}

const ADJECTIVES = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long'];
const NOUNS = ['table', 'chair', 'house', 'bottle', 'car', 'tree', 'window'];

/** `id` is the KEYED identity (the `key=` prop), so swap/update exercise keys. */
export function buildGeneratedRows(count: number): GeneratedBenchRow[] {
  const rows: GeneratedBenchRow[] = [];
  for (let index = 0; index < count; index++) {
    rows.push({
      id: index,
      label: `${ADJECTIVES[index % ADJECTIVES.length]} ${NOUNS[index % NOUNS.length]} ${index}`,
      linkId: index,
    });
  }
  return rows;
}

interface CompiledBench {
  readonly compiledBytes: number;
  readonly rootInstance: (owner: LifetimeScope, host: unknown) => Record<string, unknown>;
  readonly createRecipe: (
    owner: LifetimeScope,
    host: unknown,
  ) => {
    mount(scope: LifetimeScope): unknown;
  };
}

/** Compile the fixture once and load its emitted recipe against the leaf runtime. */
export function compileGeneratedTable(): CompiledBench {
  const compiled = compileGeneratedElementIfAdmitted(
    GENERATED_TABLE_SOURCE,
    '/bench/generated-table.tsx',
    { site: SITE, authoredSource: GENERATED_TABLE_SOURCE },
  );
  if (compiled === null) throw new Error('the generated-lane benchmark fixture was declined');
  return {
    compiledBytes: compiled.code.length,
    ...loadGeneratedBenchmarkModule<Omit<CompiledBench, 'compiledBytes'>>(
      compiled.code,
      '{ rootInstance: __oe_rootInstance, createRecipe: createGeneratedTableRecipe }',
    ),
  };
}

export interface GeneratedTableFacts {
  readonly compiledBytes: number;
  readonly mountedRowCount: number;
  readonly mountedElements: number;
  readonly mountTextWrites: number;
  readonly update10thTextWrites: number;
  readonly update10thAttributeWrites: number;
  readonly attributeUpdates: {
    readonly initial: string | null;
    readonly changed: { readonly writes: number; readonly value: string | null };
    readonly repaired: { readonly writes: number; readonly value: string | null };
    readonly removed: { readonly writes: number; readonly value: string | null };
    readonly absentWrites: number;
    readonly reads: number;
    readonly coercions: number;
  };
  readonly updateInsertions: number;
  readonly swappedIds: readonly [string, string];
  readonly removeRemovals: number;
  readonly removeLeftRowCount: number;
}

function elementsByTag(root: FElement, tagName: string): FElement[] {
  return root.childNodes.flatMap((node) => {
    if (!(node instanceof FElement)) return [];
    if (node.tagName === tagName) return [node];
    return elementsByTag(node, tagName);
  });
}

function textContent(node: FNode): string {
  if (node instanceof FText) return node.data;
  if (node instanceof FElement) return node.childNodes.map(textContent).join('');
  return '';
}

/**
 * Run every keyed-table path against ONE counting document and report the
 * deterministic facts the self-check asserts.
 */
export function runGeneratedTableBenchmark(): GeneratedTableFacts {
  const bench = compileGeneratedTable();
  const doc = new FDocument();
  const globals = globalThis as { document?: unknown };
  const previousDocument = globals.document;
  globals.document = doc;
  const owner = new LifetimeScope();
  try {
    const root = doc.createElement('div') as FElement;
    const hostRecord: Record<string, unknown> = { props: {}, bindings: null };
    const record = bench.rootInstance(owner, hostRecord);
    hostRecord.bindings = record;
    const recipe = bench.createRecipe(owner, hostRecord);
    const mountScope = owner.child();
    mountScope.connect();
    const mounted = recipe.mount(mountScope) as readonly FElement[];
    for (const node of mounted) root.appendChild(node);
    const rows = record.rows as { value: GeneratedBenchRow[] };
    rows.value = buildGeneratedRows(1000);
    const mountedRowCount = elementsByTag(root, 'TR').length;
    const mountedElements = doc.counts.elements;
    const mountTextWrites = doc.counts.textWrites;

    // Update every 10th label: only the affected text nodes are rewritten.
    doc.resetCounts();
    const updated = rows.value.slice();
    for (let index = 0; index < updated.length; index += 10) {
      const row = updated[index]!;
      updated[index] = { ...row, label: `${row.label} !!!` };
    }
    rows.value = updated;
    const update10thTextWrites = doc.counts.textWrites;
    const update10thAttributeWrites = doc.counts.attrWrites;
    const updateInsertions = doc.counts.insertions;

    const firstRow = rows.value[0]!;
    const firstLink = elementsByTag(elementsByTag(root, 'TR')[0]!, 'A')[0]!;
    const initial = firstLink.getAttribute('data-id');
    let reads = 0;
    let coercions = 0;
    const changedRow = {
      ...firstRow,
      get linkId() {
        reads++;
        return {
          toString() {
            coercions++;
            return 'changed';
          },
        };
      },
    };
    const linkWrite = () => ({
      writes: doc.counts.attrWrites,
      value: firstLink.getAttribute('data-id'),
    });
    doc.resetCounts();
    rows.value = [changedRow, ...rows.value.slice(1)];
    const changed = linkWrite();
    firstLink.setAttribute('data-id', 'outside edit');
    doc.resetCounts();
    rows.value = rows.value.slice();
    const repaired = linkWrite();
    doc.resetCounts();
    rows.value = [{ ...firstRow, linkId: null }, ...rows.value.slice(1)];
    const removed = linkWrite();
    doc.resetCounts();
    rows.value = rows.value.slice();
    const attributeUpdates = {
      initial,
      changed,
      repaired,
      removed,
      absentWrites: doc.counts.attrWrites,
      reads,
      coercions,
    };

    // Keyed swap: rows 1 and 998 exchange data; the DOM follows the KEYS.
    // The count is the deterministic contract (#1455's mirror on the generated
    // lane): a distant swap places EXACTLY the two swapped entries — their
    // marker and row nodes — and never re-inserts the 997 stationary entries
    // in between.
    doc.resetCounts();
    const swapped = rows.value.slice();
    const first = swapped[1]!;
    swapped[1] = swapped[998]!;
    swapped[998] = first;
    rows.value = swapped;
    const swapInsertions = doc.counts.insertions;
    // The FULL order follows the keys — the identity contract #1455 pins on
    // the retained runtime, asserted row by row, not just at the two named
    // positions.
    const swappedOrderIds = elementsByTag(root, 'TR').map((row) => {
      const idCell = elementsByTag(row, 'TD')[0];
      if (!idCell) throw new Error('generated benchmark row is missing its ID cell');
      return textContent(idCell);
    });
    const swappedIds = [swappedOrderIds[1] ?? '', swappedOrderIds[998] ?? ''] as const;
    const expectedSwappedOrderIds = swapped.map((row) => String(row.id));

    // Remove one row: exactly one <tr> leaves the document.
    doc.resetCounts();
    rows.value = rows.value.filter((row) => row.id !== 5);
    const removeRemovals = doc.counts.removals;
    const removeLeftRowCount = elementsByTag(root, 'TR').length;

    return {
      compiledBytes: bench.compiledBytes,
      mountedRowCount,
      mountedElements,
      mountTextWrites,
      update10thTextWrites,
      update10thAttributeWrites,
      attributeUpdates,
      updateInsertions,
      swapInsertions,
      swappedIds,
      swappedOrderIds,
      expectedSwappedOrderIds,
      removeRemovals,
      removeLeftRowCount,
    };
  } finally {
    mountScopeCleanup();
    owner.dispose();
    globals.document = previousDocument;
  }

  function mountScopeCleanup(): void {
    // The mount scope is a child of `owner`; disposing the owner cascades it.
  }
}
