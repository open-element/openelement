/**
 * M05 v2 — generated leaf mount/update/dispose (compiler-private).
 *
 * Consumes the merged M03 `FunctionModelModule` + `ExpressionRegistry` (never
 * re-derives resolution, lowering or erasure) and emits a real JavaScript
 * module whose `mount(scope)` builds detached DOM using the M04 runtime
 * primitives: one `createRecipe` per leaf component, `bindSignalWrites` for
 * tracked slots, and the canonical `displayValue`/`attributeValueOf`/
 * `assertSafeUrlAttribute` value semantics. The harness inserts generated
 * recipes through `insertRecipe` — the one insertion surface.
 *
 * S1/M06a leaf + S2 scope: intrinsic elements, fragments, multi-root, empty
 * output, static text/attributes, dynamic text and `attribute`/`boolean`/
 * `property` channel attributes with signal/computed driven refresh,
 * conditions, lists, default + detach disposal, throwing cleanups, and (M06b1a-1)
 * module-level component mounts plus module-local component references
 * (`<Child prop={expr}/>`). One component body is emitted exactly once per
 * module: `function <Name>__mount(scope, props, host)` builds a detached
 * instance and returns its nodes; the exported `create<Name>Recipe(owner, host)`
 * factory keeps its name/signature and delegates its recipe mount to it, and a
 * component reference calls the child mount directly with a fresh child scope.
 *
 * Props passed to a child are a per-read getter record over the DEFINING
 * (parent) scope (`{ get text() { return <parent read>; } }`, never cached).
 * The child refreshes a prop-dependent slot through `host.propDeps`: the root
 * factory supplies `[host.propsChanged]` (preserving the
 * `OEIR_LEAF_MISSING_VALUE: propsChanged` contract), a component-reference call
 * site supplies the parent bindings its prop expressions depend on. The child
 * instance owns a fresh child scope of the parent; the parent appends the
 * returned nodes in authored order.
 *
 * Still fails closed with a coded diagnostic (M06b1a-2/M06b1a-3, M06b2, M07/M08
 * boundary): recipes/insertion sites, children projection, component references
 * to unknown/external components, child components with no named props
 * parameter (destructured or absent) or with signal/computed resources,
 * `class`/`style`/`innerHTML`/`event`/`ref` channels (on elements and on
 * component props), and `key` as a DOM write. `key` on a component reference is
 * consumed as list identity only and is never a DOM write or a child prop.
 *
 * The emitted module imports from the compiler-private runtime entry
 * `@openelement/element/internal/compiled/runtime`. That entry is not a
 * published subpath yet (the narrow ABI is a later milestone); the browser
 * harness bundles the same M04 modules under the same names, so the artifact
 * under test uses the real primitives, not stubs.
 *
 * NOT claimed here: generated-module source map (M05b named gap: A2 expression
 * segments exist, placement composition is a separate evidence slice),
 * claim/SSR, production wiring, ABI/public API.
 */

import ts from 'typescript';
import { unsafeStreamFrameAttribute } from '@openelement/protocol/stream-frame-policy';
import type {
  FunctionExpressionRef,
  FunctionModelAttribute,
  FunctionModelComponent,
  FunctionModelComponentRef,
  FunctionModelCondition,
  FunctionModelList,
  FunctionModelModule,
  FunctionModelNode,
} from '../../semantic-core/function-frontend.ts';
import type { LoweredExpressionRecord } from '../../semantic-core/expression-registry.ts';
import type { BindingId } from '../../semantic-core/scope-resolution.ts';
import type { IrDiagnostic, IrSpan } from '../types.ts';
import {
  SourceMapSegmentBuilder,
  type CompiledElementSourceMap,
  type EmissionSegment,
} from '../../semantic-core/source-map.ts';

/** Compiler-private runtime entry the emitted module imports from. */
export const GENERATED_LEAF_RUNTIME_SPECIFIER = '@openelement/element/internal/compiled/runtime';

const RUNTIME_IMPORTS = [
  'assertSafeUrlAttribute',
  'attributeValueOf',
  'bindSignalWrites',
  'createRecipe',
  'displayValue',
  'removeNodes',
] as const;

const INTERNAL_PREFIX = '__oe_';
/**
 * Module-level component mount (M06b1a-1): `<Name>__mount(scope, props, host)`.
 * The mount builds one detached instance and returns its top-level nodes; both
 * the exported root factory and every component-reference call site delegate to
 * it, so one component body is emitted exactly once per module.
 */
const MOUNT_SUFFIX = '__mount';
/** Fixed module-level mount parameters; they define the emitted host record shape. */
const MOUNT_SCOPE = `${INTERNAL_PREFIX}scope`;
const MOUNT_PROPS = `${INTERNAL_PREFIX}props`;
const MOUNT_HOST = `${INTERNAL_PREFIX}host`;
/**
 * The module-level mount's host record: the parent-provided host bindings plus
 * the defining-scope signals a child instance refreshes props reads through.
 * The root factory supplies `[host.propsChanged]`; a component-reference call
 * site supplies the parent bindings its prop expressions depend on.
 */
const MOUNT_DEP_LOOP = `${INTERNAL_PREFIX}propDep`;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;
const ATTRIBUTE_PATTERN = /^[A-Za-z_:][A-Za-z0-9_:.-]*$/;
const ADMITTED_ATTRIBUTE_CHANNELS: ReadonlySet<string> = new Set([
  'attribute',
  'boolean',
  'property',
]);
/** Attributes the compiler consumes as identity (never a DOM write). */
const CONSUMED_ATTRIBUTE_CHANNELS: ReadonlySet<string> = new Set(['key']);

/** One lowered-expression placement in the emitted module (compiler-private). */
export interface ExpressionPlacement {
  readonly exprId: string;
  /** 1-based generated line where the lowered text starts. */
  readonly generatedLine: number;
  /** 0-based generated column where the lowered text starts. */
  readonly generatedColumn: number;
  /** 1-based authored line of the expression. */
  readonly authoredLine: number;
  /** 0-based authored column of the expression start. */
  readonly authoredColumn: number;
}

export interface GeneratedLeafModule {
  /** Emitted ESM module; `null` when any diagnostic was emitted (fail closed). */
  readonly module: string | null;
  /**
   * End-to-end Source Map v3 for the emitted module (M05b). `null` unless the
   * caller supplies the authored source text (required for `sourcesContent`).
   */
  readonly sourceMap: CompiledElementSourceMap | null;
  /** Placement ledger for every lowered expression in the emitted module. */
  readonly placements: readonly ExpressionPlacement[];
  /** Host `bindings` names the module reads (signals/computeds/functions). */
  readonly requiredBindings: readonly string[];
  /** Host `props` names the module reads. */
  readonly requiredProps: readonly string[];
  /** True when the module subscribes to `host.propsChanged` (tracked props). */
  readonly requiresPropsChanged: boolean;
  readonly diagnostics: readonly IrDiagnostic[];
}

interface EmitState {
  readonly component: FunctionModelComponent;
  readonly lines: string[];
  indent: number;
  readonly diagnostics: IrDiagnostic[];
  readonly requiredBindings: Set<string>;
  readonly requiredProps: Set<string>;
  readonly hostBindings: Set<string>;
  readonly localResources: Set<string>;
  counter: { value: number };
  readonly propsName: string | null;
  requiresPropsChanged: boolean;
  /** Source Map v3 segments for this component, in module-local line numbers. */
  readonly segments: EmissionSegment[];
  readonly placements: ExpressionPlacement[];
  /** Dedupe generated positions (a consumer must not see ambiguous duplicates). */
  readonly segmentKeys: Set<string>;
  /** The scope variable in the current generated closure (`__oe_scope` by default). */
  scopeVar: string;
  /** The host-record parameter of the module-level mount (`__oe_host`). */
  readonly hostVar: string;
  /** Module component table: component references resolve against it. */
  readonly componentByName: ReadonlyMap<string, FunctionModelComponent>;
  /** Entry-mapper names bound in the current generated builder (not host bindings). */
  readonly entryNames: Set<string>;
  /** Refresh-function collectors for the enclosing list-entry builder (if any). */
  readonly refreshStack: string[][];
}

function diag(state: EmitState, code: string, message: string, span: IrSpan): void {
  state.diagnostics.push({
    severity: 'error',
    code,
    message,
    span,
    origin: 'ir-object',
  });
}

interface SpanLike {
  readonly file: string;
  /** 1-based authored line. */
  readonly line: number;
  /** 1-based authored column. */
  readonly column: number;
}

type LinePart = string | { readonly record: LoweredExpressionRecord };

function currentColumn(state: EmitState): number {
  return state.indent * 2;
}

function addSegment(
  state: EmitState,
  generatedLine: number,
  generatedColumn: number,
  sourceLine: number,
  sourceColumn: number,
  name?: string,
): void {
  const key = `${generatedLine}:${generatedColumn}`;
  if (state.segmentKeys.has(key)) return;
  state.segmentKeys.add(key);
  state.segments.push({
    generatedLine,
    generatedColumn,
    sourceLine,
    sourceColumn,
    ...(name === undefined ? {} : { name }),
  });
}

/** Append one generated line; an authored anchor maps its start position. */
function push(state: EmitState, text: string, anchor?: SpanLike): void {
  const lineNumber = state.lines.length + 1;
  if (anchor !== undefined) {
    // Structural anchors map from the generated line start (statement position).
    addSegment(state, lineNumber, 0, anchor.line, anchor.column - 1);
  }
  state.lines.push(`${'  '.repeat(state.indent)}${text}`);
}

/**
 * Append one generated line containing lowered expression text: the placement
 * is recorded and the A2 expression segments are rebased into module
 * coordinates (multi-line lowering keeps later lines at their own columns).
 */
function pushParts(state: EmitState, parts: readonly LinePart[], anchor?: SpanLike): void {
  const lineNumber = state.lines.length + 1;
  let column = currentColumn(state);
  let text = '  '.repeat(state.indent);
  if (anchor !== undefined) addSegment(state, lineNumber, column, anchor.line, anchor.column - 1);
  for (const part of parts) {
    if (typeof part === 'string') {
      text += part;
      column += part.length;
      continue;
    }
    const record = part.record;
    const lowered = record.lowered.trim();
    const startLine = lineNumber;
    const startColumn = column;
    // The placement start maps to the authored expression start; the A2
    // segments (which may start after trimmed markers) provide finer anchors.
    addSegment(
      state,
      startLine,
      startColumn,
      record.authoredSpan.line,
      record.authoredSpan.column - 1,
    );
    state.placements.push({
      exprId: record.id,
      generatedLine: startLine,
      generatedColumn: startColumn,
      authoredLine: record.authoredSpan.line,
      authoredColumn: record.authoredSpan.column - 1,
    });
    for (const segment of record.segments) {
      addSegment(
        state,
        startLine + segment.generatedLine - 1,
        segment.generatedLine === 1
          ? startColumn + segment.generatedColumn
          : segment.generatedColumn,
        segment.sourceLine,
        segment.sourceColumn,
        segment.name,
      );
    }
    text += lowered;
    const lines = lowered.split('\n');
    column = lines.length === 1 ? startColumn + lowered.length : lines[lines.length - 1]!.length;
  }
  state.lines.push(text);
}

type SinkEntry =
  | { readonly kind: 'node'; readonly name: string }
  | { readonly kind: 'spread'; readonly name: string };

/** Register one generated refresh function with the enclosing entry builder. */
function registerRefresh(state: EmitState, name: string): void {
  const collector = state.refreshStack[state.refreshStack.length - 1];
  if (collector !== undefined) collector.push(name);
}

/** Append the sink entries to an element variable (authored child order). */
function appendSinkToElement(
  state: EmitState,
  sink: readonly SinkEntry[],
  targetVar: string,
): void {
  for (const entry of sink) {
    if (entry.kind === 'node') push(state, `${targetVar}.appendChild(${entry.name});`);
    else
      push(
        state,
        `for (const ${INTERNAL_PREFIX}child of ${entry.name}) ${targetVar}.appendChild(${INTERNAL_PREFIX}child);`,
      );
  }
}

/** Append the sink entries to a generated node-array variable. */
function appendSinkToArray(state: EmitState, sink: readonly SinkEntry[], targetVar: string): void {
  for (const entry of sink) {
    if (entry.kind === 'node') push(state, `${targetVar}.push(${entry.name});`);
    else
      push(
        state,
        `for (const ${INTERNAL_PREFIX}child of ${entry.name}) ${targetVar}.push(${INTERNAL_PREFIX}child);`,
      );
  }
}

/**
 * Emit one nested generated builder function that returns a node array. The
 * builder gets its own scope variable so its resources register on the branch /
 * entry owner, and lowered expressions inside keep the M03 placement ledger.
 */
function emitNodesBuilder(
  state: EmitState,
  functionName: string,
  scopeParam: string,
  nodes: readonly FunctionModelNode[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  anchor: SpanLike,
): void {
  push(state, `function ${functionName}(${scopeParam}) {`, anchor);
  state.indent += 1;
  const outerScope = state.scopeVar;
  state.scopeVar = scopeParam;
  push(state, `const ${INTERNAL_PREFIX}nodes = [];`);
  for (const node of nodes) {
    const sink: SinkEntry[] = [];
    emitNode(state, node, sink, records);
    appendSinkToArray(state, sink, `${INTERNAL_PREFIX}nodes`);
  }
  push(state, `return ${INTERNAL_PREFIX}nodes;`);
  state.scopeVar = outerScope;
  state.indent -= 1;
  push(state, '}');
}

/**
 * Emit the per-entry list builder: binds the authored mapper parameter, builds
 * the entry's detached nodes on the entry owner scope and returns an `update`
 * hook so a keyed reuse re-evaluates the entry's refresh closures in place
 * (DOM identity is preserved; per-read props replacement stays M06b/M07).
 */
function emitEntryBuilder(
  state: EmitState,
  functionName: string,
  scopeParam: string,
  itemParam: string,
  itemName: string,
  nodes: readonly FunctionModelNode[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  anchor: SpanLike,
): void {
  push(state, `function ${functionName}(${scopeParam}, ${itemParam}) {`, anchor);
  state.indent += 1;
  const outerScope = state.scopeVar;
  state.scopeVar = scopeParam;
  state.entryNames.add(itemName);
  push(state, `const ${INTERNAL_PREFIX}nodes = [];`);
  push(state, `let ${itemName} = ${itemParam};`);
  const collector: string[] = [];
  state.refreshStack.push(collector);
  for (const node of nodes) {
    const sink: SinkEntry[] = [];
    emitNode(state, node, sink, records);
    appendSinkToArray(state, sink, `${INTERNAL_PREFIX}nodes`);
  }
  state.refreshStack.pop();
  state.entryNames.delete(itemName);
  const updateBody = [`${itemName} = next;`, ...collector.map((name) => `${name}(true);`)].join(
    ' ',
  );
  push(state, `return { nodes: ${INTERNAL_PREFIX}nodes, update(next) { ${updateBody} } };`);
  state.scopeVar = outerScope;
  state.indent -= 1;
  push(state, '}');
}

/** Emit `when`/branch replacement through the M04 disposal mapping. */
function emitCondition(
  state: EmitState,
  node: FunctionModelCondition,
  sink: SinkEntry[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const record = recordFor(state, node.test, records);
  if (record === null || !declareReads(state, record)) return;
  const dependencies = dependencyNames(state, record);
  if (dependencies === null) return;
  const id = state.counter.value++;
  const anchorVar = `${INTERNAL_PREFIX}whenAnchor${id}`;
  const activeVar = `${INTERNAL_PREFIX}whenActive${id}`;
  const ownerVar = `${INTERNAL_PREFIX}whenOwner${id}`;
  const refreshVar = `${INTERNAL_PREFIX}whenRefresh${id}`;
  const consequentFn = node.consequent.length > 0 ? `${INTERNAL_PREFIX}whenThen${id}` : null;
  const alternateFn =
    node.alternate !== null && node.alternate.length > 0 ? `${INTERNAL_PREFIX}whenElse${id}` : null;

  push(state, `const ${anchorVar} = document.createComment("oe:when");`, node.span);
  sink.push({ kind: 'node', name: anchorVar });
  if (consequentFn !== null) {
    emitNodesBuilder(
      state,
      consequentFn,
      `${INTERNAL_PREFIX}whenThenScope${id}`,
      node.consequent,
      records,
      node.span,
    );
  }
  if (alternateFn !== null) {
    emitNodesBuilder(
      state,
      alternateFn,
      `${INTERNAL_PREFIX}whenElseScope${id}`,
      node.alternate!,
      records,
      node.span,
    );
  }

  push(state, `let ${activeVar} = -1;`);
  push(state, `let ${ownerVar} = null;`);
  push(state, `function ${refreshVar}(force) {`, node.span);
  state.indent += 1;
  const select = alternateFn === null ? `? 1 : 0` : `? 1 : 2`;
  pushParts(state, [`const ${INTERNAL_PREFIX}next = (`, { record }, `) ${select};`]);
  push(state, `if (!force && ${INTERNAL_PREFIX}next === ${activeVar}) return;`);
  push(state, `if (${ownerVar} !== null) ${ownerVar}.dispose(true);`);
  push(state, `${ownerVar} = null;`);
  push(state, `const ${INTERNAL_PREFIX}branchOwner = ${state.scopeVar}.child();`);
  push(state, `let ${INTERNAL_PREFIX}branchNodes;`);
  push(state, `try {`);
  state.indent += 1;
  const thenCall = consequentFn === null ? '[]' : `${consequentFn}(${INTERNAL_PREFIX}branchOwner)`;
  const elseCall = alternateFn === null ? '[]' : `${alternateFn}(${INTERNAL_PREFIX}branchOwner)`;
  push(
    state,
    `${INTERNAL_PREFIX}branchNodes = ${INTERNAL_PREFIX}next === 1 ? ${thenCall} : ${elseCall};`,
  );
  state.indent -= 1;
  push(state, `} catch (error) { ${INTERNAL_PREFIX}branchOwner.dispose(true); throw error; }`);
  push(
    state,
    `${INTERNAL_PREFIX}branchOwner.addRangeCleanup(() => removeNodes(${INTERNAL_PREFIX}branchNodes));`,
  );
  push(state, `const ${INTERNAL_PREFIX}parent = ${anchorVar}.parentNode;`);
  push(
    state,
    `if (${INTERNAL_PREFIX}parent !== null) { let ${INTERNAL_PREFIX}reference = ${anchorVar}.nextSibling; for (const ${INTERNAL_PREFIX}child of ${INTERNAL_PREFIX}branchNodes) ${INTERNAL_PREFIX}parent.insertBefore(${INTERNAL_PREFIX}child, ${INTERNAL_PREFIX}reference); }`,
  );
  push(
    state,
    `${activeVar} = ${INTERNAL_PREFIX}next; ${ownerVar} = ${INTERNAL_PREFIX}branchOwner;`,
  );
  state.indent -= 1;
  push(state, '}');

  // Initial branch: build detached, then hand the nodes to the enclosing sink so
  // they land at the anchor position when the mount's node list is inserted.
  const initialOwnerVar = `${INTERNAL_PREFIX}initialOwner${id}`;
  const initialTestVar = `${INTERNAL_PREFIX}initialTest${id}`;
  const initialNodesVar = `${INTERNAL_PREFIX}initialNodes${id}`;
  push(state, `const ${initialOwnerVar} = ${state.scopeVar}.child();`);
  pushParts(state, [`const ${initialTestVar} = (`, { record }, ');']);
  push(state, `let ${initialNodesVar};`);
  push(state, `try {`);
  state.indent += 1;
  const initialThen = consequentFn === null ? '[]' : `${consequentFn}(${initialOwnerVar})`;
  const initialElse = alternateFn === null ? '[]' : `${alternateFn}(${initialOwnerVar})`;
  push(state, `${initialNodesVar} = ${initialTestVar} ? ${initialThen} : ${initialElse};`);
  state.indent -= 1;
  push(state, `} catch (error) { ${initialOwnerVar}.dispose(true); throw error; }`);
  push(state, `${initialOwnerVar}.addRangeCleanup(() => removeNodes(${initialNodesVar}));`);
  push(
    state,
    `${activeVar} = ${initialTestVar} ? 1 : ${alternateFn === null ? 0 : 2}; ${ownerVar} = ${initialOwnerVar};`,
  );
  sink.push({ kind: 'spread', name: initialNodesVar });
  emitDependencySubscriptions(state, dependencies, refreshVar, node.span);
  registerRefresh(state, refreshVar);
}

/** Emit `each`/map reconciliation with per-entry owners, keys and in-place updates. */
function emitList(
  state: EmitState,
  node: FunctionModelList,
  sink: SinkEntry[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const itemsRecord = recordFor(state, node.items, records);
  if (itemsRecord === null || !declareReads(state, itemsRecord)) return;
  const dependencies = dependencyNames(state, itemsRecord);
  if (dependencies === null) return;
  if (!IDENTIFIER_PATTERN.test(node.parameter) || node.parameter.startsWith(INTERNAL_PREFIX)) {
    diag(
      state,
      'OEIR_LEAF_INVALID_BINDING',
      `list mapper parameter '${node.parameter}' is not usable`,
      node.span,
    );
    return;
  }
  const id = state.counter.value++;
  const anchorVar = `${INTERNAL_PREFIX}eachAnchor${id}`;
  const entriesVar = `${INTERNAL_PREFIX}eachEntries${id}`;
  const entryFn = `${INTERNAL_PREFIX}eachEntry${id}`;
  const keyFn = `${INTERNAL_PREFIX}eachKey${id}`;
  const refreshVar = `${INTERNAL_PREFIX}eachRefresh${id}`;

  push(state, `const ${anchorVar} = document.createComment("oe:each");`, node.span);
  sink.push({ kind: 'node', name: anchorVar });
  push(state, `let ${entriesVar} = [];`);
  emitEntryBuilder(
    state,
    entryFn,
    `${INTERNAL_PREFIX}eachScope${id}`,
    `${INTERNAL_PREFIX}eachItem${id}`,
    node.parameter,
    node.template,
    records,
    node.span,
  );

  let keyDependencies: readonly Dependency[] = [];
  if (node.key !== null) {
    const keyRecord = recordFor(state, node.key, records);
    if (keyRecord === null) return;
    // The mapper parameter is entry-local (not a host binding); outer reads in a
    // key thunk are validated as usual and refresh the list when written.
    state.entryNames.add(node.parameter);
    const declared = declareReads(state, keyRecord);
    state.entryNames.delete(node.parameter);
    if (!declared) return;
    const keyDeps = dependencyNames(state, keyRecord);
    if (keyDeps === null) return;
    keyDependencies = keyDeps;
    pushParts(
      state,
      [
        `function ${keyFn}(${INTERNAL_PREFIX}eachItem, ${INTERNAL_PREFIX}eachIndex) { const ${node.parameter} = ${INTERNAL_PREFIX}eachItem; return (`,
        { record: keyRecord },
        '); }',
      ],
      node.key.span,
    );
  } else {
    push(
      state,
      `function ${keyFn}(${INTERNAL_PREFIX}eachItem, ${INTERNAL_PREFIX}eachIndex) { return ${INTERNAL_PREFIX}eachIndex; }`,
      node.span,
    );
  }

  push(state, `function ${refreshVar}() {`, node.span);
  state.indent += 1;
  pushParts(state, [`const ${INTERNAL_PREFIX}items = (`, { record: itemsRecord }, ');']);
  push(state, `const ${INTERNAL_PREFIX}previous = ${entriesVar};`);
  push(state, `const ${INTERNAL_PREFIX}next = [];`);
  push(state, `const ${INTERNAL_PREFIX}used = new Set();`);
  push(
    state,
    `for (let ${INTERNAL_PREFIX}index = 0; ${INTERNAL_PREFIX}index < ${INTERNAL_PREFIX}items.length; ${INTERNAL_PREFIX}index++) {`,
  );
  state.indent += 1;
  push(state, `const ${INTERNAL_PREFIX}item = ${INTERNAL_PREFIX}items[${INTERNAL_PREFIX}index];`);
  push(
    state,
    `const ${INTERNAL_PREFIX}key = ${keyFn}(${INTERNAL_PREFIX}item, ${INTERNAL_PREFIX}index);`,
  );
  push(state, `let ${INTERNAL_PREFIX}found = null;`);
  push(
    state,
    `for (const ${INTERNAL_PREFIX}entry of ${INTERNAL_PREFIX}previous) { if (${INTERNAL_PREFIX}entry.key === ${INTERNAL_PREFIX}key && !${INTERNAL_PREFIX}used.has(${INTERNAL_PREFIX}entry)) { ${INTERNAL_PREFIX}found = ${INTERNAL_PREFIX}entry; break; } }`,
  );
  push(state, `if (${INTERNAL_PREFIX}found !== null) {`);
  state.indent += 1;
  push(
    state,
    `${INTERNAL_PREFIX}used.add(${INTERNAL_PREFIX}found); ${INTERNAL_PREFIX}found.item = ${INTERNAL_PREFIX}item; ${INTERNAL_PREFIX}found.update(${INTERNAL_PREFIX}item); ${INTERNAL_PREFIX}next.push(${INTERNAL_PREFIX}found);`,
  );
  state.indent -= 1;
  push(state, `} else {`);
  state.indent += 1;
  push(state, `const ${INTERNAL_PREFIX}owner = ${state.scopeVar}.child();`);
  push(state, `let ${INTERNAL_PREFIX}built;`);
  push(state, `try {`);
  state.indent += 1;
  push(
    state,
    `${INTERNAL_PREFIX}built = ${entryFn}(${INTERNAL_PREFIX}owner, ${INTERNAL_PREFIX}item);`,
  );
  state.indent -= 1;
  push(state, `} catch (error) { ${INTERNAL_PREFIX}owner.dispose(true); throw error; }`);
  push(
    state,
    `${INTERNAL_PREFIX}owner.addRangeCleanup(() => removeNodes(${INTERNAL_PREFIX}built.nodes));`,
  );
  push(
    state,
    `const ${INTERNAL_PREFIX}entry = { key: ${INTERNAL_PREFIX}key, item: ${INTERNAL_PREFIX}item, owner: ${INTERNAL_PREFIX}owner, nodes: ${INTERNAL_PREFIX}built.nodes, update: ${INTERNAL_PREFIX}built.update };`,
  );
  push(
    state,
    `${INTERNAL_PREFIX}used.add(${INTERNAL_PREFIX}entry); ${INTERNAL_PREFIX}next.push(${INTERNAL_PREFIX}entry);`,
  );
  state.indent -= 1;
  push(state, `}`);
  state.indent -= 1;
  push(state, `}`);
  push(
    state,
    `for (const ${INTERNAL_PREFIX}entry of ${INTERNAL_PREFIX}previous) if (!${INTERNAL_PREFIX}used.has(${INTERNAL_PREFIX}entry)) ${INTERNAL_PREFIX}entry.owner.dispose(true);`,
  );
  push(state, `const ${INTERNAL_PREFIX}parent = ${anchorVar}.parentNode;`);
  push(state, `if (${INTERNAL_PREFIX}parent !== null) {`);
  state.indent += 1;
  // Keyed placement: the list owns the siblings AFTER the anchor. Find the tail
  // reference (first following sibling that is not a current entry node), then
  // place the next entries in reverse and move only nodes not already in place.
  // Unchanged nodes (and a focused element in them) are never re-inserted.
  push(state, `const ${INTERNAL_PREFIX}previousNodes = new Set();`);
  push(
    state,
    `for (const ${INTERNAL_PREFIX}entry of ${INTERNAL_PREFIX}previous) for (const ${INTERNAL_PREFIX}node of ${INTERNAL_PREFIX}entry.nodes) ${INTERNAL_PREFIX}previousNodes.add(${INTERNAL_PREFIX}node);`,
  );
  push(state, `let ${INTERNAL_PREFIX}reference = ${anchorVar}.nextSibling;`);
  push(
    state,
    `while (${INTERNAL_PREFIX}reference !== null && ${INTERNAL_PREFIX}previousNodes.has(${INTERNAL_PREFIX}reference)) ${INTERNAL_PREFIX}reference = ${INTERNAL_PREFIX}reference.nextSibling;`,
  );
  push(
    state,
    `for (let ${INTERNAL_PREFIX}entryIndex = ${INTERNAL_PREFIX}next.length - 1; ${INTERNAL_PREFIX}entryIndex >= 0; ${INTERNAL_PREFIX}entryIndex--) {`,
  );
  state.indent += 1;
  push(
    state,
    `const ${INTERNAL_PREFIX}entryNodes = ${INTERNAL_PREFIX}next[${INTERNAL_PREFIX}entryIndex].nodes;`,
  );
  push(
    state,
    `for (let ${INTERNAL_PREFIX}nodeIndex = ${INTERNAL_PREFIX}entryNodes.length - 1; ${INTERNAL_PREFIX}nodeIndex >= 0; ${INTERNAL_PREFIX}nodeIndex--) {`,
  );
  state.indent += 1;
  push(
    state,
    `const ${INTERNAL_PREFIX}node = ${INTERNAL_PREFIX}entryNodes[${INTERNAL_PREFIX}nodeIndex];`,
  );
  push(
    state,
    `if (${INTERNAL_PREFIX}node.parentNode !== ${INTERNAL_PREFIX}parent || ${INTERNAL_PREFIX}node.nextSibling !== ${INTERNAL_PREFIX}reference) ${INTERNAL_PREFIX}parent.insertBefore(${INTERNAL_PREFIX}node, ${INTERNAL_PREFIX}reference);`,
  );
  push(state, `${INTERNAL_PREFIX}reference = ${INTERNAL_PREFIX}node;`);
  state.indent -= 1;
  push(state, `}`);
  state.indent -= 1;
  push(state, `}`);
  state.indent -= 1;
  push(state, `}`);
  push(state, `${entriesVar} = ${INTERNAL_PREFIX}next;`);
  state.indent -= 1;
  push(state, '}');

  push(state, `${refreshVar}();`);
  const initialNodesVar = `${INTERNAL_PREFIX}eachInitialNodes${id}`;
  push(state, `const ${initialNodesVar} = [];`);
  push(
    state,
    `for (const ${INTERNAL_PREFIX}entry of ${entriesVar}) for (const ${INTERNAL_PREFIX}node of ${INTERNAL_PREFIX}entry.nodes) ${initialNodesVar}.push(${INTERNAL_PREFIX}node);`,
  );
  sink.push({ kind: 'spread', name: initialNodesVar });
  const subscribed = new Set<string>();
  const uniqueDependencies: Dependency[] = [];
  for (const dependency of [...dependencies, ...keyDependencies]) {
    if (subscribed.has(dependency.name)) continue;
    subscribed.add(dependency.name);
    uniqueDependencies.push(dependency);
  }
  emitDependencySubscriptions(state, uniqueDependencies, refreshVar, node.span);
  registerRefresh(state, refreshVar);
}

function nextName(state: EmitState, prefix: string): string {
  return `${INTERNAL_PREFIX}${prefix}${state.counter.value++}`;
}

function toIrSpan(ref: FunctionExpressionRef): IrSpan {
  return ref.span;
}

function bindingKey(id: BindingId): string {
  return `${id.scope.path}#${id.name}#${id.declarationOrder}`;
}

function recordFor(
  state: EmitState,
  ref: FunctionExpressionRef,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): LoweredExpressionRecord | null {
  const record = records.get(ref.id);
  if (record === undefined) {
    diag(state, 'OEIR_LEAF_MISSING_EXPRESSION', `expression ${ref.id} is not in the registry`, {
      file: '',
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    });
  }
  return record ?? null;
}

/** Declare the host bindings an expression reads (prologue) and validate names. */
function declareReads(state: EmitState, record: LoweredExpressionRecord): boolean {
  for (const read of record.reads) {
    if (read.name === 'props' || read.binding.name === 'props') {
      if (state.propsName === null) {
        diag(
          state,
          'OEIR_LEAF_UNSUPPORTED_PROPS',
          'the leaf slice needs a named props parameter',
          toIrSpan({
            id: record.id,
            mode: record.mode,
            span: record.authoredSpan,
          }),
        );
        return false;
      }
      state.requiredProps.add(state.propsName);
      continue;
    }
    if (
      state.localResources.has(read.name) ||
      state.hostBindings.has(read.name) ||
      state.entryNames.has(read.name)
    ) {
      continue;
    }
    if (!IDENTIFIER_PATTERN.test(read.name) || read.name.startsWith(INTERNAL_PREFIX)) {
      diag(
        state,
        'OEIR_LEAF_INVALID_BINDING',
        `binding '${read.name}' is not a usable identifier`,
        toIrSpan({
          id: record.id,
          mode: record.mode,
          span: record.authoredSpan,
        }),
      );
      return false;
    }
    const resource = state.component.resources.find((candidate) => candidate.name === read.name);
    if (resource !== undefined && resource.kind !== 'local') {
      state.hostBindings.add(read.name);
      state.requiredBindings.add(read.name);
      continue;
    }
    if (resource !== undefined && resource.kind === 'local') {
      state.localResources.add(read.name);
      continue;
    }
    // Builtin/global reads (undefined, Math, ...) are referenced directly; every
    // other name must come from the host binding record.
    if (
      read.value === 'plain' &&
      read.binding.name === read.name &&
      read.binding.scope.path === 'global'
    ) {
      continue;
    }
    state.hostBindings.add(read.name);
    state.requiredBindings.add(read.name);
  }
  return true;
}

interface Dependency {
  readonly name: string;
  /** Props reads refresh through the host `propsChanged` signal (see contract). */
  readonly fromProps: boolean;
}

function dependencyNames(
  state: EmitState,
  record: LoweredExpressionRecord,
): readonly Dependency[] | null {
  const byKey = new Map(record.reads.map((read) => [bindingKey(read.binding), read]));
  const names: Dependency[] = [];
  for (const id of record.dependencies) {
    const read = byKey.get(bindingKey(id));
    if (read === undefined) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_BINDING',
        `tracked expression ${record.id} has a dependency outside its reads`,
        toIrSpan({
          id: record.id,
          mode: record.mode,
          span: record.authoredSpan,
        }),
      );
      return null;
    }
    const fromProps = read.name === 'props';
    if (fromProps) {
      // Per-read props refresh: the leaf contract supplies a `propsChanged`
      // signal (the M04 tracked-props record's version channel analogue). The
      // per-read getter semantics are M06's contract; the leaf slice only
      // proves the refresh plumbing.
      state.requiresPropsChanged = true;
    } else if (!state.hostBindings.has(read.name)) {
      state.hostBindings.add(read.name);
      state.requiredBindings.add(read.name);
    }
    if (!names.some((entry) => entry.name === read.name))
      names.push({ name: read.name, fromProps });
  }
  return names;
}

/**
 * Subscribe one generated refresh closure to the signals a slot's expression
 * reads. Props reads refresh through the mount host's `propDeps` (the defining
 * scope's signals: `host.propsChanged` for a root instance, the parent bindings
 * behind the passed prop expressions for a component-reference instance); every
 * other read binds its named host binding directly.
 */
function emitDependencySubscriptions(
  state: EmitState,
  dependencies: readonly Dependency[],
  refreshVar: string,
  anchor: SpanLike,
): void {
  for (const dependency of dependencies) {
    if (dependency.fromProps) {
      push(
        state,
        `for (const ${MOUNT_DEP_LOOP} of ${state.hostVar}.propDeps) bindSignalWrites(${state.scopeVar}, ${MOUNT_DEP_LOOP}, ${JSON.stringify(dependency.name)}, ${refreshVar});`,
        anchor,
      );
      continue;
    }
    push(
      state,
      `bindSignalWrites(${state.scopeVar}, ${dependency.name}, ${JSON.stringify(dependency.name)}, ${refreshVar});`,
      anchor,
    );
  }
}

function emitTextWrite(state: EmitState, targetVar: string, record: LoweredExpressionRecord): void {
  pushParts(state, [`${targetVar}.nodeValue = displayValue((`, { record }, '));']);
}

function emitAttributeWrite(
  state: EmitState,
  elementVar: string,
  name: string,
  channel: string,
  record: LoweredExpressionRecord,
  anchor: SpanLike,
): void {
  const literal = JSON.stringify(name);
  if (channel === 'boolean') {
    pushParts(
      state,
      [`${elementVar}.toggleAttribute(${literal}, Boolean((`, { record }, ')));'],
      anchor,
    );
    return;
  }
  if (channel === 'property') {
    if (!IDENTIFIER_PATTERN.test(name)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `property '${name}' is not a valid identifier`,
        { file: '', start: 0, end: 0, line: 1, column: 1 },
      );
      return;
    }
    pushParts(state, [`${elementVar}[${literal}] = (`, { record }, ');'], anchor);
    return;
  }
  const valueVar = nextName(state, 'value');
  pushParts(state, [`const ${valueVar} = attributeValueOf((`, { record }, '));'], anchor);
  push(state, `if (${valueVar} === null) ${elementVar}.removeAttribute(${literal});`, anchor);
  push(state, `else {`, anchor);
  push(state, `  assertSafeUrlAttribute(${literal}, ${valueVar});`, anchor);
  push(state, `  ${elementVar}.setAttribute(${literal}, ${valueVar});`, anchor);
  push(state, `}`, anchor);
}

function attributeAdmitted(
  state: EmitState,
  attribute: FunctionModelAttribute,
  span: IrSpan,
): boolean {
  if (attribute.kind === 'static') {
    if (!ATTRIBUTE_PATTERN.test(attribute.name)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `attribute name '${attribute.name}' is invalid`,
        span,
      );
      return false;
    }
    return true;
  }
  if (!ADMITTED_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
      `attribute channel '${attribute.channel}' is outside the leaf slice (M05b/M06 owns it)`,
      span,
    );
    return false;
  }
  return true;
}

/** Validate one prop of a component reference; `key` is consumed before this. */
function componentPropAdmitted(
  state: EmitState,
  attribute: FunctionModelAttribute,
  componentName: string,
  span: IrSpan,
): boolean {
  if (attribute.kind === 'static') {
    if (!ATTRIBUTE_PATTERN.test(attribute.name)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `prop name '${attribute.name}' on component '<${componentName}>' is invalid`,
        span,
      );
      return false;
    }
    return true;
  }
  if (!ADMITTED_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
      `prop channel '${attribute.channel}' on component '<${componentName}>' is outside the M06b1 slice (class/style/innerHTML/event/ref stay refused)`,
      span,
    );
    return false;
  }
  return true;
}

/**
 * Emit one module-local component-reference instance (M06b1a-1).
 *
 * The child body is the module-level `<Child>__mount`, so one component body is
 * emitted once per module however often it is referenced. Each reference owns a
 * fresh child scope (M04 ownership: disposal, rollback and range cleanup are the
 * parent's), the parent appends the returned nodes to the enclosing sink in
 * authored order, and props are a per-read getter record over the DEFINING
 * (parent) scope — `{ get text() { return <parent read>; } }` — never cached.
 * The child refreshes a prop-dependent slot through the defining-scope signals
 * in `host.propDeps`: the parent bindings the passed prop expressions depend on,
 * plus the parent's own props channel when a getter passes a parent prop.
 */
function emitComponentRef(
  state: EmitState,
  node: FunctionModelComponentRef,
  sink: SinkEntry[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const span: IrSpan = node.span;
  const target = state.componentByName.get(node.name);
  if (target === undefined) {
    diag(
      state,
      'OEIR_LEAF_UNKNOWN_COMPONENT',
      `component '<${node.name}>' is not declared in this module (external components are M06b2)`,
      span,
    );
    return;
  }
  if (target.propsParam === null) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
      `component '<${node.name}>' has no named props parameter (destructured or absent); component references need a named props parameter (M06b2 owns destructuring)`,
      span,
    );
    return;
  }
  const ownedBindings = target.resources.filter(
    (resource) => resource.kind === 'signal' || resource.kind === 'computed',
  );
  if (ownedBindings.length > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
      `component '<${node.name}>' owns signal/computed resources; a child instance cannot resolve host bindings without sharing the parent instance (M06b2/M07 own it)`,
      span,
    );
    return;
  }
  // Pass 1: admit the prop DOM channels. `key` is list identity, consumed by the
  // enclosing list emitter and never a DOM write or a child prop.
  let refused = false;
  const admitted: Array<
    | { readonly kind: 'static'; readonly name: string; readonly value: string }
    | {
        readonly kind: 'dynamic';
        readonly name: string;
        readonly expression: FunctionExpressionRef;
        readonly span: SpanLike;
      }
  > = [];
  for (const attribute of node.props) {
    if (attribute.name === 'key') continue;
    if (!componentPropAdmitted(state, attribute, node.name, span)) {
      refused = true;
      continue;
    }
    admitted.push(attribute);
  }
  if (refused) return;

  const id = state.counter.value++;
  const propsVar = `${INTERNAL_PREFIX}childProps${id}`;
  const hostVar = `${INTERNAL_PREFIX}childHost${id}`;
  const scopeVar = `${INTERNAL_PREFIX}childScope${id}`;
  const nodesVar = `${INTERNAL_PREFIX}childNodes${id}`;

  // Pass 2: resolve the dynamic prop expressions (prologue reads + the defining
  // scope dependencies the child refreshes through) before emitting the record,
  // so the block below is one authored-order sequence.
  const propDeps = new Set<string>();
  let needsParentProps = false;
  type ResolvedProp =
    | { readonly kind: 'static'; readonly name: string; readonly value: string }
    | {
        readonly kind: 'dynamic';
        readonly name: string;
        readonly record: LoweredExpressionRecord;
        readonly span: SpanLike;
      };
  const resolved: ResolvedProp[] = [];
  let failed = false;
  for (const prop of admitted) {
    if (prop.kind === 'static') {
      resolved.push(prop);
      continue;
    }
    const record = recordFor(state, prop.expression, records);
    if (record === null || !declareReads(state, record)) {
      failed = true;
      continue;
    }
    const dependencies = dependencyNames(state, record);
    if (dependencies === null) {
      failed = true;
      continue;
    }
    for (const dependency of dependencies) {
      if (dependency.fromProps) needsParentProps = true;
      else propDeps.add(dependency.name);
    }
    resolved.push({
      kind: 'dynamic',
      name: prop.name,
      record,
      span: prop.span,
    });
  }
  if (failed) return;
  if (resolved.length > 0) {
    push(state, `const ${propsVar} = {`, span);
    state.indent += 1;
    for (const prop of resolved) {
      if (prop.kind === 'static') {
        const key = IDENTIFIER_PATTERN.test(prop.name) ? prop.name : JSON.stringify(prop.name);
        push(state, `${key}: ${JSON.stringify(prop.value)},`);
        continue;
      }
      const key = IDENTIFIER_PATTERN.test(prop.name) ? prop.name : JSON.stringify(prop.name);
      pushParts(state, [`get ${key}() { return (`, { record: prop.record }, '); },'], prop.span);
    }
    state.indent -= 1;
    push(state, '};');
  }

  // The child instance's host record: the parent host bindings (so the child
  // resolves its own host reads from the same module-level record) plus the
  // defining-scope signals behind the passed prop expressions.
  const depParts = [...propDeps];
  if (needsParentProps) depParts.push(`...${state.hostVar}.propDeps`);
  push(
    state,
    `const ${hostVar} = { bindings: ${state.hostVar}.bindings, propDeps: [${depParts.join(', ')}] };`,
    span,
  );

  // Fresh child scope, exception-safe mount, range cleanup before the parent can
  // append: the same ownership mapping the M04 mount contract uses.
  push(state, `const ${scopeVar} = ${state.scopeVar}.child();`, span);
  push(state, `let ${nodesVar};`);
  push(state, `try {`);
  state.indent += 1;
  push(
    state,
    `${nodesVar} = ${node.name}${MOUNT_SUFFIX}(${scopeVar}, ${resolved.length > 0 ? propsVar : '{}'}, ${hostVar});`,
    span,
  );
  state.indent -= 1;
  push(state, `} catch (error) { ${scopeVar}.dispose(true); throw error; }`);
  push(state, `${scopeVar}.addRangeCleanup(() => removeNodes(${nodesVar}));`);
  sink.push({ kind: 'spread', name: nodesVar });
}

function emitNode(
  state: EmitState,
  node: FunctionModelNode,
  sink: SinkEntry[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const span: IrSpan = node.span;
  if (node.kind === 'text') {
    const varName = nextName(state, 'text');
    push(
      state,
      `const ${varName} = document.createTextNode(${JSON.stringify(node.value)});`,
      node.span,
    );
    sink.push({ kind: 'node', name: varName });
    return;
  }
  if (node.kind === 'fragment') {
    for (const child of node.children) emitNode(state, child, sink, records);
    return;
  }
  if (node.kind === 'condition') {
    emitCondition(state, node, sink, records);
    return;
  }
  if (node.kind === 'list') {
    emitList(state, node, sink, records);
    return;
  }
  if (node.kind === 'element') {
    if (!TAG_PATTERN.test(node.tag)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_TAG',
        `tag '${node.tag}' is not a plain intrinsic element name`,
        span,
      );
      return;
    }
    const varName = nextName(state, 'el');
    push(
      state,
      `const ${varName} = document.createElement(${JSON.stringify(node.tag)});`,
      node.span,
    );
    for (const attribute of node.attributes) {
      if (attribute.kind === 'dynamic' && CONSUMED_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
        // `key` is list identity, consumed by the enclosing list emitter; it is
        // never written to the DOM as an attribute.
        continue;
      }
      if (!attributeAdmitted(state, attribute, span)) continue;
      if (attribute.kind === 'static') {
        if (unsafeStreamFrameAttribute(attribute.name, attribute.value)) {
          diag(
            state,
            'OEIR_LEAF_UNSAFE_ATTRIBUTE',
            `static URL attribute '${attribute.name}' carries a script-bearing scheme`,
            span,
          );
          continue;
        }
        push(
          state,
          `${varName}.setAttribute(${JSON.stringify(attribute.name)}, ${JSON.stringify(attribute.value)});`,
          attribute.span,
        );
        continue;
      }
      const record = recordFor(state, attribute.expression, records);
      if (record === null || !declareReads(state, record)) continue;
      const dependencies = dependencyNames(state, record);
      if (dependencies === null) continue;
      if (dependencies.length === 0) {
        emitAttributeWrite(
          state,
          varName,
          attribute.name,
          attribute.channel,
          record,
          attribute.span,
        );
        continue;
      }
      const refresh = nextName(state, 'refresh');
      push(state, `function ${refresh}() {`, attribute.span);
      state.indent += 1;
      emitAttributeWrite(state, varName, attribute.name, attribute.channel, record, attribute.span);
      state.indent -= 1;
      push(state, `}`);
      push(state, `${refresh}();`);
      emitDependencySubscriptions(state, dependencies, refresh, attribute.span);
      registerRefresh(state, refresh);
    }
    for (const child of node.children) {
      const childSink: SinkEntry[] = [];
      emitNode(state, child, childSink, records);
      appendSinkToElement(state, childSink, varName);
    }
    sink.push({ kind: 'node', name: varName });
    return;
  }
  if (node.kind === 'dynamic-text') {
    const record = recordFor(state, node.expression, records);
    if (record === null || !declareReads(state, record)) return;
    const dependencies = dependencyNames(state, record);
    if (dependencies === null) return;
    const textVar = nextName(state, 'text');
    push(state, `const ${textVar} = document.createTextNode("");`, node.span);
    sink.push({ kind: 'node', name: textVar });
    if (dependencies.length === 0) {
      emitTextWrite(state, textVar, record);
      return;
    }
    const refresh = nextName(state, 'refresh');
    push(state, `function ${refresh}() {`, node.span);
    state.indent += 1;
    emitTextWrite(state, textVar, record);
    state.indent -= 1;
    push(state, `}`);
    push(state, `${refresh}();`);
    emitDependencySubscriptions(state, dependencies, refresh, node.span);
    registerRefresh(state, refresh);
    return;
  }
  if (node.kind === 'component-ref') {
    emitComponentRef(state, node, sink, records);
    return;
  }
  diag(
    state,
    'OEIR_LEAF_UNSUPPORTED_NODE',
    `node '${node.kind}' is outside the M06b1 slice (recipes/insertion sites and children projection are M06b1a-2/M06b1a-3)`,
    span,
  );
}

interface EmittedComponent {
  readonly lines: string[];
  readonly diagnostics: readonly IrDiagnostic[];
  readonly requiredBindings: readonly string[];
  readonly requiredProps: readonly string[];
  readonly requiresPropsChanged: boolean;
  readonly segments: readonly EmissionSegment[];
  readonly placements: readonly ExpressionPlacement[];
}

function emitComponent(
  file: string,
  component: FunctionModelComponent,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
): EmittedComponent {
  const propsName = component.propsParam;
  const state: EmitState = {
    component,
    lines: [],
    indent: 1,
    diagnostics: [],
    requiredBindings: new Set(),
    requiredProps: new Set(),
    hostBindings: new Set(),
    localResources: new Set(),
    counter: { value: 0 },
    propsName,
    requiresPropsChanged: false,
    segments: [],
    placements: [],
    segmentKeys: new Set(),
    scopeVar: MOUNT_SCOPE,
    hostVar: MOUNT_HOST,
    componentByName,
    entryNames: new Set(),
    refreshStack: [],
  };
  if (
    propsName !== null &&
    (!IDENTIFIER_PATTERN.test(propsName) || propsName.startsWith(INTERNAL_PREFIX))
  ) {
    diag(state, 'OEIR_LEAF_INVALID_BINDING', `props parameter '${propsName}' is not usable`, {
      file,
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    });
  }
  // Resources: signal/computed names are host bindings; local snapshots are
  // evaluated inside the mount (setup mode), preserving M03 semantics.
  const localLines: Array<{
    name: string;
    record: LoweredExpressionRecord;
    span: SpanLike;
  }> = [];
  for (const resource of component.resources) {
    if (!IDENTIFIER_PATTERN.test(resource.name) || resource.name.startsWith(INTERNAL_PREFIX)) {
      diag(
        state,
        'OEIR_LEAF_INVALID_BINDING',
        `resource '${resource.name}' is not usable`,
        resource.span,
      );
      continue;
    }
    if (resource.kind === 'local') {
      if (resource.expression === null) continue;
      const record = recordFor(state, resource.expression, records);
      if (record === null) continue;
      if (!declareReads(state, record)) continue;
      state.localResources.add(resource.name);
      localLines.push({ name: resource.name, record, span: resource.span });
      continue;
    }
    state.hostBindings.add(resource.name);
    state.requiredBindings.add(resource.name);
  }
  if (state.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      segments: [],
      placements: [],
    };
  }
  if (component.recipes.length > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_RECIPE',
      'nested recipes/insertion sites are outside the M06b1a-1 slice (M06b1a-2 owns them)',
      { file, start: 0, end: 0, line: 1, column: 1 },
    );
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      segments: [],
      placements: [],
    };
  }
  if (!IDENTIFIER_PATTERN.test(component.name) || component.name.startsWith(INTERNAL_PREFIX)) {
    diag(
      state,
      'OEIR_LEAF_INVALID_COMPONENT',
      `component '${component.name}' is not usable`,
      component.span,
    );
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      segments: [],
      placements: [],
    };
  }

  push(state, `const ${INTERNAL_PREFIX}nodes = [];`);
  for (const line of localLines) {
    pushParts(state, [`const ${line.name} = (`, { record: line.record }, ');'], line.span);
  }
  for (const root of component.roots) {
    const sink: SinkEntry[] = [];
    emitNode(state, root, sink, records);
    appendSinkToArray(state, sink, `${INTERNAL_PREFIX}nodes`);
  }
  push(state, `return ${INTERNAL_PREFIX}nodes;`);

  // The component body lives in one module-level mount so a component reference
  // and the exported root factory share exactly one emitted body per module.
  const mountPrologue: string[] = [
    `function ${component.name}${MOUNT_SUFFIX}(${MOUNT_SCOPE}, ${MOUNT_PROPS}, ${MOUNT_HOST}) {`,
  ];
  if (propsName !== null) {
    mountPrologue.push(`  const ${propsName} = ${MOUNT_PROPS};`);
    state.requiredProps.add(propsName);
  }
  if (state.requiredBindings.size > 0) {
    mountPrologue.push(
      `  const ${INTERNAL_PREFIX}requireBinding = (name) => { const value = ${MOUNT_HOST}.bindings[name]; if (value === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: " + name); return value; };`,
    );
    for (const binding of [...state.requiredBindings].sort()) {
      mountPrologue.push(
        `  const ${binding} = ${INTERNAL_PREFIX}requireBinding(${JSON.stringify(binding)});`,
      );
    }
  }
  const mountHostVar = `${INTERNAL_PREFIX}mountHost`;
  const factoryLines: string[] = [
    `export function create${component.name}Recipe(${INTERNAL_PREFIX}owner, ${INTERNAL_PREFIX}host) {`,
  ];
  if (state.requiresPropsChanged) {
    // The root instance's defining scope is the host props channel: the
    // original OEIR_LEAF_MISSING_VALUE contract stays at factory creation.
    factoryLines.push(
      `  const ${INTERNAL_PREFIX}propsChanged = ${INTERNAL_PREFIX}host.propsChanged; if (${INTERNAL_PREFIX}propsChanged === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: propsChanged");`,
    );
    factoryLines.push(
      `  const ${mountHostVar} = { bindings: ${INTERNAL_PREFIX}host.bindings, propDeps: [${INTERNAL_PREFIX}propsChanged] };`,
    );
  } else {
    factoryLines.push(
      `  const ${mountHostVar} = { bindings: ${INTERNAL_PREFIX}host.bindings, propDeps: [] };`,
    );
  }
  factoryLines.push(
    '  return createRecipe({',
    `    definitionOwner: ${INTERNAL_PREFIX}owner,`,
    `    source: ${JSON.stringify(`${file}#${component.name}`)},`,
    '    mount(__oe_scope) {',
    `      return ${component.name}${MOUNT_SUFFIX}(${MOUNT_SCOPE}, ${INTERNAL_PREFIX}host.props, ${mountHostVar});`,
    '    },',
    '  });',
    '}',
    '',
  );
  const mountLines = [...mountPrologue, ...state.lines, '}', ''];
  const shift = mountPrologue.length;
  return {
    lines: [...mountLines, ...factoryLines],
    diagnostics: state.diagnostics,
    requiredBindings: [...state.requiredBindings].sort(),
    requiredProps: [...state.requiredProps].sort(),
    requiresPropsChanged: state.requiresPropsChanged,
    segments: state.segments.map((segment) => ({
      ...segment,
      generatedLine: segment.generatedLine + shift,
    })),
    placements: state.placements.map((placement) => ({
      ...placement,
      generatedLine: placement.generatedLine + shift,
    })),
  };
}

/** Fail-closed parse check of the emitted module text (no execution). */
function parsesAsModule(text: string): boolean {
  const source = ts.createSourceFile(
    'generated-leaf.js',
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = (source as unknown as { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics;
  return (parseDiagnostics ?? []).length === 0;
}

/**
 * Emit the generated leaf module for one M03 `FunctionModelModule`.
 * Deterministic for the same model/registry; unsupported shapes fail closed.
 */
export function generateLeafModule(
  module: FunctionModelModule,
  options: { readonly authoredSource?: string } = {},
): GeneratedLeafModule {
  const records = new Map(module.expressions.expressions.map((record) => [record.id, record]));
  if (module.components.length === 0) {
    return {
      module: null,
      sourceMap: null,
      placements: [],
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'OEIR_LEAF_MISSING_COMPONENT',
          message: 'the module has no function component to generate',
          span: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
          origin: 'module',
        },
      ],
    };
  }
  const componentByName = new Map(
    module.components.map((component) => [component.name, component] as const),
  );
  const chunks: string[] = [];
  const diagnostics: IrDiagnostic[] = [];
  const requiredBindings = new Set<string>();
  const requiredProps = new Set<string>();
  const segments: EmissionSegment[] = [];
  const placements: ExpressionPlacement[] = [];
  let requiresPropsChanged = false;
  for (const component of module.components) {
    const emitted = emitComponent(module.file, component, records, componentByName);
    diagnostics.push(...emitted.diagnostics);
    if (emitted.diagnostics.length > 0) continue;
    for (const name of emitted.requiredBindings) requiredBindings.add(name);
    for (const name of emitted.requiredProps) requiredProps.add(name);
    requiresPropsChanged ||= emitted.requiresPropsChanged;
    // Component chunks are concatenated in module order: rebase this component's
    // segment/placement lines onto the lines already emitted before it.
    const lineOffset = chunks.length;
    segments.push(
      ...emitted.segments.map((segment) => ({
        ...segment,
        generatedLine: segment.generatedLine + lineOffset,
      })),
    );
    placements.push(
      ...emitted.placements.map((placement) => ({
        ...placement,
        generatedLine: placement.generatedLine + lineOffset,
      })),
    );
    chunks.push(...emitted.lines);
  }
  if (diagnostics.length > 0) {
    return {
      module: null,
      sourceMap: null,
      placements: [...placements],
      requiredBindings: [...requiredBindings].sort(),
      requiredProps: [...requiredProps].sort(),
      requiresPropsChanged,
      diagnostics,
    };
  }
  const headerLines = [
    '// <generated by openelement M06b1 leaf-codegen v2; do not edit>',
    `import { ${RUNTIME_IMPORTS.join(', ')} } from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};`,
    '',
  ];
  const text = [...headerLines, ...chunks].join('\n');
  if (!parsesAsModule(text)) {
    return {
      module: null,
      sourceMap: null,
      placements: [...placements],
      requiredBindings: [...requiredBindings].sort(),
      requiredProps: [...requiredProps].sort(),
      requiresPropsChanged,
      diagnostics: [
        {
          severity: 'error',
          code: 'OEIR_LEAF_INVALID_ARTIFACT',
          message: 'the emitted module does not parse as JavaScript',
          span: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
          origin: 'module',
        },
      ],
    };
  }
  const headerShift = headerLines.length;
  const moduleSegments = segments.map((segment) => ({
    ...segment,
    generatedLine: segment.generatedLine + headerShift,
  }));
  const modulePlacements = placements.map((placement) => ({
    ...placement,
    generatedLine: placement.generatedLine + headerShift,
  }));
  let sourceMap: CompiledElementSourceMap | null = null;
  if (options.authoredSource !== undefined) {
    const builder = new SourceMapSegmentBuilder();
    for (const segment of moduleSegments) builder.add(segment);
    sourceMap = builder.build(module.file, options.authoredSource);
  }
  return {
    module: text,
    sourceMap,
    placements: modulePlacements,
    requiredBindings: [...requiredBindings].sort(),
    requiredProps: [...requiredProps].sort(),
    requiresPropsChanged,
    diagnostics: [],
  };
}
