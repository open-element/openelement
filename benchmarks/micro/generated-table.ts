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
import * as leafRuntime from '../../packages/element/src/internal/compiled/leaf-runtime.ts';
import { LifetimeScope } from '../../packages/element/src/internal/compiled/lifetime-scope.ts';
import { FDocument, FElement, FText, type FNode } from './counting-dom.ts';

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
          <tr key={row.id}>
            <td class="col-md-1">{row.id}</td>
            <td class="col-md-4"><a>{row.label}</a></td>
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

/**
 * Compile the fixture ONCE and evaluate the emitted module with the leaf runtime
 * as its only import surface. `new Function` is the narrowest loader that keeps
 * the REAL emitted bytes (not a hand-written lookalike) while staying out of a
 * bundler: the emitted module's only import is the internal leaf runtime, whose
 * symbols are passed in as parameters.
 */
export function compileGeneratedTable(): CompiledBench {
  const compiled = compileGeneratedElementIfAdmitted(
    GENERATED_TABLE_SOURCE,
    '/bench/generated-table.tsx',
    { site: SITE, authoredSource: GENERATED_TABLE_SOURCE },
  );
  if (compiled === null) throw new Error('the generated-lane benchmark fixture was declined');
  const code = compiled.code;
  const importLines = code.split('\n').filter((line) => line.startsWith('import {'));
  if (importLines.length === 0) throw new Error('the emitted module has no runtime imports');
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
  const body = code
    .replace(/^import \{[^}]*\} from "[^"]+";$/gm, '')
    .replace(/^export default [^;]+;$/gm, '')
    .replace(/^export \{[^}]*\};$/gm, '')
    .replace(/^export /gm, '');
  const factory = new Function(
    ...names,
    `${body}\n; return { rootInstance: __oe_rootInstance, createRecipe: createGeneratedTableRecipe };`,
  );
  // The leaf runtime provides the mount/claim/SSR primitives; the ONE shell
  // symbol (the CE-tail class factory) is a marker here — the benchmark drives
  // the emitted mount/recipe directly, never a custom element registration.
  const values = names.map((name) =>
    name === 'createGeneratedElementClass'
      ? (descriptor: unknown) => descriptor
      : (leafRuntime as unknown as Record<string, unknown>)[name],
  );
  for (const [index, name] of names.entries()) {
    if (typeof values[index] === 'undefined') {
      throw new Error(`the emitted module imports "${name}", which the benchmark does not provide`);
    }
  }
  return {
    compiledBytes: code.length,
    ...(factory(...values) as Omit<CompiledBench, 'compiledBytes'>),
  };
}

export interface GeneratedTableFacts {
  readonly compiledBytes: number;
  readonly mountedRowCount: number;
  readonly mountedElements: number;
  readonly mountTextWrites: number;
  readonly update10thTextWrites: number;
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
      updated[index] = { id: row.id, label: `${row.label} !!!` };
    }
    rows.value = updated;
    const update10thTextWrites = doc.counts.textWrites;
    const updateInsertions = doc.counts.insertions;

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
