/**
 * M06b2a — generated leaf/component mount with reusable JSX values and
 * component children projection (compiler-private).
 *
 * Consumes the merged M03 `FunctionModelModule` + `ExpressionRegistry` (never
 * re-derives resolution, lowering or erasure) and emits a real JavaScript
 * module whose `mount(scope)` builds detached DOM using the M04 runtime
 * primitives: one `createRecipe` per leaf component/recipe, `insertRecipe` at
 * every insertion site, `bindSignalWrites` for tracked slots, and the canonical
 * `displayValue`/`attributeValueOf`/`assertSafeUrlAttribute` value semantics.
 * The harness inserts generated root recipes through `insertRecipe` — the one
 * insertion surface.
 *
 * S1/M06a leaf + S2 scope: intrinsic elements, fragments, multi-root, empty
 * output, static text/attributes, dynamic text and `attribute`/`boolean`/
 * `property` channel attributes with signal/computed driven refresh,
 * conditions, lists, default + detach disposal, throwing cleanups, (M06b1a-1)
 * module-level component mounts plus module-local component references
 * (`<Child prop={expr}/>`), and (M06b1a-2) reusable JSX values: one recipe per
 * direct component-local JSX initializer and one `insertRecipe` projection per
 * `{name}` slot, and (M06b2a) component children projection: `<Frame>…</Frame>`
 * passes one children fragment recipe per reference site as `props.children`, and
 * every `{props.children}` in the child mount is its own `insertRecipe`
 * projection (own child owner, instance, cleanup) of that same recipe value.
 * One component body is emitted exactly once per module:
 * `function <Name>__mount(scope, props, host)` builds a detached instance and
 * returns its nodes; the exported `create<Name>Recipe(owner, host)` factory
 * keeps its name/signature and delegates its recipe mount to it, and a
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
 * Still fails closed with a coded diagnostic (M06b2b/M07/M08 boundary): recipes
 * that are not a direct component-local JSX initializer (JSX inside an
 * arbitrary expression lowers to a `__oe_recipe_ref` placeholder that the
 * generated module cannot execute — `OEIR_LEAF_UNSUPPORTED_RECIPE`),
 * component references to unknown/external components,
 * mount cycles through component references or recipe targets
 * (`OEIR_LEAF_COMPONENT_CYCLE` / `OEIR_LEAF_RECIPE_CYCLE`; a cycle would emit
 * self-recursive mounts), component references inside list entry templates (a
 * keyed reuse would keep the first mount's props without the child update hook —
 * M06b1b), child components with no named props parameter (destructured or
 * absent) or with signal/computed resources, `class`/`style`/`innerHTML`/
 * `event`/`ref` channels (on elements and on component props), and `key` as a
 * DOM write. `key` on a component reference is consumed as list identity only
 * and is never a DOM write or a child prop.
 *
 * M06b2a children recipes: the children node list of `<Frame>…</Frame>` is
 * emitted as one `createRecipe` per reference site with the definition owner =
 * the mount scope the reference is emitted in (`source:
 * "<file>#<Parent>:children<N>"`), and the child instance receives it as a plain
 * `children` property on its props record — never a data attribute and never a
 * per-read getter. The child mount reads `__oe_props.children` ONCE, fails
 * closed with `OEIR_LEAF_MISSING_CHILDREN` when it is not a recipe (the
 * host-supplied root instance boundary; a plain value must not render nothing),
 * and projects it at each `{props.children}` site through the M06b1a-2
 * `DocumentFragment` + `insertRecipe` mechanism. The child instance scope is a
 * live descendant of the defining owner, so the M04 projection lineage admits;
 * two sites are two owners/instances/regions. A reference to a
 * children-projecting component without JSX children fails closed statically
 * with the same code; children on a reference inside a reusable recipe body are
 * refused (`OEIR_LEAF_UNSUPPORTED_CHILDREN`: the children recipe's definition
 * owner would be the per-insertion recipe instance scope), as is a
 * `{props.children}` projection inside a recipe body (`OEIR_LEAF_UNSUPPORTED_NODE`);
 * the mount graph adds the conservative projection edge
 * `c:<Child> -> r:<Definer>:<childrenRecipeId>` so a component projecting the
 * children of a reference back to itself is a refused `OEIR_LEAF_RECIPE_CYCLE`.
 *
 * M06b1a-2 reusable JSX values: one `createRecipe` per component-local direct
 * JSX initializer that at least one insertion site references, emitted inline
 * in the component chunk with its own recipe scope so lowered expressions keep
 * the A2 segments/placement ledger and refresh subscriptions bind on the recipe
 * instance. Every `{name}` slot becomes a `DocumentFragment` + `insertRecipe`
 * call on the inserting scope (component mount, condition-branch scope or
 * list-entry scope — all live descendants of the definition owner, the M04
 * lineage rule); the projection's `nodes` are spread into the enclosing sink in
 * authored order. Insertion sites inside recipe bodies are admitted because the
 * recipe scope handed to a mount is always a descendant of the same definition
 * owner; a recipe-target insertion cycle is refused before emission.
 *
 * The emitted module imports from the compiler-private runtime entry
 * `@openelement/element/internal/compiled/runtime`. That entry is not a
 * published subpath yet (the narrow ABI is a later milestone); the browser
 * harness bundles the same M04 modules under the same names, so the artifact
 * under test uses the real primitives, not stubs.
 *
 * NOT claimed here: real-browser execution evidence for the M06b2a children
 * projection shapes and the repeated-projection isolation, unkeyed browser
 * scenarios, browser evidence for the M06b1a-2 projection shapes (M06b2b),
 * claim/SSR (M07/M08), production wiring, ABI/public API.
 */

import ts from 'typescript';
import { unsafeStreamFrameAttribute } from '@openelement/protocol/stream-frame-policy';
import type {
  FunctionExpressionRef,
  FunctionModelAttribute,
  FunctionModelChildrenProjection,
  FunctionModelComponent,
  FunctionModelComponentRef,
  FunctionModelCondition,
  FunctionModelInsertionSite,
  FunctionModelList,
  FunctionModelModule,
  FunctionModelNode,
  FunctionModelRecipe,
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
  'insertRecipe',
  'removeNodes',
] as const;

const INTERNAL_PREFIX = '__oe_';
/**
 * The M02 marked-printer placeholder for a JSX value lowered inside an
 * expression (`__oe_recipe_ref("id")`). The function model keeps the recipe
 * identity for the M02 §recipe model, but the generated leaf module can only
 * execute recipes created by a direct component-local JSX initializer, so any
 * lowered record carrying this placeholder fails closed.
 */
const RECIPE_REFERENCE_CALLEE = '__oe_recipe_ref';
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
  /**
   * Recipe ids declared by a direct component-local JSX initializer (the model
   * `resource.recipeId` link). An insertion site may only target one of these;
   * a recipe created inside an arbitrary expression is never an insertion site.
   */
  readonly declaredRecipeIds: ReadonlySet<string>;
  /**
   * Component-local names bound to a reusable JSX value. Such a name is not a
   * readable value: it may only appear as a `{name}` JSX child (insertion
   * site), never inside an expression.
   */
  readonly recipeNames: ReadonlySet<string>;
  /** Recipe id → generated recipe variable for the component being emitted. */
  readonly recipeVars: Map<string, string>;
  /** Entry-mapper names bound in the current generated builder (not host bindings). */
  readonly entryNames: Set<string>;
  /** Refresh-function collectors for the enclosing list-entry builder (if any). */
  readonly refreshStack: string[][];
  /**
   * Number of enclosing list-entry templates. A component reference inside one
   * is refused: a keyed reuse re-assigns the mapper parameter but the child
   * instance has no update hook to re-read its props (M06b1b).
   */
  listDepth: number;
  /**
   * Number of enclosing reusable-recipe mount bodies being emitted (M06b2a). A
   * children recipe or a children projection inside one is refused: the recipe
   * instance scope exists per insertion, so the child/children recipe's
   * definition-owner story is not established by this slice.
   */
  recipeDepth: number;
  /**
   * The component mount's one `__oe_props.children` read (M06b2a), or `null` when
   * the component projects no children. Declared before the reusable recipes so
   * a projection inside a recipe body could close over it; every projection site
   * inserts through this one recipe value.
   */
  childrenRecipeVar: string | null;
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
  | { readonly kind: 'spread'; readonly name: string }
  /** One M04 projection (M06b1a-2): spread `projection.nodes` into the sink. */
  | { readonly kind: 'projection'; readonly name: string };

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
    else if (entry.kind === 'projection')
      push(
        state,
        `for (const ${INTERNAL_PREFIX}child of ${entry.name}.nodes) ${targetVar}.appendChild(${INTERNAL_PREFIX}child);`,
      );
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
    else if (entry.kind === 'projection')
      push(
        state,
        `for (const ${INTERNAL_PREFIX}child of ${entry.name}.nodes) ${targetVar}.push(${INTERNAL_PREFIX}child);`,
      );
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
  state.listDepth += 1;
  try {
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
  } finally {
    state.listDepth -= 1;
  }

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
    return null;
  }
  // M06b1a-2 boundary: only a direct component-local JSX initializer becomes a
  // reusable recipe. A JSX value lowered inside an arbitrary expression keeps
  // its `__oe_recipe_ref(...)` placeholder, which has no generated definition
  // and no insertion site; emitting it would produce a module that cannot run.
  if (record.lowered.includes(RECIPE_REFERENCE_CALLEE)) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_RECIPE',
      'a JSX value inside an expression lowers to a recipe reference, but this slice only ' +
        'admits direct component-local JSX initializers (`const x = <div/>;` + `{x}`); ' +
        'move the JSX to a direct initializer or keep it as a JSX child',
      toIrSpan(ref),
    );
    return null;
  }
  return record;
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
    // A reusable JSX value is a recipe, not a readable value: it only appears
    // as a `{name}` JSX child (an insertion site), never inside an expression.
    // The enclosing-builder check above wins first, so a list mapper parameter
    // shadowing the component-local name stays an entry read.
    if (state.recipeNames.has(read.name)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_RECIPE',
        `'${read.name}' is a reusable JSX value; it can only be projected with {${read.name}} in JSX child position, not read as an expression value`,
        toIrSpan({
          id: record.id,
          mode: record.mode,
          span: record.authoredSpan,
        }),
      );
      return false;
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
  if (state.listDepth > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
      `component '<${node.name}>' inside a list entry template needs the child update hook (M06b1b); a keyed reuse would keep the first mount's props`,
      span,
    );
    return;
  }
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
  // Children recipe (M06b2a). The definition site is the mount scope the ref is
  // emitted in: a ref inside a reusable recipe body would need the children
  // recipe to be created per insertion (its definition owner is the recipe
  // instance scope), so that nesting stays refused with a stated reason.
  if (node.childrenRecipeId !== null && state.recipeDepth > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_CHILDREN',
      `children on '<${node.name}>' inside a reusable JSX value body are outside the M06b2a slice: the children recipe would be created once per component mount, but its definition owner is the recipe instance scope (created per insertion)`,
      span,
    );
    return;
  }
  // A component that projects `props.children` statically needs a recipe: a
  // reference without JSX children would mount with an absent recipe (the
  // runtime check below documents the host/root case). Fail closed at compile
  // time where the absence is known.
  if (node.childrenRecipeId === null && componentProjectsChildren(target)) {
    diag(
      state,
      'OEIR_LEAF_MISSING_CHILDREN',
      `component '<${node.name}>' projects props.children but this reference passes no JSX children; every projection needs a children recipe`,
      span,
    );
    return;
  }
  const childrenRecipeVar =
    node.childrenRecipeId === null ? null : (state.recipeVars.get(node.childrenRecipeId) ?? null);
  if (node.childrenRecipeId !== null && childrenRecipeVar === null) {
    diag(
      state,
      'OEIR_LEAF_MISSING_RECIPE',
      `children recipe '${node.childrenRecipeId}' of '<${node.name}>' has no emitted recipe (it is not reachable from any admitted root)`,
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
    if (attribute.name === 'children') {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_COMPONENT',
        `'children' on component '<${node.name}>' must be authored as JSX children, not a prop value: it is the recipe projection channel (JSX value model §4.4)`,
        span,
      );
      refused = true;
      continue;
    }
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
  if (resolved.length > 0 || childrenRecipeVar !== null) {
    push(state, `const ${propsVar} = {`, span);
    state.indent += 1;
    // The children channel is a plain property holding the recipe object, not a
    // per-read getter: inserting it (and refreshing its dynamic content) is the
    // children recipe body's own subscription work (M06b2a).
    if (childrenRecipeVar !== null) push(state, `children: ${childrenRecipeVar},`, span);
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
    `${nodesVar} = ${node.name}${MOUNT_SUFFIX}(${scopeVar}, ${resolved.length > 0 || childrenRecipeVar !== null ? propsVar : '{}'}, ${hostVar});`,
    span,
  );
  state.indent -= 1;
  push(state, `} catch (error) { ${scopeVar}.dispose(true); throw error; }`);
  push(state, `${scopeVar}.addRangeCleanup(() => removeNodes(${nodesVar}));`);
  sink.push({ kind: 'spread', name: nodesVar });
}

/**
 * Collect the recipe ids referenced by at least one insertion site reachable
 * from the component roots (M06b1a-2). Delivery is transitive: a site inside a
 * recipe body keeps the referenced recipe alive, while a direct declaration no
 * admitted site reaches is not emitted at all.
 */
function referencedRecipeIds(component: FunctionModelComponent): Set<string> {
  const byId = new Map(component.recipes.map((recipe) => [recipe.id, recipe] as const));
  const referenced = new Set<string>();
  const pending: string[] = [];
  const collect = (nodes: readonly FunctionModelNode[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'insertion-site':
          if (!referenced.has(node.recipeId)) {
            referenced.add(node.recipeId);
            pending.push(node.recipeId);
          }
          break;
        case 'component-ref':
          // A component reference with JSX children passes its children recipe
          // as `props.children` (M06b2a): it must be emitted wherever the ref is.
          if (node.childrenRecipeId !== null && !referenced.has(node.childrenRecipeId)) {
            referenced.add(node.childrenRecipeId);
            pending.push(node.childrenRecipeId);
          }
          break;
        case 'element':
        case 'fragment':
          collect(node.children);
          break;
        case 'condition':
          collect(node.consequent);
          if (node.alternate !== null) collect(node.alternate);
          break;
        case 'list':
          collect(node.template);
          break;
        default:
          break;
      }
    }
  };
  collect(component.roots);
  while (pending.length > 0) {
    const recipe = byId.get(pending.pop()!);
    if (recipe !== undefined) collect([recipe.target]);
  }
  return referenced;
}

/**
 * Does this component's mount project `props.children`? Only roots (and their
 * condition/list builders) count: a projection inside a reusable recipe body is
 * refused (`recipeDepth`), so the mount-level read is needed exactly when a
 * projection is reachable from the roots (M06b2a).
 */
function componentProjectsChildren(component: FunctionModelComponent): boolean {
  const walk = (nodes: readonly FunctionModelNode[]): boolean => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'children-projection':
          return true;
        case 'element':
        case 'fragment':
          if (walk(node.children)) return true;
          break;
        case 'condition':
          if (walk(node.consequent)) return true;
          if (node.alternate !== null && walk(node.alternate)) return true;
          break;
        case 'list':
          if (walk(node.template)) return true;
          break;
        default:
          break;
      }
    }
    return false;
  };
  return walk(component.roots);
}

/** One `childrenRecipeId` projection edge (M06b2a mount-graph input). */
interface ChildrenProjectionEdge {
  /** The component whose mount projects the children recipe (the child). */
  readonly projectingComponent: string;
  /** The defining component whose recipe it is, and the recipe id. */
  readonly definingComponent: string;
  readonly recipeId: string;
  readonly span: IrSpan;
}

/**
 * Collect every `<Child>…</Child>` reference site in one component's roots: the
 * child mount will project that children recipe whenever `<Child>` itself
 * projects `props.children` (M06b2a). Used by `findMountCycle` to add the
 * conservative projection edge `c:<Child> -> r:<defining>:<childrenRecipeId>`,
 * so a component that projects the children of a reference back to itself is
 * refused instead of emitting an unbounded mount.
 */
function collectChildrenProjectionEdges(
  component: FunctionModelComponent,
  out: ChildrenProjectionEdge[],
): void {
  const walk = (nodes: readonly FunctionModelNode[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'component-ref':
          if (node.childrenRecipeId !== null) {
            out.push({
              projectingComponent: node.name,
              definingComponent: component.name,
              recipeId: node.childrenRecipeId,
              span: node.span,
            });
          }
          break;
        case 'element':
        case 'fragment':
          walk(node.children);
          break;
        case 'condition':
          walk(node.consequent);
          if (node.alternate !== null) walk(node.alternate);
          break;
        case 'list':
          walk(node.template);
          break;
        default:
          break;
      }
    }
  };
  walk(component.roots);
}

/** One recipe's generated names plus its model entry. */
interface PlannedRecipe {
  readonly recipe: FunctionModelRecipe;
  readonly recipeVar: string;
  readonly scopeVar: string;
  readonly nodesVar: string;
}

/**
 * Emit one `createRecipe` per referenced reusable JSX value (M06b1a-2).
 *
 * The mount body stays inline in the component chunk with its own recipe scope:
 * lowered expressions keep their A2 segments/placements (the per-chunk line
 * rebase is unchanged) and refresh subscriptions bind on the recipe instance.
 * Recipe variables are published before any body is emitted so an insertion
 * site inside another recipe body can reference any referenced recipe; the
 * recipe graph is acyclic (`findMountCycle` refuses cycles before emission).
 */
function emitRecipes(
  state: EmitState,
  file: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const referenced = referencedRecipeIds(state.component);
  if (referenced.size === 0) return;
  const plans: PlannedRecipe[] = [];
  for (const recipe of state.component.recipes) {
    if (!referenced.has(recipe.id)) continue;
    const plan: PlannedRecipe = {
      recipe,
      recipeVar: nextName(state, 'recipe'),
      scopeVar: nextName(state, 'recipeScope'),
      nodesVar: nextName(state, 'recipeNodes'),
    };
    state.recipeVars.set(recipe.id, plan.recipeVar);
    plans.push(plan);
  }
  // One createRecipe per value, in model (authored declaration) order.
  for (const plan of plans) {
    const { recipe } = plan;
    push(state, `const ${plan.recipeVar} = createRecipe({`, recipe.span);
    state.indent += 1;
    push(state, `definitionOwner: ${MOUNT_SCOPE},`);
    push(
      state,
      `source: ${JSON.stringify(`${file}#${state.component.name}:${recipe.id.replace(/^#/, '')}`)},`,
    );
    push(state, `mount(${plan.scopeVar}) {`, recipe.span);
    state.indent += 1;
    push(state, `const ${plan.nodesVar} = [];`);
    const outerScope = state.scopeVar;
    state.scopeVar = plan.scopeVar;
    state.recipeDepth += 1;
    const sink: SinkEntry[] = [];
    emitNode(state, recipe.target, sink, records);
    appendSinkToArray(state, sink, plan.nodesVar);
    state.recipeDepth -= 1;
    state.scopeVar = outerScope;
    push(state, `return ${plan.nodesVar};`);
    state.indent -= 1;
    push(state, '},');
    state.indent -= 1;
    push(state, '});');
  }
}

/**
 * Emit one insertion site (M06b1a-2): a temporary `DocumentFragment` target,
 * one M04 `insertRecipe` projection on the current builder scope, and a sink
 * entry spreading the projection's `nodes` into the enclosing sink in authored
 * order. The fragment is only the insertion target: M04 registers a
 * parentNode-based `removeNodes(nodes)` range cleanup, so moving the nodes into
 * their final parent keeps the default-dispose-keeps-DOM / `dispose(true)`
 * region contract.
 */
function emitInsertionSite(
  state: EmitState,
  node: FunctionModelInsertionSite,
  sink: SinkEntry[],
): void {
  if (!state.declaredRecipeIds.has(node.recipeId)) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_RECIPE',
      `insertion site '${node.recipeId}' does not target a direct component-local JSX initializer; only those values are reusable recipes in this slice`,
      node.span,
    );
    return;
  }
  const recipeVar = state.recipeVars.get(node.recipeId);
  if (recipeVar === undefined) {
    diag(
      state,
      'OEIR_LEAF_MISSING_RECIPE',
      `insertion site '${node.recipeId}' has no emitted recipe (the value is not reachable from any admitted root)`,
      node.span,
    );
    return;
  }
  const fragmentVar = nextName(state, 'insertTarget');
  const projectionVar = nextName(state, 'projection');
  push(state, `const ${fragmentVar} = document.createDocumentFragment();`, node.span);
  push(
    state,
    `const ${projectionVar} = insertRecipe(${state.scopeVar}, ${recipeVar}, ${fragmentVar});`,
    node.span,
  );
  sink.push({ kind: 'projection', name: projectionVar });
}

/**
 * Emit one `{props.children}` projection (M06b2a, JSX value model §4.4): the
 * mount's single `__oe_props.children` recipe inserted through the SAME
 * `DocumentFragment` + `insertRecipe` mechanism as an insertion site, on the
 * current builder scope (a live descendant of the defining owner, so the M04
 * projection lineage admits). Every site is an independent projection — two
 * sites against one recipe variable are two owners, two instances, two
 * cleanups. Refresh of dynamic children content belongs to the children
 * recipe body's own subscriptions; nothing here re-reads the child props.
 */
function emitChildrenProjection(
  state: EmitState,
  node: FunctionModelChildrenProjection,
  sink: SinkEntry[],
): void {
  if (state.recipeDepth > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_NODE',
      `children projection inside a reusable JSX value body is outside the M06b2a slice: the projection would need the recipe instance scope, which exists only at insertion time`,
      node.span,
    );
    return;
  }
  const recipeVar = state.childrenRecipeVar;
  if (recipeVar === null) {
    diag(
      state,
      'OEIR_LEAF_MISSING_CHILDREN',
      'children projection has no mount-level `props.children` recipe read (internal model mismatch)',
      node.span,
    );
    return;
  }
  const fragmentVar = nextName(state, 'childrenTarget');
  const projectionVar = nextName(state, 'childrenProjection');
  push(state, `const ${fragmentVar} = document.createDocumentFragment();`, node.span);
  push(
    state,
    `const ${projectionVar} = insertRecipe(${state.scopeVar}, ${recipeVar}, ${fragmentVar});`,
    node.span,
  );
  sink.push({ kind: 'projection', name: projectionVar });
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
  if (node.kind === 'insertion-site') {
    emitInsertionSite(state, node, sink);
    return;
  }
  if (node.kind === 'children-projection') {
    emitChildrenProjection(state, node, sink);
    return;
  }
  // Defensive: a model node kind without a generator branch must fail closed,
  // never be dropped silently.
  diag(
    state,
    'OEIR_LEAF_UNSUPPORTED_NODE',
    `node '${(node as { readonly kind: string }).kind}' is outside the generated-leaf slice`,
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
  const projectsChildren = componentProjectsChildren(component);
  const declaredRecipeIds = new Set<string>();
  const recipeNames = new Set<string>();
  for (const resource of component.resources) {
    if (resource.recipeId === null) continue;
    declaredRecipeIds.add(resource.recipeId);
    recipeNames.add(resource.name);
  }
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
    declaredRecipeIds,
    recipeNames,
    recipeVars: new Map(),
    entryNames: new Set(),
    refreshStack: [],
    listDepth: 0,
    recipeDepth: 0,
    childrenRecipeVar: projectsChildren ? `${INTERNAL_PREFIX}childrenRecipe` : null,
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
      // A reusable JSX value has no lowered initializer: its recipe is emitted
      // by `emitRecipes` only when at least one insertion site references it.
      if (resource.recipeId !== null || resource.expression === null) continue;
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
  // One read of the children recipe per mount (M06b2a): every projection site
  // inserts this same recipe value, and dynamic children content refreshes
  // through the recipe body's own subscriptions (never a props re-read here).
  // The check is the documented runtime boundary for a host-supplied root
  // instance: `props.children` may only be a real recipe built with
  // `createRecipe`; a plain value fails coded instead of rendering nothing.
  if (state.childrenRecipeVar !== null) {
    push(state, `const ${state.childrenRecipeVar} = ${MOUNT_PROPS}.children;`);
    push(
      state,
      `if (${state.childrenRecipeVar} == null || typeof ${state.childrenRecipeVar} !== "object" || typeof ${state.childrenRecipeVar}.mount !== "function" || ${state.childrenRecipeVar}.definitionOwner == null) throw new Error("OEIR_LEAF_MISSING_CHILDREN: component '<${component.name}>' projects props.children but the mounted instance was given no children recipe");`,
    );
  }
  // Reusable JSX values (M06b1a-2): recipes are declared before the roots so
  // every insertion site — including one inside another recipe body — can
  // reference them.
  emitRecipes(state, file, records);
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

/**
 * One directed mount edge in the module's mount graph: a component instance or
 * a reusable-JSX recipe instance can call another mount at instance time. Nodes
 * are addressed by keys: `c:<Component>` for a component chunk and
 * `r:<Component>:<recipeId>` for a recipe of that component.
 */
interface MountEdge {
  readonly to: string;
  readonly span: IrSpan;
}

/** Collect every mount edge under one node tree, in authored order. */
function collectMountEdges(
  component: FunctionModelComponent,
  nodes: readonly FunctionModelNode[],
  edges: MountEdge[],
): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'component-ref':
        edges.push({ to: `c:${node.name}`, span: node.span });
        break;
      case 'insertion-site':
        edges.push({ to: `r:${component.name}:${node.recipeId}`, span: node.span });
        break;
      case 'element':
      case 'fragment':
        collectMountEdges(component, node.children, edges);
        break;
      case 'condition':
        collectMountEdges(component, node.consequent, edges);
        if (node.alternate !== null) collectMountEdges(component, node.alternate, edges);
        break;
      case 'list':
        collectMountEdges(component, node.template, edges);
        break;
      default:
        // text / dynamic-text / children-projection carry no mount edges.
        break;
    }
  }
}

/**
 * Fail closed on mount cycles (M06b1a-2 extends the M06b1a-1 component-cycle
 * DFS): a component reference and a reusable-JSX recipe both mount another
 * mount at instance time, so a cycle would emit self-recursive mounts (unbounded
 * recursion). Recipe targets are walked because a recipe can mount a component,
 * and recipe bodies can insert another recipe. Children recipes (M06b2a) are
 * component recipes too, so their target edges are already in the graph; the
 * projection edge from the child component to the recipe is added conservatively
 * (see the children-projection pass below) because only the runtime instance
 * knows which reference site supplied its `props.children`. The first cycle in
 * authored order is reported with its path and the closing edge's span; a cycle
 * that passes through a recipe node gets `OEIR_LEAF_RECIPE_CYCLE`, a pure
 * component-reference cycle keeps `OEIR_LEAF_COMPONENT_CYCLE`.
 */
function findMountCycle(module: FunctionModelModule): IrDiagnostic | null {
  const edges = new Map<string, MountEdge[]>();
  const labels = new Map<string, string>();
  const addNode = (key: string, label: string, collected: MountEdge[]): void => {
    labels.set(key, label);
    edges.set(key, collected);
  };
  for (const component of module.components) {
    const componentEdges: MountEdge[] = [];
    collectMountEdges(component, component.roots, componentEdges);
    addNode(`c:${component.name}`, component.name, componentEdges);
    for (const recipe of component.recipes) {
      const recipeEdges: MountEdge[] = [];
      collectMountEdges(component, [recipe.target], recipeEdges);
      addNode(`r:${component.name}:${recipe.id}`, `${component.name}${recipe.id}`, recipeEdges);
    }
  }
  // Children-projection edges (M06b2a): a component that projects
  // `props.children` mounts the recipe supplied by whichever reference site
  // created its instance; the instance cannot know that statically, so every
  // `<Child>…</Child>` site whose `<Child>` projects children contributes the
  // conservative edge `c:<Child> -> r:<Definer>:<childrenRecipeId>`. This is what
  // refuses a component that projects the children of a reference back into
  // itself (an unbounded mount, not just a static recursion).
  const projectsChildrenByName = new Map(
    module.components.map(
      (component) => [component.name, componentProjectsChildren(component)] as const,
    ),
  );
  for (const component of module.components) {
    const projectionEdges: ChildrenProjectionEdge[] = [];
    collectChildrenProjectionEdges(component, projectionEdges);
    for (const edge of projectionEdges) {
      if (projectsChildrenByName.get(edge.projectingComponent) !== true) continue;
      const fromEdges = edges.get(`c:${edge.projectingComponent}`);
      const toKey = `r:${edge.definingComponent}:${edge.recipeId}`;
      if (fromEdges === undefined || !edges.has(toKey)) continue;
      fromEdges.push({ to: toKey, span: edge.span });
    }
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const path: string[] = [];
  const visit = (key: string): IrDiagnostic | null => {
    color.set(key, GRAY);
    path.push(key);
    for (const edge of edges.get(key) ?? []) {
      // Unknown/external component targets have no node here and fail closed on
      // their own during emission.
      if (!edges.has(edge.to)) continue;
      const targetColor = color.get(edge.to) ?? WHITE;
      if (targetColor === GRAY) {
        const cycleKeys = path.slice(path.indexOf(edge.to));
        const recipeCycle =
          cycleKeys.some((entry) => entry.startsWith('r:')) || edge.to.startsWith('r:');
        const cycle = [...cycleKeys, edge.to]
          .map((entry) => labels.get(entry) ?? entry)
          .join(' -> ');
        return {
          severity: 'error',
          code: recipeCycle ? 'OEIR_LEAF_RECIPE_CYCLE' : 'OEIR_LEAF_COMPONENT_CYCLE',
          message: recipeCycle
            ? `recipe insertion cycle: ${cycle}`
            : `component reference cycle: ${cycle}`,
          span: edge.span,
          origin: 'ir-object',
        };
      }
      if (targetColor === WHITE) {
        const found = visit(edge.to);
        if (found !== null) return found;
      }
    }
    path.pop();
    color.set(key, BLACK);
    return null;
  };
  for (const component of module.components) {
    const key = `c:${component.name}`;
    if ((color.get(key) ?? WHITE) !== WHITE) continue;
    const found = visit(key);
    if (found !== null) return found;
  }
  return null;
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
  const cycle = findMountCycle(module);
  if (cycle !== null) {
    return {
      module: null,
      sourceMap: null,
      placements: [],
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      diagnostics: [cycle],
    };
  }
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
    '// <generated by openelement M06b1a-2 leaf-codegen v2; do not edit>',
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
