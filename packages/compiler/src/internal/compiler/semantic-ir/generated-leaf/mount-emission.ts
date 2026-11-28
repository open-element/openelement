/** Emit DOM construction and reactive updates. */

import {
  type FunctionModelNode,
  type FunctionModelCondition,
  type FunctionModelList,
  type FunctionModelAttribute,
  type FunctionModelComponentRef,
  type FunctionExpressionRef,
  type FunctionModelRecipe,
  type FunctionModelInsertionSite,
  type FunctionModelChildrenProjection,
} from '../../semantic-core/function-frontend.ts';
import { type LoweredExpressionRecord } from '../../semantic-core/expression-registry.ts';
import { type IrSpan } from '../types.ts';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';
import { unsafeStreamFrameAttribute } from '@openelement/protocol/stream-frame-policy';
import { BOOLEAN_ATTRIBUTES } from '../../semantic-core/attribute-classification.ts';
import {
  type EmitState,
  push,
  INTERNAL_PREFIX,
  type SpanLike,
  nextName,
  recordFor,
  declareReads,
  dependencyNames,
  pushParts,
  emitDependencySubscriptions,
  registerRefresh,
  type Dependency,
  IDENTIFIER_PATTERN,
  diag,
  originArgs,
  moduleUsesErrorBoundary,
  ERROR_REPORT_PROPERTY,
  ATTRIBUTE_PATTERN,
  ADMITTED_ATTRIBUTE_CHANNELS,
  componentPropAdmitted,
  MOUNT_SUFFIX,
  MOUNT_SCOPE,
  TAG_PATTERN,
  SVG_NAMESPACE,
  CONSUMED_ATTRIBUTE_CHANNELS,
  CLIENT_ONLY_ATTRIBUTE_CHANNELS,
  readsEntryLocal,
  emitLocalRefresh,
} from './emission.ts';
import {
  emissionNodes,
  textSlotOrdinals,
  componentProjectsChildren,
  referencedRecipeIds,
  normalizeTextRuns,
  assertTextBoundaryContext,
  directoryParentAllowed,
  staticElementDirectory,
  textOrdinal,
} from './structure.ts';
import {
  siteKeyLiteral,
  LEAF_SETUP_SUFFIX,
  childHostElementField,
  childPropertyChangeField,
  childErrorBoundaryField,
  childContextField,
  childErrorReportField,
  retainedTransactionField,
} from './instance-emission.ts';

const EVENT_HANDLER_INVALID = 'OEIR_LEAF_EVENT_HANDLER_INVALID';

const REF_HANDLER_INVALID = 'OEIR_LEAF_REF_HANDLER_INVALID';

export type SinkEntry =
  | { readonly kind: 'node'; readonly name: string }
  | { readonly kind: 'spread'; readonly name: string }
  /** One M04 projection (M06b1a-2): spread `projection.nodes` into the sink. */
  | { readonly kind: 'projection'; readonly name: string };

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
export function appendSinkToArray(
  state: EmitState,
  sink: readonly SinkEntry[],
  targetVar: string,
): void {
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
export function emitNodesBuilder(
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
  const outerOrdinals = state.textOrdinals;
  const prepared = emissionNodes(state, nodes);
  state.scopeVar = scopeParam;
  // Every generated builder is its own chunk: text-slot ordinals restart at 0
  // and top-level static runs use the same normalized view the claim/SSR walk
  // will consume. The save/restore is per builder, matching the recipe path.
  state.textOrdinals = textSlotOrdinals(prepared);
  push(state, `const ${INTERNAL_PREFIX}nodes = [];`);
  // B3: a branch builder is its own function scope. Refresh functions emitted
  // inside it are not visible to an enclosing list entry's `update(next)` hook,
  // so they must not join that collector. The condition's own refresh (which is
  // registered with the entry) force-rebuilds the branch when the entry updates,
  // which re-runs these branch-internal writes against the re-bound parameter.
  const outerCollector = state.refreshStack.length;
  state.refreshStack.push([]);
  try {
    for (const node of prepared) {
      const sink: SinkEntry[] = [];
      emitNode(state, node, sink, records);
      appendSinkToArray(state, sink, `${INTERNAL_PREFIX}nodes`);
    }
  } finally {
    state.refreshStack.length = outerCollector;
  }
  push(state, `return ${INTERNAL_PREFIX}nodes;`);
  state.textOrdinals = outerOrdinals;
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
export function emitEntryBuilder(
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
  const outerOrdinals = state.textOrdinals;
  state.scopeVar = scopeParam;
  // Save/restore rather than add/delete: a nested list entry may shadow the same
  // mapper name, and deleting it on the way out would hide the outer entry-local
  // reads (refresh registration and `declareReads` both consult this set).
  const outerEntryNames = state.entryNames.has(itemName);
  state.entryNames.add(itemName);
  // Every generated builder is its own text chunk: entry-local ordinals restart
  // at 0 and top-level static runs use the normalized view the claim/SSR walk
  // consumes. Mount, claim-create and SSR all go through this same chunk view.
  const prepared = emissionNodes(state, nodes);
  state.textOrdinals = textSlotOrdinals(prepared);
  push(state, `const ${INTERNAL_PREFIX}nodes = [];`);
  push(state, `let ${itemName} = ${itemParam};`);
  const collector: string[] = [];
  state.refreshStack.push(collector);
  for (const node of prepared) {
    const sink: SinkEntry[] = [];
    emitNode(state, node, sink, records);
    appendSinkToArray(state, sink, `${INTERNAL_PREFIX}nodes`);
  }
  state.refreshStack.pop();
  if (!outerEntryNames) state.entryNames.delete(itemName);
  const updateBody = [`${itemName} = next;`, ...collector.map((name) => `${name}(true);`)].join(
    ' ',
  );
  push(state, `return { nodes: ${INTERNAL_PREFIX}nodes, update(next) { ${updateBody} } };`);
  state.textOrdinals = outerOrdinals;
  state.scopeVar = outerScope;
  state.indent -= 1;
  push(state, '}');
}

/**
 * 16b-LC retained-child R1/R4: remove one `when` branch owner and release every retained
 * child indexed under it (the branch is the structural owner of retained refs
 * emitted inside it).
 *
 * Cleanup FIRST, release SECOND, and both always run (B2): a throwing retained
 * setup cleanup must never skip the branch's own `dispose(true)` range removal.
 * The pre-existing dispose error wins when both throw; release errors surface
 * only when the dispose was clean.
 */
export function emitBranchRelease(state: EmitState, ownerVar: string): void {
  const failureVar = nextName(state, 'releaseFailure');
  push(state, `if (${ownerVar} !== null) {`);
  state.indent += 1;
  push(state, `let ${failureVar} = null;`);
  push(state, `try { ${ownerVar}.dispose(true); } catch (failure) { ${failureVar} = failure; }`);
  push(
    state,
    `try { releaseUnderStructuralScope(${ownerVar}); } catch (failure) { ${failureVar} ??= failure; }`,
  );
  push(state, `if (${failureVar} !== null) throw ${failureVar};`);
  state.indent -= 1;
  push(state, `}`);
}

/**
 * 16b-LC retained-child R2/R5: a `when` refresh failed while constructing the NEW branch.
 * Attempt the branch owner's `dispose(true)` and the structural release, drop
 * both cleanup errors and rethrow the ORIGINAL construction error (B2).
 */
export function emitBranchRollback(
  state: EmitState,
  branchOwnerVar: string,
  activeVar?: string,
): void {
  push(state, `} catch (error) {`);
  state.indent += 1;
  // The branch state is unknown after a failed rebuild: reset the active marker
  // BEFORE rethrowing so a later signal (even one carrying the same test value)
  // retries instead of being suppressed by the `next === active` guard. This
  // keeps retry-on-next-write semantics without treating the signal VALUE as an
  // explicit force.
  if (activeVar !== undefined) push(state, `${activeVar} = -1;`);
  push(state, `try { ${branchOwnerVar}.dispose(true); } catch { /* construction error wins */ }`);
  push(
    state,
    `try { releaseUnderStructuralScope(${branchOwnerVar}); } catch { /* construction error wins */ }`,
  );
  push(state, `throw error;`);
  state.indent -= 1;
  push(state, `}`);
}

/** True when this emission site sits in the ROOT retaining body itself. */
export function emitsRetentionReleaseText(state: EmitState): boolean {
  return (
    state.retainBody &&
    state.recipeDepth === 0 &&
    state.claimTimeRecipeDepth === 0 &&
    state.listDepth === 0
  );
}

/**
 * Emit `when`/branch replacement through the M04 disposal mapping.
 */
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
  const endVar = `${INTERNAL_PREFIX}whenEnd${id}`;
  const activeVar = `${INTERNAL_PREFIX}whenActive${id}`;
  const ownerVar = `${INTERNAL_PREFIX}whenOwner${id}`;
  const refreshVar = `${INTERNAL_PREFIX}whenRefresh${id}`;
  const consequentFn = node.consequent.length > 0 ? `${INTERNAL_PREFIX}whenThen${id}` : null;
  const alternateFn =
    node.alternate !== null && node.alternate.length > 0 ? `${INTERNAL_PREFIX}whenElse${id}` : null;

  push(state, `const ${anchorVar} = emitComment(MARKERS.when);`, node.span);
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
  // The old branch is about to be released: mark the branch state unknown FIRST
  // so a throwing release leaves a retryable condition instead of an `active`
  // marker that suppresses the next refresh.
  push(state, `${activeVar} = -1;`);
  if (emitsRetentionReleaseText(state)) {
    emitBranchRelease(state, ownerVar);
  } else {
    push(state, `if (${ownerVar} !== null) ${ownerVar}.dispose(true);`);
  }
  push(state, `${ownerVar} = null;`);
  push(state, `const ${INTERNAL_PREFIX}branchOwner = ${state.scopeVar}.child();`);
  push(state, `let ${INTERNAL_PREFIX}branchNodes;`);
  push(state, `try {`);
  state.indent += 1;
  const thenCall = consequentFn === null ? '[]' : `${consequentFn}(${INTERNAL_PREFIX}branchOwner)`;
  const elseCall = alternateFn === null ? '[]' : `${alternateFn}(${INTERNAL_PREFIX}branchOwner)`;
  push(
    state,
    `${INTERNAL_PREFIX}branchNodes = runUntracked(() => ${INTERNAL_PREFIX}next === 1 ? ${thenCall} : ${elseCall});`,
  );
  state.indent -= 1;
  if (emitsRetentionReleaseText(state)) {
    emitBranchRollback(state, `${INTERNAL_PREFIX}branchOwner`, activeVar);
  } else {
    push(
      state,
      `} catch (error) { ${activeVar} = -1; ${INTERNAL_PREFIX}branchOwner.dispose(true); throw error; }`,
    );
  }
  push(
    state,
    `${INTERNAL_PREFIX}branchOwner.addRangeCleanup(() => removeNodes(${INTERNAL_PREFIX}branchNodes));`,
  );
  push(state, `const ${INTERNAL_PREFIX}parent = ${anchorVar}.parentNode;`);
  push(
    state,
    `if (${INTERNAL_PREFIX}parent !== null) { for (const ${INTERNAL_PREFIX}child of ${INTERNAL_PREFIX}branchNodes) ${INTERNAL_PREFIX}parent.insertBefore(${INTERNAL_PREFIX}child, ${endVar}); }`,
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
  push(state, `const ${endVar} = emitComment(MARKERS.whenEnd);`, node.span);
  sink.push({ kind: 'spread', name: initialNodesVar });
  sink.push({ kind: 'node', name: endVar });
  emitDependencySubscriptions(state, dependencies, refreshVar, node.span, {
    ignoreSignalValue: true,
  });
  registerRefresh(state, refreshVar);
}

/**
 * Emit one list key thunk. Unkeyed lists keep the mount contract: the key is
 * the item index, a finite number, so claim/SSR encode the same positional
 * identity rather than inventing a second unkeyed rule. The mapper parameter is
 * entry-local while the key record is validated; outer reads remain tracked.
 */
export function emitListKeyFunction(
  state: EmitState,
  keyFn: string,
  node: FunctionModelList,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): { readonly dependencies: readonly Dependency[] } | null {
  if (node.key !== null) {
    const keyRecord = recordFor(state, node.key, records);
    if (keyRecord === null) return null;
    const outerKeyEntryName = state.entryNames.has(node.parameter);
    state.entryNames.add(node.parameter);
    const declared = declareReads(state, keyRecord);
    if (!outerKeyEntryName) state.entryNames.delete(node.parameter);
    if (!declared) return null;
    const keyDeps = dependencyNames(state, keyRecord);
    if (keyDeps === null) return null;
    pushParts(
      state,
      [
        `function ${keyFn}(${INTERNAL_PREFIX}eachItem, ${INTERNAL_PREFIX}eachIndex) { const ${node.parameter} = ${INTERNAL_PREFIX}eachItem; return (`,
        { record: keyRecord },
        '); }',
      ],
      node.key.span,
    );
    return { dependencies: keyDeps };
  }
  push(
    state,
    `function ${keyFn}(${INTERNAL_PREFIX}eachItem, ${INTERNAL_PREFIX}eachIndex) { return ${INTERNAL_PREFIX}eachIndex; }`,
    node.span,
  );
  return { dependencies: [] };
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

  push(state, `const ${anchorVar} = emitComment(MARKERS.each);`, node.span);
  sink.push({ kind: 'node', name: anchorVar });
  // The list wire (end marker + per-entry key marker) exists only when this
  // component emits a claim/SSR. A mount-only component keeps its historical
  // shape: no inert comments and no second marker vocabulary to maintain.
  const wire = state.emitTextBoundaries;
  const endVar = `${INTERNAL_PREFIX}eachEnd${id}`;
  if (wire) push(state, `const ${endVar} = emitComment(MARKERS.eachEnd);`, node.span);
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

  const keyInfo = emitListKeyFunction(state, keyFn, node, records);
  if (keyInfo === null) return;
  const keyDependencies: readonly Dependency[] = keyInfo.dependencies;

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
  if (wire) {
    // One marker per entry, created exactly when the entry is created and
    // unshifted into its node list so it moves/disposes with it. The token is a
    // string comparison input, never decoded; an unsupported runtime key keeps
    // mount tolerant with the mount-only `u` payload.
    const tokenVar = nextName(state, 'token');
    push(state, `const ${tokenVar} = tryEncodeListKey(${INTERNAL_PREFIX}key);`);
    push(state, `${INTERNAL_PREFIX}built.nodes.unshift(emitComment(entryKeyMarker(${tokenVar})));`);
  }
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
  // hand the placement to the ONE leaf-runtime helper. Its LIS rule leaves the
  // stable chain untouched — an unchanged node (and a focused element inside
  // it) is never re-inserted, and a distant swap moves exactly the swapped
  // entries, where the inline backward walk re-inserted every entry between
  // the swap and the tail (measured 997 of 1000, 2026-11-24).
  push(state, `const ${INTERNAL_PREFIX}previousNodes = new Set();`);
  push(
    state,
    `for (const ${INTERNAL_PREFIX}entry of ${INTERNAL_PREFIX}previous) for (const ${INTERNAL_PREFIX}node of ${INTERNAL_PREFIX}entry.nodes) ${INTERNAL_PREFIX}previousNodes.add(${INTERNAL_PREFIX}node);`,
  );
  if (wire) {
    // The list end is the fixed tail: every entry node belongs before it and a
    // following sibling can never be mistaken for a list node.
    push(state, `const ${INTERNAL_PREFIX}tail = ${endVar};`);
  } else {
    push(state, `let ${INTERNAL_PREFIX}tail = ${anchorVar}.nextSibling;`);
    push(
      state,
      `while (${INTERNAL_PREFIX}tail !== null && ${INTERNAL_PREFIX}previousNodes.has(${INTERNAL_PREFIX}tail)) ${INTERNAL_PREFIX}tail = ${INTERNAL_PREFIX}tail.nextSibling;`,
    );
  }
  push(
    state,
    `reconcileEachEntries(${INTERNAL_PREFIX}next, ${INTERNAL_PREFIX}parent, ${INTERNAL_PREFIX}tail, ${INTERNAL_PREFIX}previous);`,
  );
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
  if (wire) sink.push({ kind: 'node', name: endVar });
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

function emitTextWrite(
  state: EmitState,
  targetVar: string,
  record: LoweredExpressionRecord,
  compare = false,
): void {
  if (!compare) {
    pushParts(state, [`${targetVar}.nodeValue = displayValue((`, { record }, '));']);
    return;
  }
  // Evaluate and coerce once before reading the live node. An author edit can
  // differ from the previous render even when the expression returns the same value.
  const valueVar = `${INTERNAL_PREFIX}textValue`;
  pushParts(state, [`const ${valueVar} = displayValue((`, { record }, '));']);
  push(state, `if (${targetVar}.nodeValue !== ${valueVar}) ${targetVar}.nodeValue = ${valueVar};`);
}

/** The DOM event name for one authored `onX` attribute (`onClick` -> `click`). */
function clientOnlyEventName(attributeName: string): string | null {
  const name = attributeName.slice(2).toLowerCase();
  return name.length > 0 && /^[a-z][a-z0-9-]*$/.test(name) ? name : null;
}

/**
 * Placement gate for the two client-only channels. Refused:
 *
 * - custom-element hosts (`<x-y>`): this slice admits the INTRINSIC DOM
 *   handler/ref channel; a host's event/ref contract belongs to its owner.
 * - list entry templates: a keyed entry update re-binds the mapper parameter
 *   without re-running the mount, so an installed listener/ref would keep the
 *   first entry's values over reused DOM. The M06b2c per-entry update hook owns
 *   that shape.
 */
export function clientOnlyAttributeAdmitted(
  state: EmitState,
  tag: string,
  attributeName: string,
  span: IrSpan,
): boolean {
  const label = attributeName.startsWith('on') ? 'event' : 'ref';
  if (tag.includes('-')) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
      `the ${label} channel on custom-element host <${tag}> is outside the generated-leaf slice; ` +
        'bind it on an intrinsic element or in the host component',
      span,
    );
    return false;
  }
  if (state.listDepth > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
      `the ${label} channel inside a list entry template needs the per-entry update hook ` +
        '(M06b2c); keep the handler outside the list entry',
      span,
    );
    return false;
  }
  return true;
}

/**
 * Install one client-only attachment on an already-created element.
 *
 * - event: evaluate the handler record once (attach-time, matching the class
 *   path's handler Part), validate it is callable, then add one listener that
 *   calls it with the native event. No wrapper/try-catch: a throwing handler is
 *   platform dispatch, not a suppression point. The mount/claim scope owns the
 *   removal, so a throwing later installation step (or a throwing claim) runs
 *   this cleanup through the standard owner rollback while borrowed DOM stays.
 * - ref: evaluate the handler record once, validate callable, call it with the
 *   element and queue the class-path detach: call the returned unsubscribe (if
 *   it is a function) and then call the handler with `null`, even when the
 *   cleanup throws (`finally`).
 */
export function emitClientOnlyInstall(
  state: EmitState,
  elementVar: string,
  attribute: Extract<FunctionModelAttribute, { readonly kind: 'dynamic' }>,
  record: LoweredExpressionRecord,
): void {
  const span = attribute.span;
  const handlerVar = nextName(state, attribute.channel === 'event' ? 'eventHandler' : 'refHandler');
  pushParts(state, [`const ${handlerVar} = (`, { record }, ');'], span);
  if (attribute.channel === 'event') {
    push(
      state,
      `if (typeof ${handlerVar} !== "function") throw leafRuntimeError(${quoteGeneratedJavaScriptValue(EVENT_HANDLER_INVALID)}, ${quoteGeneratedJavaScriptValue(`${attribute.name} handler is not callable`)}${originArgs(span)});`,
      span,
    );
    const eventName = clientOnlyEventName(attribute.name);
    if (eventName === null) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `event attribute '${attribute.name}' does not name a DOM event`,
        span,
      );
      return;
    }
    const listenerVar = nextName(state, 'eventListener');
    // `16b-EB`: a module that registers an `onError` handler routes a throwing
    // listener through the executor's `guardUpdate` with the shell's sink, so an
    // author handler failure is reported instead of escaping as uncaught
    // platform dispatch. A module WITHOUT the intrinsic keeps the unwrapped
    // listener (the pre-existing contract: platform dispatch is not a
    // suppression point).
    push(
      state,
      moduleUsesErrorBoundary(state)
        ? `const ${listenerVar} = guardUpdate((event) => ${handlerVar}(event), ${state.hostVar}.${ERROR_REPORT_PROPERTY});`
        : `const ${listenerVar} = (event) => ${handlerVar}(event);`,
      span,
    );
    push(
      state,
      `${elementVar}.addEventListener(${quoteGeneratedJavaScriptValue(eventName)}, ${listenerVar});`,
      span,
    );
    push(
      state,
      `${state.scopeVar}.add(() => ${elementVar}.removeEventListener(${quoteGeneratedJavaScriptValue(eventName)}, ${listenerVar}));`,
      span,
    );
    return;
  }
  push(
    state,
    `if (typeof ${handlerVar} !== "function") throw leafRuntimeError(${quoteGeneratedJavaScriptValue(REF_HANDLER_INVALID)}, ${quoteGeneratedJavaScriptValue(`${attribute.name} handler is not callable`)}${originArgs(span)});`,
    span,
  );
  const cleanupVar = nextName(state, 'refCleanup');
  push(state, `const ${cleanupVar} = ${handlerVar}(${elementVar});`, span);
  push(
    state,
    `${state.scopeVar}.add(() => { try { if (typeof ${cleanupVar} === "function") ${cleanupVar}(); } finally { ${handlerVar}(null); } });`,
    span,
  );
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
  const nodesVar = `${INTERNAL_PREFIX}childNodes${id}`;
  // 16b-LC retained-child: a site the module plan selected retains its child logical instance
  // on the ROOT element instance (depth-1). Every other site keeps today's text
  // exactly: a demoted target, a recipe/claim-time-recipe body, a list entry or
  // any non-root body emits no ledger text.
  const retained = state.retention !== null && state.retention.retainedRefs.has(node);
  const hostVar = `${INTERNAL_PREFIX}childHost${id}`;
  const scopeVar = `${INTERNAL_PREFIX}childScope${id}`;
  const setupHostVar = `${INTERNAL_PREFIX}childSetupHost${id}`;
  const instanceVar = `${INTERNAL_PREFIX}childInstance${id}`;
  const failureVar = `${INTERNAL_PREFIX}childFailure${id}`;

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
  const propsExpr = resolved.length > 0 || childrenRecipeVar !== null ? propsVar : '{}';
  const depParts = [...propDeps];
  if (needsParentProps) depParts.push(`...${state.hostVar}.propDeps`);
  const depList = `[${depParts.join(', ')}]`;

  if (!retained) {
    // The child instance's host record: the parent host bindings (so the child
    // resolves its own host reads from the same module-level record) plus the
    // defining-scope signals behind the passed prop expressions.
    push(
      state,
      `const ${hostVar} = { bindings: ${state.hostVar}.bindings, propDeps: ${depList} };`,
      span,
    );

    // Fresh child scope, exception-safe mount, range cleanup before the parent
    // can append: the same ownership mapping the M04 mount contract uses.
    push(state, `const ${scopeVar} = ${state.scopeVar}.child();`, span);
    push(state, `let ${nodesVar};`);
    push(state, `try {`);
    state.indent += 1;
    push(
      state,
      `${nodesVar} = ${node.name}${MOUNT_SUFFIX}(${scopeVar}, ${propsExpr}, ${hostVar});`,
      span,
    );
    state.indent -= 1;
    push(state, `} catch (error) { ${scopeVar}.dispose(true); throw error; }`);
    push(state, `${scopeVar}.addRangeCleanup(() => removeNodes(${nodesVar}));`);
    sink.push({ kind: 'spread', name: nodesVar });
    return;
  }

  // Retained site (B1): the retained scope owns the setup record ONLY; the
  // per-connect mount scope stays parented on the structural owner exactly as
  // today (`state.scopeVar.child()`), so disconnect and branch removal cascade
  // it. The setup-host literal carries the parent bindings/prop deps the setup
  // factory is allowed to read; it is compiler-private generated text, never a
  // shell host producer.
  const siteKey = siteKeyLiteral(span);
  const setupScopeVar = `${INTERNAL_PREFIX}setupScope${id}`;
  const setupCall = state.retention!.setupBodies.has(node.name)
    ? `(${setupScopeVar}) => ${node.name}${LEAF_SETUP_SUFFIX}(${setupScopeVar}, ${propsExpr}, ${setupHostVar})`
    : `() => ({})`;
  push(
    state,
    `const ${setupHostVar} = { bindings: ${state.hostVar}.bindings, propDeps: ${depList}${childHostElementField(state, node)}${childPropertyChangeField(state, node)}${childErrorBoundaryField(state, node)}${childContextField(state, node)} };`,
    span,
  );
  push(
    state,
    `const ${instanceVar} = retainChildInstance(${state.hostVar}.instance, ${siteKey}, ${state.scopeVar}, ${setupCall});`,
    span,
  );
  push(state, `const ${scopeVar} = ${state.scopeVar}.child();`, span);
  push(
    state,
    `const ${hostVar} = { bindings: ${setupHostVar}.bindings, propDeps: ${setupHostVar}.propDeps, instance: ${instanceVar}.scope, setup: ${instanceVar}.record${childHostElementField(state, node)}${childErrorReportField(state, node)}${childContextField(state, node)}${retainedTransactionField(state, node.name)} };`,
    span,
  );
  push(state, `let ${nodesVar};`);
  push(state, `try {`);
  state.indent += 1;
  push(
    state,
    `${nodesVar} = ${node.name}${MOUNT_SUFFIX}(${scopeVar}, ${propsExpr}, ${hostVar});`,
    span,
  );
  state.indent -= 1;
  // B2 cleanup-first catch: the per-connect scope is disposed FIRST and the
  // ledger entry released SECOND; both are always attempted. The original
  // construction error wins when both cleanups are clean, otherwise the first
  // cleanup failure surfaces.
  push(state, `} catch (error) {`);
  state.indent += 1;
  push(state, `let ${failureVar} = null;`);
  push(state, `try { ${scopeVar}.dispose(true); } catch (failure) { ${failureVar} = failure; }`);
  push(
    state,
    `try { releaseChildInstance(${state.hostVar}.instance, ${siteKey}); } catch (failure) { ${failureVar} ??= failure; }`,
  );
  push(state, `throw ${failureVar} ?? error;`);
  state.indent -= 1;
  push(state, `}`);
  push(state, `${scopeVar}.addRangeCleanup(() => removeNodes(${nodesVar}));`);
  sink.push({ kind: 'spread', name: nodesVar });
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
export function emitRecipes(
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
    const outerOrdinals = state.textOrdinals;
    const preparedTarget = normalizeTextRuns([recipe.target]);
    state.textOrdinals = textSlotOrdinals(preparedTarget);
    if (state.emitTextBoundaries && !assertTextBoundaryContext(state, preparedTarget)) {
      state.textOrdinals = outerOrdinals;
      return;
    }
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
    state.textOrdinals = outerOrdinals;
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

function appendGeneratedNode(
  state: EmitState,
  target: { readonly kind: 'element' | 'array'; readonly name: string },
  nodeName: string,
): void {
  if (target.kind === 'element') push(state, `${target.name}.appendChild(${nodeName});`);
  else push(state, `${target.name}.push(${nodeName});`);
}

/**
 * Mount one pure static directory. Interiors are emitted with directories
 * suppressed, so a range does not contain another range. Called only when
 * this component emits a claim function (ADR-0175 D-2).
 */
export function emitMountedDirectory(
  state: EmitState,
  ranges: readonly FunctionModelNode[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  target: { readonly kind: 'element' | 'array'; readonly name: string },
): void {
  ranges.forEach((range, ordinal) => {
    const span = range.span;
    const start = nextName(state, 'mark');
    push(state, `const ${start} = emitComment(rangeMarker(${ordinal}));`, span);
    appendGeneratedNode(state, target, start);
    const sink: SinkEntry[] = [];
    emitNode(state, range, sink, records, false);
    for (const entry of sink) {
      if (entry.kind === 'node') appendGeneratedNode(state, target, entry.name);
    }
    const end = nextName(state, 'mark');
    push(state, `const ${end} = emitComment(rangeMarker(${ordinal}, true));`, span);
    appendGeneratedNode(state, target, end);
  });
}

export function emitNode(
  state: EmitState,
  node: FunctionModelNode,
  sink: SinkEntry[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  allowDirectory = true,
  namespace: 'html' | 'svg' = 'html',
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
    // A fragment is not a directory parent, but it is still inside the caller's
    // range. Dropping `allowDirectory` restores the default and lets that
    // interior emit its own `oe:r` pair. The child list is normalized on the
    // same gate as every other claimable surface.
    for (const child of emissionNodes(state, node.children))
      emitNode(state, child, sink, records, allowDirectory, namespace);
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
    // An `<svg>` element (and its subtree) lives in the SVG namespace; a
    // `document.createElement` call would produce an HTML-namespaced lookalike
    // that renders nothing. `foreignObject` switches its children back to HTML.
    const elementNamespace = node.tag === 'svg' ? 'svg' : namespace;
    push(
      state,
      elementNamespace === 'svg'
        ? `const ${varName} = document.createElementNS(${JSON.stringify(SVG_NAMESPACE)}, ${JSON.stringify(node.tag)});`
        : `const ${varName} = document.createElement(${JSON.stringify(node.tag)});`,
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
        // A static BOOLEAN attribute is a presence marker: the HTML parser
        // spells it `name=""` and `getAttribute` returns the empty string. The
        // authored `muted` JSX shorthand folds to the string "true", which would
        // make the created DOM disagree with the same element parsed from SSR
        // bytes (and with the class lane). Emitting the canonical empty value
        // keeps mount and claim byte-equivalent.
        const staticValue = BOOLEAN_ATTRIBUTES.has(attribute.name.toLowerCase())
          ? ''
          : attribute.value;
        push(
          state,
          `${varName}.setAttribute(${JSON.stringify(attribute.name)}, ${JSON.stringify(staticValue)});`,
          attribute.span,
        );
        continue;
      }
      if (CLIENT_ONLY_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
        if (!clientOnlyAttributeAdmitted(state, node.tag, attribute.name, span)) continue;
        const record = recordFor(state, attribute.expression, records);
        if (record === null || !declareReads(state, record)) continue;
        emitClientOnlyInstall(state, varName, attribute, record);
        continue;
      }
      const record = recordFor(state, attribute.expression, records);
      if (record === null || !declareReads(state, record)) continue;
      const dependencies = dependencyNames(state, record);
      if (dependencies === null) continue;
      if (dependencies.length === 0) {
        if (!readsEntryLocal(state, record)) {
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
        // Entry-local read without a reactive dependency: the enclosing entry
        // builder's `update(next)` re-binds the mapper parameter, so the write
        // must re-run from a registered refresh closure (M06b2c).
        registerRefresh(
          state,
          emitLocalRefresh(state, attribute.span, () =>
            emitAttributeWrite(
              state,
              varName,
              attribute.name,
              attribute.channel,
              record,
              attribute.span,
            ),
          ),
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
    const ranges =
      allowDirectory && state.emitDirectoryMarkers && directoryParentAllowed(node.tag)
        ? staticElementDirectory(node.children)
        : null;
    if (ranges !== null)
      emitMountedDirectory(state, ranges, records, { kind: 'element', name: varName });
    else {
      // The admitted tag grammar is lowercase (`TAG_PATTERN`), so camelCase SVG
      // tags (`foreignObject`, `linearGradient`) are outside this lane; the
      // subtree keeps its namespace. An SVG subtree needing one of them stays
      // unsupported instead of silently mis-namespaced.
      const childNamespace = elementNamespace;
      for (const child of emissionNodes(state, node.children)) {
        const childSink: SinkEntry[] = [];
        emitNode(state, child, childSink, records, allowDirectory, childNamespace);
        appendSinkToElement(state, childSink, varName);
      }
    }
    sink.push({ kind: 'node', name: varName });
    return;
  }
  if (node.kind === 'dynamic-text') {
    const record = recordFor(state, node.expression, records);
    if (record === null || !declareReads(state, record)) return;
    const dependencies = dependencyNames(state, record);
    if (dependencies === null) return;
    let textVar: string;
    if (state.emitTextBoundaries) {
      const ordinal = textOrdinal(state, node);
      if (ordinal === null) return;
      const boundaryStart = nextName(state, 'textStart');
      push(state, `const ${boundaryStart} = emitComment(textSlotMarker(${ordinal}));`, node.span);
      sink.push({ kind: 'node', name: boundaryStart });
      const boundaryEnd = nextName(state, 'textEnd');
      textVar = nextName(state, 'text');
      push(state, `const ${textVar} = document.createTextNode("");`, node.span);
      sink.push({ kind: 'node', name: textVar });
      push(
        state,
        `const ${boundaryEnd} = emitComment(textSlotMarker(${ordinal}, true));`,
        node.span,
      );
      sink.push({ kind: 'node', name: boundaryEnd });
    } else {
      textVar = nextName(state, 'text');
      push(state, `const ${textVar} = document.createTextNode("");`, node.span);
      sink.push({ kind: 'node', name: textVar });
    }
    if (dependencies.length === 0) {
      if (!readsEntryLocal(state, record)) {
        emitTextWrite(state, textVar, record);
        return;
      }
      // Entry-local read without a reactive dependency: the entry update hook
      // re-binds the mapper parameter, so the text write must re-run from a
      // registered refresh closure (M06b2c — unkeyed/same-key reuse).
      registerRefresh(
        state,
        emitLocalRefresh(state, node.span, () => emitTextWrite(state, textVar, record, true)),
      );
      return;
    }
    const refresh = nextName(state, 'refresh');
    push(state, `function ${refresh}() {`, node.span);
    state.indent += 1;
    emitTextWrite(state, textVar, record, state.listDepth > 0);
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
