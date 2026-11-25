/** Emit structural verification and activation over existing DOM. */

import { type LoweredExpressionRecord } from '../../semantic-core/expression-registry.ts';
import {
  type FunctionModelNode,
  type FunctionModelAttribute,
  type FunctionExpressionRef,
  type FunctionModelCondition,
  type FunctionModelList,
  type FunctionModelInsertionSite,
  type FunctionModelChildrenProjection,
  type FunctionModelComponentRef,
  type FunctionModelComponent,
} from '../../semantic-core/function-frontend.ts';
import { type IrDiagnostic, type IrSpan } from '../types.ts';
import { type EmissionSegment } from '../../semantic-core/source-map.ts';
import { BOOLEAN_ATTRIBUTES } from '../../semantic-core/attribute-classification.ts';
import { STATIC_STYLES_MARKER } from '@openelement/protocol/part-program';
import {
  INTERNAL_PREFIX,
  type EmitState,
  nextName,
  pushParts,
  push,
  type SpanLike,
  IDENTIFIER_PATTERN,
  diag,
  type ExpressionPlacement,
  originArgs,
  SVG_NAMESPACE,
  HTML_NAMESPACE,
  CONSUMED_ATTRIBUTE_CHANNELS,
  CLIENT_ONLY_ATTRIBUTE_CHANNELS,
  type Dependency,
  recordFor,
  declareReads,
  dependencyNames,
  emitDependencySubscriptions,
  registerRefresh,
  CLAIM_SUFFIX,
  MOUNT_SCOPE,
  type RetentionPlan,
  MOUNT_HOST,
  TRANSACTION_VAR,
  CLAIM_PARENT,
  MOUNT_PROPS,
  fragmentLineCount,
} from './emission.ts';
import {
  declaredStaticLiteral,
  emissionNodes,
  textSlotOrdinals,
  normalizeTextRuns,
  textOrdinal,
  directoryParentAllowed,
  staticElementDirectory,
  referencedRecipeIds,
  type ClaimContext,
  nodeClaimable,
  assertTextBoundaryContext,
  componentClaimable,
  isDirectoryRootComponent,
  componentProjectsChildren,
  declaredRecipeIdSet,
} from './structure.ts';
import {
  emitNodesBuilder,
  emitsRetentionReleaseText,
  emitBranchRelease,
  emitBranchRollback,
  emitEntryBuilder,
  emitListKeyFunction,
  clientOnlyAttributeAdmitted,
  emitClientOnlyInstall,
} from './mount-emission.ts';
import {
  siteKeyLiteral,
  LEAF_SETUP_SUFFIX,
  childHostElementField,
  childPropertyChangeField,
  childErrorBoundaryField,
  childContextField,
  childErrorReportField,
  retainedTransactionField,
  type SetupLocal,
  emitSetupAlias,
  ROOT_SETUP_HOST_PROPERTY,
  componentUsesContextIntrinsic,
  LEAF_SETUP_HOST_PROPERTY,
  emitSetupBinding,
  emitJoinTransaction,
  emitLifecycleReplay,
  emitLifecycleEnvReplay,
} from './instance-emission.ts';

/**
 * Module-level activation queue for the shared-cursor claim path (M08-2 B2).
 * The cursor owner initializes it, nested component/recipe claims append to it,
 * and the owner captures it in `try`, clears it in `finally`, then drains the
 * captured local after the whole enclosing structure validated. A verify throw
 * therefore leaves no module-level queue behind.
 */
export const CLAIM_ACTIVATION = `${INTERNAL_PREFIX}claimPhase2`;

/**
 * Claim-period dynamic-text slot write. The slot is a boundary pair plus an
 * optional Text node: `null` means the server wire carried no text (an empty
 * value), so an equal client value is a no-op and a non-empty one lazily
 * inserts the slot's single Text before the closing marker. An existing Text
 * is value-compared; it is never split, merged, normalized or removed.
 *
 * The lazy node is not part of the projected `nodes` array, so it is owned by a
 * claim-scope range cleanup. The node cursor already points past the consumed
 * close marker, so no index compensation is needed.
 */
function emitClaimTextSlotWrite(
  state: EmitState,
  slotVar: string,
  endVar: string,
  record: LoweredExpressionRecord,
): void {
  const valueVar = nextName(state, 'value');
  pushParts(state, [`const ${valueVar} = displayValue((`, { record }, '));']);
  push(state, `if (${slotVar} === null) {`);
  push(state, `  if (${valueVar} !== "") {`);
  const lazyVar = nextName(state, 'text');
  push(state, `    const ${lazyVar} = document.createTextNode(${valueVar});`);
  push(state, `    ${endVar}.parentNode.insertBefore(${lazyVar}, ${endVar});`);
  push(state, `    ${state.scopeVar}.addRangeCleanup(() => ${lazyVar}.remove());`);
  push(state, `    ${slotVar} = ${lazyVar};`);
  push(state, `  }`);
  push(state, `} else if (${slotVar}.nodeValue !== ${valueVar}) {`);
  push(state, `  ${slotVar}.nodeValue = ${valueVar};`);
  push(state, `}`);
}

interface InputValueClaim {
  readonly first: string;
  readonly previous: string;
}

/**
 * Claim-period attribute write. Each channel compares the current DOM to the
 * target value. `assertSafeUrlAttribute` runs before setting a string
 * attribute. The first value write to an input preserves live edits when
 * the binding still carries the server default.
 */
function emitClaimAttributeWrite(
  state: EmitState,
  elementVar: string,
  name: string,
  channel: string,
  record: LoweredExpressionRecord,
  anchor: SpanLike,
  inputValueClaim?: InputValueClaim,
): void {
  const literal = JSON.stringify(name);
  if (channel === 'boolean') {
    const valueVar = nextName(state, 'value');
    pushParts(state, [`const ${valueVar} = Boolean((`, { record }, '));'], anchor);
    push(
      state,
      `if (${elementVar}.hasAttribute(${literal}) !== ${valueVar}) ${elementVar}.toggleAttribute(${literal}, ${valueVar});`,
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
    const valueVar = nextName(state, 'value');
    pushParts(state, [`const ${valueVar} = (`, { record }, ');'], anchor);
    if (inputValueClaim !== undefined) {
      const { first, previous } = inputValueClaim;
      // A shared prop version or keyed entry update may refresh this slot
      // without changing its model value. Keep the draft until it does change.
      push(state, `if (!${first} && Object.is(${previous}, ${valueVar})) return;`, anchor);
      const liveValue = nextName(state, 'liveValue');
      const preserveDraft = nextName(state, 'preserveDraft');
      push(state, `const ${liveValue} = ${elementVar}.value;`, anchor);
      push(
        state,
        `const ${preserveDraft} = ${first} && ${liveValue} !== ${elementVar}.defaultValue && ${elementVar}.getAttribute("value") === attributeValueOf(${valueVar});`,
        anchor,
      );
      push(
        state,
        `if (!${preserveDraft} && ${liveValue} !== ${valueVar}) ${elementVar}.value = ${valueVar};`,
        anchor,
      );
      push(state, `${previous} = ${valueVar};`, anchor);
      push(state, `${first} = false;`, anchor);
      return;
    }
    push(
      state,
      `if (${elementVar}[${literal}] !== ${valueVar}) ${elementVar}[${literal}] = ${valueVar};`,
      anchor,
    );
    return;
  }
  const valueVar = nextName(state, 'value');
  pushParts(state, [`const ${valueVar} = attributeValueOf((`, { record }, '));'], anchor);
  push(state, `if (${valueVar} === null) {`, anchor);
  push(
    state,
    `  if (${elementVar}.hasAttribute(${literal})) ${elementVar}.removeAttribute(${literal});`,
    anchor,
  );
  push(state, `} else if (${elementVar}.getAttribute(${literal}) !== ${valueVar}) {`, anchor);
  push(state, `  assertSafeUrlAttribute(${literal}, ${valueVar});`, anchor);
  push(state, `  ${elementVar}.setAttribute(${literal}, ${valueVar});`, anchor);
  push(state, `}`, anchor);
}

/**
 * Claim one pure static directory through the M07b consumer. Ordinals are the
 * generator's own literals, not a scan of the live child list.
 *
 * `activate` is `() => {}` on purpose: this path has no dynamic binding. A
 * directory that admits a dynamic slot must pass a real `activate`. Keeping
 * the empty function there would present an incomplete claim as complete.
 */
function emitClaimedDirectory(
  state: EmitState,
  parentVar: string,
  ranges: readonly FunctionModelNode[],
): string[] {
  // Recorded from the emitted call site, not inferred from the text later.
  state.usesStaticSiblingDirectoryConsumer = true;
  const directory = nextName(state, 'directory');
  const declaration = ranges.map((range) => `[${declaredStaticLiteral(range)}]`).join(', ');
  push(
    state,
    `const ${directory} = openStaticSiblingDirectory(${parentVar}, [${declaration}], ${JSON.stringify(state.directorySource)});`,
  );
  const adopted: string[] = [];
  ranges.forEach((range, ordinal) => {
    const claim = nextName(state, 'range');
    push(
      state,
      `const ${claim} = claimStaticSiblingRange(${directory}, ${ordinal}, ${state.scopeVar}, () => {});`,
      range.span,
    );
    const interior = nextName(state, 'el');
    push(state, `const ${interior} = ${claim}.interior[0];`);
    adopted.push(interior);
  });
  return adopted;
}

interface ClaimEmission {
  readonly lines: string[];
  readonly diagnostics: readonly IrDiagnostic[];
  readonly segments: readonly EmissionSegment[];
  readonly placements: readonly ExpressionPlacement[];
  /** True when the emitted claim calls the directory consumer. */
  readonly usesStaticSiblingDirectoryConsumer?: boolean;
  /** True when the emitted claim calls `claimRecipe`. */
  readonly usesClaimRecipe?: boolean;
  /** True when the emitted claim throws the leaf mismatch. */
  readonly usesLeafClaimMismatch?: boolean;
}

/**
 * The emitted mismatch expression. The message prefix, the code and the error
 * options live in the runtime (`claim-invariants.ts`); the compiler names the
 * helper and passes the detail, so no contract string is restated here. The
 * optional authored `anchor` only makes the runtime append its additive
 * ` (authored file:line:column)` suffix.
 */
function claimError(detail: string, anchor?: SpanLike): string {
  return `leafClaimMismatch(${JSON.stringify(detail)}${originArgs(anchor)})`;
}

/** Same, for a generated detail expression (the strict list seed mismatch). */
function claimErrorFrom(detailExpr: string, anchor?: SpanLike): string {
  return `leafClaimMismatch(${detailExpr}${originArgs(anchor)})`;
}

/** Throw the leaf mismatch. Sets the runtime import flag. */
function emitClaimMismatch(
  state: EmitState,
  condition: string,
  detail: string,
  anchor?: SpanLike,
): void {
  state.usesLeafClaimMismatch = true;
  push(state, `if (${condition}) throw ${claimError(detail, anchor)};`);
}

/**
 * M07a claim parent, its element ancestors, and one claimed element must be
 * in the HTML namespace. Text and comment ancestors are not element checks.
 * A failure here is before any claim write.
 */
/**
 * The own-element namespace assertion for a claimed SVG subtree (or an HTML
 * element inside an SVG `foreignObject`). Kept beside the HTML ancestor walk so
 * the two claim namespace rules read together.
 */
function emitClaimElementNamespace(
  state: EmitState,
  nodeExpr: string,
  namespace: 'html' | 'svg',
  where: string,
  anchor?: SpanLike,
): void {
  state.usesLeafClaimMismatch = true;
  push(
    state,
    `assertElementInNamespace(${nodeExpr}, ${JSON.stringify(
      namespace === 'svg' ? SVG_NAMESPACE : HTML_NAMESPACE,
    )}, ${JSON.stringify(where)}${originArgs(anchor)});`,
  );
}

function emitClaimHtmlNamespace(
  state: EmitState,
  nodeExpr: string,
  where: string,
  anchor?: SpanLike,
): void {
  state.usesLeafClaimMismatch = true;
  push(
    state,
    `assertElementInHtmlNamespace(${nodeExpr}, ${JSON.stringify(where)}${originArgs(anchor)});`,
  );
}

/**
 * Static attribute seed: the live attributes, with dynamic slot names removed,
 * must equal the declared static attributes in value and order. Names are
 * compared after HTML ASCII case folding: the claim path requires the HTML
 * namespace and the DOM exposes HTML attribute names lowercased, so both the
 * live and the declared names are folded before the name comparison. On a
 * fully static element the skip set is empty, which is the directory rule.
 * Dynamic slot values are claim writes after this check, not part of the seed.
 */
/**
 * Static attribute seed: emit one call into the runtime predicate. The rule
 * itself (ordered exact set, HTML case-folded names, exact values) lives in
 * `claim-invariants.ts` and is shared with the directory consumer; the
 * generator only names the declared set and the dynamic names the claim writes
 * itself. Nothing about the rule is restated here.
 */
function emitClaimStaticAttributeSeed(
  state: EmitState,
  elementVar: string,
  attributes: readonly FunctionModelAttribute[],
  where: string,
  anchor?: SpanLike,
  /**
   * A nested custom-element (dash-tag) host carries runtime-managed attributes
   * the parent template never authored (the server light-root ownership marker,
   * the child's theme mirror and JSON prop seed). The claim routes those
   * through the host-aware runtime assertion so the ONE runtime-only attribute
   * fact decides the exemption; an intrinsic element keeps the strict rule.
   */
  nestedHost = false,
): void {
  const staticAttrs = attributes.filter((attribute) => attribute.kind === 'static');
  const dynamicNames = attributes
    .filter(
      (attribute) =>
        attribute.kind === 'dynamic' &&
        !CONSUMED_ATTRIBUTE_CHANNELS.has(attribute.channel) &&
        !CLIENT_ONLY_ATTRIBUTE_CHANNELS.has(attribute.channel),
    )
    .map((attribute) => attribute.name);
  const declared = staticAttrs
    .map((attribute) => {
      // The seed must spell a static BOOLEAN attribute exactly as the mount and
      // the SSR bytes do (`name=""`), or the claim compares the parsed empty
      // value against the authored "true" shorthand and fails closed.
      const seedValue = BOOLEAN_ATTRIBUTES.has(attribute.name.toLowerCase()) ? '' : attribute.value;
      return `{ name: ${JSON.stringify(attribute.name)}, value: ${JSON.stringify(seedValue)} }`;
    })
    .join(', ');
  const skip = `[${dynamicNames.map((name) => JSON.stringify(name)).join(', ')}]`;
  const assertion = nestedHost
    ? 'assertNestedHostStaticAttributeSeed'
    : 'assertStaticAttributeSeed';
  state.usesLeafClaimMismatch = true;
  push(
    state,
    `${assertion}(${elementVar}, [${declared}], ${JSON.stringify(where)}, ${skip}${originArgs(anchor)});`,
  );
}

function emitClaimTake(
  state: EmitState,
  cursor: string,
  name: string,
  where: string,
  anchor?: SpanLike,
): void {
  push(state, `const ${name} = ${cursor}.node;`);
  emitClaimMismatch(state, `${name} == null`, `missing node at ${where}`, anchor);
  push(state, `${cursor}.node = ${name}.nextSibling;`);
}

function emitClaimCursorEnd(
  state: EmitState,
  cursor: string,
  where: string,
  anchor?: SpanLike,
): void {
  emitClaimMismatch(state, `${cursor}.node !== null`, `extra node at ${where}`, anchor);
}

interface PreparedSlot {
  readonly record: LoweredExpressionRecord;
  readonly dependencies: readonly Dependency[];
}

function prepareClaimSlot(
  state: EmitState,
  expression: FunctionExpressionRef,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): PreparedSlot | null {
  const record = recordFor(state, expression, records);
  if (record === null || !declareReads(state, record)) return null;
  const dependencies = dependencyNames(state, record);
  if (dependencies === null) return null;
  return { record, dependencies };
}

/**
 * M08-2 B2: emit pending phase-2 steps at their current lexical position.
 *
 * The shared-cursor path wraps each emission in a closure pushed onto the
 * module-level activation queue, so block-scoped node bindings stay visible
 * while no subscription/write runs before the cursor owner has validated the
 * whole enclosing structure. That owner captures the queue in `try`, clears the
 * module global in `finally`, and drains the captured local afterwards. The
 * non-shared path keeps inline emission: its root structure check already runs
 * first (and its bindings are function scoped, so deferring would add no
 * safety).
 */
function emitPhase2Steps(state: EmitState, steps: readonly (() => void)[]): void {
  if (steps.length === 0) return;
  const activation = state.claimActivationVar;
  if (activation === null) {
    for (const step of steps) step();
    return;
  }
  for (const step of steps) {
    push(state, `${activation}.push(() => {`);
    state.indent += 1;
    step();
    state.indent -= 1;
    push(state, '});');
  }
}

/**
 * Emit the shared-cursor owner check plus queue initialization. A nested claim
 * finds the module cursor non-null, appends to the owner's queue and never
 * initializes, captures, clears or drains it. The returned local is the
 * owner-only handoff slot: the success-path capture lands here and the
 * `finally` clears the module global on both exits.
 */
function emitClaimQueueInit(state: EmitState, parentExpr: string): string {
  const stepsVar = nextName(state, 'phase2Steps');
  push(state, `let ${stepsVar} = null;`);
  push(state, `const ${INTERNAL_PREFIX}cursorOwned = ${INTERNAL_PREFIX}claimCursor === null;`);
  push(
    state,
    `if (${INTERNAL_PREFIX}cursorOwned) { ${INTERNAL_PREFIX}claimCursor = { node: ${parentExpr}.firstChild }; ${CLAIM_ACTIVATION} = []; }`,
  );
  return stepsVar;
}

/**
 * Success-only handoff. Emitted after the final structure check and every
 * owner-level phase-2 push, immediately before the `finally`: a verify throw
 * therefore never reaches it, while a successful owner detaches the queue from
 * the module global before the first step runs.
 */
function emitClaimActivationCapture(state: EmitState, stepsVar: string): void {
  if (state.claimActivationVar !== CLAIM_ACTIVATION) return;
  push(state, `if (${INTERNAL_PREFIX}cursorOwned) ${stepsVar} = ${CLAIM_ACTIVATION};`);
}

/**
 * Owner-only release. Runs on success and on every pre-drain throw: cursor and
 * module queue both become null. A nested claim (`cursorOwned` false) is a
 * no-op, so it never detaches the enclosing owner's queue.
 */
function emitClaimOwnerFinally(state: EmitState): void {
  push(
    state,
    `} finally { if (${INTERNAL_PREFIX}cursorOwned) { ${INTERNAL_PREFIX}claimCursor = null; ${CLAIM_ACTIVATION} = null; } }`,
  );
}

/**
 * Drain the queue the owner captured in its `try`. Owner-only and success-only
 * by construction: the local array is already detached from the module global,
 * so an activation reentry started by a step owns a different queue and cannot
 * overwrite or extend this drain.
 */
function emitClaimActivationDrain(state: EmitState, stepsVar: string): void {
  if (state.claimActivationVar !== CLAIM_ACTIVATION) return;
  const stepVar = nextName(state, 'phase2Step');
  push(state, `if (${INTERNAL_PREFIX}cursorOwned) {`);
  state.indent += 1;
  push(state, `for (const ${stepVar} of ${stepsVar}) ${stepVar}();`);
  state.indent -= 1;
  push(state, '}');
}

/**
 * Emit the initial write plus its refresh subscription. A zero-dependency slot
 * writes once and registers nothing. The write callback is the claim-period
 * helper: an equal value skips the DOM API, and a dependency still subscribes.
 */
function emitClaimSlot(
  state: EmitState,
  dependencies: readonly Dependency[],
  anchor: SpanLike,
  write: (inputValueClaim?: InputValueClaim) => void,
  adoptsInputValue = false,
): void {
  const entry = state.claimEntry;
  // Outside a list-entry claim a zero-dependency slot is one write. Inside one
  // the slot must stay re-runnable: a keyed reuse rebinds the mapper parameter
  // and `update(next)` forces the same named refresh (the M06b2c rule).
  if (dependencies.length === 0 && entry === null && !adoptsInputValue) {
    write();
    return;
  }
  const refresh = nextName(state, 'refresh');
  const inputValueClaim = adoptsInputValue
    ? { first: nextName(state, 'firstValueWrite'), previous: nextName(state, 'previousValue') }
    : undefined;
  if (inputValueClaim !== undefined) {
    push(state, `let ${inputValueClaim.first} = true;`, anchor);
    push(state, `let ${inputValueClaim.previous};`, anchor);
  }
  push(state, `function ${refresh}() {`, anchor);
  state.indent += 1;
  write(inputValueClaim);
  state.indent -= 1;
  push(state, `}`);
  if (entry !== null) {
    entry.refreshes.push(refresh);
    entry.activate.push(() => {
      push(state, `${refresh}();`);
      if (dependencies.length > 0) {
        emitDependencySubscriptions(state, dependencies, refresh, anchor);
      }
    });
    return;
  }
  push(state, `${refresh}();`);
  emitDependencySubscriptions(state, dependencies, refresh, anchor);
}

/**
 * One condition-branch claim chunk. The emitted function is the read-only half
 * of the condition claim: it walks the client branch template against the
 * shared `{node}` cursor, adopts its nodes, and returns an `activate` closure
 * whose body is emitted only from the caller's phase-2 steps. Calling the
 * function therefore performs no subscription and no DOM write; the claim walk
 * for the enclosing tree stays read-only until the root flush.
 *
 * The function is a chunk: its text-slot ordinals restart at 0 and its static
 * top-level runs use the same normalized view as mount/SSR. Its internal cursor
 * is the explicit parameter, so the shared-cursor mode is disabled while its
 * body is emitted; the caller passes either a local cursor object or the
 * module-level shared cursor object.
 */
function emitClaimConditionBranchBuilder(
  state: EmitState,
  functionName: string,
  scopeParam: string,
  cursorParam: string,
  nodes: readonly FunctionModelNode[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  path: string,
  anchor: SpanLike,
): void {
  push(state, `function ${functionName}(${scopeParam}, ${cursorParam}) {`, anchor);
  state.indent += 1;
  const outerScope = state.scopeVar;
  const outerOrdinals = state.textOrdinals;
  const outerShared = state.claimCursorShared;
  const outerActivation = state.claimActivationVar;
  state.scopeVar = scopeParam;
  state.claimCursorShared = false;
  // This chunk's own phase 2 belongs to the returned `activate` closure: it is
  // called by the enclosing condition step after branch structure was adopted,
  // so it must not append to the module activation queue.
  state.claimActivationVar = null;
  const prepared = emissionNodes(state, nodes);
  state.textOrdinals = textSlotOrdinals(prepared);
  const nodesVar = nextName(state, 'branchNodes');
  push(state, `const ${nodesVar} = [];`);
  const phase2: Array<() => void> = [];
  emitClaimInto(
    state,
    prepared,
    cursorParam,
    path,
    records,
    phase2,
    (name) => {
      push(state, `${nodesVar}.push(${name});`);
    },
    (name, condition) => {
      push(state, `if (${condition}) ${nodesVar}.push(${name});`);
    },
    'null',
    false,
  );
  push(state, 'function activate() {');
  state.indent += 1;
  emitPhase2Steps(state, phase2);
  state.indent -= 1;
  push(state, '}');
  push(state, `return { nodes: ${nodesVar}, activate };`);
  state.textOrdinals = outerOrdinals;
  state.claimCursorShared = outerShared;
  state.claimActivationVar = outerActivation;
  state.scopeVar = outerScope;
  state.indent -= 1;
  push(state, '}');
}

/**
 * Claim one condition. Verify is read-only: the anchor/end are asserted, the
 * test is evaluated once, the selected client branch is adopted through its
 * read-only claim chunk (or a server-empty branch is marked for insert), and
 * the owner/nodes are registered. Subscription and writes are queued on
 * `phase2`; the caller flushes them only after the whole claim walk succeeded.
 *
 * There is no branch id. A branch is identified by the client template's own
 * structure, static attribute seed, text values and slot ordinals, which the
 * ordinary claim walk already checks. A server branch that does not match the
 * client branch is a mismatch; a server-empty branch is the only insertion
 * path, and it is explicitly non-transactional activation work.
 */
function emitConditionClaim(
  state: EmitState,
  node: FunctionModelCondition,
  cursor: string,
  path: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  phase2: Array<() => void>,
  adopt: (name: string) => void,
): void {
  const slot = prepareClaimSlot(state, node.test, records);
  if (slot === null) return;
  const here = path;
  const anchorVar = nextName(state, 'whenAnchor');
  push(state, `const ${anchorVar} = ${cursor}.node;`, node.span);
  push(
    state,
    `assertWhenAnchor(${anchorVar}, ${JSON.stringify(`${here}/anchor`)}${originArgs(node.span)});`,
    node.span,
  );
  push(state, `${cursor}.node = ${anchorVar}.nextSibling;`);

  // Mount-style create builders for later toggles and for the server-empty
  // insert path. They are emitted once per condition into the same chunk the
  // claim lives in; their scope parameter is the branch owner, so subscriptions
  // and writes they create are owned by that branch.
  const thenCreate = node.consequent.length > 0 ? nextName(state, 'whenThen') : null;
  if (thenCreate !== null) {
    emitNodesBuilder(
      state,
      thenCreate,
      nextName(state, 'whenThenScope'),
      node.consequent,
      records,
      node.span,
    );
  }
  const elseCreate =
    node.alternate !== null && node.alternate.length > 0 ? nextName(state, 'whenElse') : null;
  if (elseCreate !== null) {
    emitNodesBuilder(
      state,
      elseCreate,
      nextName(state, 'whenElseScope'),
      node.alternate!,
      records,
      node.span,
    );
  }

  // Read-only adoption chunks for the client branches. A branch with no nodes
  // has no builder: its whole verify is the end-marker check below.
  const thenClaim = node.consequent.length > 0 ? nextName(state, 'whenThenClaim') : null;
  if (thenClaim !== null) {
    emitClaimConditionBranchBuilder(
      state,
      thenClaim,
      nextName(state, 'whenThenClaimScope'),
      cursor,
      node.consequent,
      records,
      `${here}/then`,
      node.span,
    );
  }
  const elseClaim =
    node.alternate !== null && node.alternate.length > 0 ? nextName(state, 'whenElseClaim') : null;
  if (elseClaim !== null) {
    emitClaimConditionBranchBuilder(
      state,
      elseClaim,
      nextName(state, 'whenElseClaimScope'),
      cursor,
      node.alternate!,
      records,
      `${here}/else`,
      node.span,
    );
  }

  const testVar = nextName(state, 'whenTest');
  pushParts(state, [`const ${testVar} = (`, { record: slot.record }, ');'], node.span);
  const activeVar = nextName(state, 'whenActive');
  const emptyActive = elseCreate === null ? 0 : 2;
  push(state, `let ${activeVar} = ${testVar} ? 1 : ${emptyActive};`);
  const ownerVar = nextName(state, 'whenOwner');
  const nodesVar = nextName(state, 'whenNodes');
  const adoptedVar = nextName(state, 'whenAdopted');
  const insertVar = nextName(state, 'whenInsert');
  push(state, `let ${ownerVar} = null;`);
  push(state, `let ${nodesVar} = [];`);
  push(state, `let ${adoptedVar} = null;`);
  push(state, `let ${insertVar} = false;`);

  const verifyBranch = (activeValue: number, claimFn: string | null): void => {
    push(state, `if (${activeVar} === ${activeValue}) {`);
    state.indent += 1;
    if (claimFn !== null) {
      push(state, `if (isWhenEndMarker(${cursor}.node)) {`);
      state.indent += 1;
      push(state, `${insertVar} = true;`);
      state.indent -= 1;
      push(state, `} else {`);
      state.indent += 1;
      push(state, `${ownerVar} = ${state.scopeVar}.child();`);
      push(state, 'try {');
      state.indent += 1;
      push(state, `${adoptedVar} = ${claimFn}(${ownerVar}, ${cursor});`, node.span);
      state.indent -= 1;
      push(state, `} catch (error) { ${ownerVar}.dispose(false); throw error; }`);
      push(state, `${nodesVar} = ${adoptedVar}.nodes;`);
      state.indent -= 1;
      push(state, '}');
    }
    state.indent -= 1;
    push(state, '}');
  };
  verifyBranch(1, thenClaim);
  verifyBranch(2, elseClaim);

  push(
    state,
    `assertWhenEndMarker(${cursor}.node, ${JSON.stringify(`${here}/end`)}${originArgs(node.span)});`,
    node.span,
  );
  const endVar = nextName(state, 'whenEnd');
  push(state, `const ${endVar} = ${cursor}.node;`);
  push(state, `${cursor}.node = ${endVar}.nextSibling;`);
  push(state, `if (${ownerVar} === null) ${ownerVar} = ${state.scopeVar}.child();`);
  push(state, `${ownerVar}.addRangeCleanup(() => removeNodes(${nodesVar}));`, node.span);

  // Adopt the markers and any existing branch nodes. Server-empty insertion
  // happens in phase 2, so its created nodes are intentionally not part of this
  // adopted list; the two markers are the stable root-level nodes.
  adopt(anchorVar);
  const childVar = nextName(state, 'whenChild');
  push(state, `for (const ${childVar} of ${nodesVar}) {`);
  adopt(childVar);
  push(state, '}');
  adopt(endVar);

  // The update path mirrors mount: dispose the old branch owner (range cleanup
  // removes only that branch's adopted/created nodes), create the next branch on
  // a fresh child scope and insert it before the end marker. The end marker
  // itself belongs to the enclosing claim owner.
  const refreshVar = nextName(state, 'whenRefresh');
  const nextVar = nextName(state, 'whenNext');
  const branchOwnerVar = nextName(state, 'whenBranchOwner');
  const branchNodesVar = nextName(state, 'whenBranchNodes');
  const refreshParentVar = nextName(state, 'whenParent');
  push(state, `function ${refreshVar}(force) {`, node.span);
  state.indent += 1;
  pushParts(
    state,
    [`const ${nextVar} = (`, { record: slot.record }, `) ? 1 : ${emptyActive};`],
    node.span,
  );
  push(state, `if (!force && ${nextVar} === ${activeVar}) return;`);
  push(state, `${activeVar} = -1;`);
  if (emitsRetentionReleaseText(state)) {
    emitBranchRelease(state, ownerVar);
  } else {
    push(state, `if (${ownerVar} !== null) ${ownerVar}.dispose(true);`);
  }
  push(state, `${ownerVar} = null;`);
  push(state, `const ${branchOwnerVar} = ${state.scopeVar}.child();`);
  push(state, `let ${branchNodesVar};`);
  push(state, 'try {');
  state.indent += 1;
  const thenCall = thenCreate === null ? '[]' : `${thenCreate}(${branchOwnerVar})`;
  const elseCall = elseCreate === null ? '[]' : `${elseCreate}(${branchOwnerVar})`;
  push(
    state,
    `${branchNodesVar} = runUntracked(() => ${nextVar} === 1 ? ${thenCall} : ${elseCall});`,
  );
  state.indent -= 1;
  if (emitsRetentionReleaseText(state)) {
    emitBranchRollback(state, branchOwnerVar, activeVar);
  } else {
    push(
      state,
      `} catch (error) { ${activeVar} = -1; ${branchOwnerVar}.dispose(true); throw error; }`,
    );
  }
  push(state, `${branchOwnerVar}.addRangeCleanup(() => removeNodes(${branchNodesVar}));`);
  push(state, `const ${refreshParentVar} = ${endVar}.parentNode;`);
  push(
    state,
    `if (${refreshParentVar} !== null) { for (const ${childVar} of ${branchNodesVar}) ${refreshParentVar}.insertBefore(${childVar}, ${endVar}); }`,
  );
  push(
    state,
    `${nodesVar} = ${branchNodesVar}; ${ownerVar} = ${branchOwnerVar}; ${activeVar} = ${nextVar};`,
  );
  state.indent -= 1;
  push(state, '}');

  phase2.push(() => {
    push(state, `if (${adoptedVar} !== null) ${adoptedVar}.activate();`);
  });
  if (slot.dependencies.length > 0) {
    phase2.push(() => {
      emitDependencySubscriptions(state, slot.dependencies, refreshVar, node.span, {
        ignoreSignalValue: true,
      });
    });
  }
  if (thenCreate !== null || elseCreate !== null) {
    phase2.push(() => {
      push(state, `if (${insertVar}) {`);
      state.indent += 1;
      const insertNodesVar = nextName(state, 'whenInsertNodes');
      const insertParentVar = nextName(state, 'whenInsertParent');
      push(state, `let ${insertNodesVar};`);
      push(state, 'try {');
      state.indent += 1;
      const insertThen = thenCreate === null ? '[]' : `${thenCreate}(${ownerVar})`;
      const insertElse = elseCreate === null ? '[]' : `${elseCreate}(${ownerVar})`;
      push(state, `${insertNodesVar} = ${activeVar} === 1 ? ${insertThen} : ${insertElse};`);
      state.indent -= 1;
      push(state, `} catch (error) { ${ownerVar}.dispose(true); throw error; }`);
      push(state, `const ${insertParentVar} = ${endVar}.parentNode;`);
      push(
        state,
        `if (${insertParentVar} !== null) { for (const ${childVar} of ${insertNodesVar}) ${insertParentVar}.insertBefore(${childVar}, ${endVar}); }`,
      );
      push(state, `${nodesVar} = ${insertNodesVar};`);
      state.indent -= 1;
      push(state, '}');
    });
  }
}

/**
 * One list-entry claim chunk. The walk is read-only: it adopts the entry's
 * existing marker/content through the shared cursor and creates no DOM node,
 * opens no subscription and writes no value. Every dynamic slot becomes a
 * named refresh at this function's scope (zero-dependency slots included), so
 * `update(next)` can rebind the mapper parameter and re-render the same nodes
 * (the M06b2c entry-local rule). `activate(next)` rebinds the item, runs the
 * compare-write refresh once and opens the entry-local subscriptions; the
 * enclosing claim calls it only from the activation phase.
 */
function emitClaimEntryBuilder(
  state: EmitState,
  functionName: string,
  scopeParam: string,
  cursorParam: string,
  itemParam: string,
  itemName: string,
  nodes: readonly FunctionModelNode[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  path: string,
  anchor: SpanLike,
): void {
  push(state, `function ${functionName}(${scopeParam}, ${cursorParam}, ${itemParam}) {`, anchor);
  state.indent += 1;
  const outerScope = state.scopeVar;
  const outerOrdinals = state.textOrdinals;
  const outerShared = state.claimCursorShared;
  const outerActivation = state.claimActivationVar;
  const outerEntry = state.claimEntry;
  state.scopeVar = scopeParam;
  state.claimCursorShared = false;
  state.claimActivationVar = null;
  const entry = { refreshes: [] as string[], activate: [] as Array<() => void> };
  state.claimEntry = entry;
  const outerEntryName = state.entryNames.has(itemName);
  state.entryNames.add(itemName);
  const prepared = emissionNodes(state, nodes);
  state.textOrdinals = textSlotOrdinals(prepared);
  const nodesVar = nextName(state, 'entryNodes');
  push(state, `const ${nodesVar} = [];`);
  push(state, `let ${itemName} = ${itemParam};`);
  const phase2: Array<() => void> = [];
  emitClaimInto(
    state,
    prepared,
    cursorParam,
    path,
    records,
    phase2,
    (name) => push(state, `${nodesVar}.push(${name});`),
    (name, condition) => push(state, `if (${condition}) ${nodesVar}.push(${name});`),
    'null',
    false,
  );
  // The slot refreshes are emitted at the builder scope, not inside `activate`;
  // `update(next)` must be able to call the same closures after rebinding item.
  emitPhase2Steps(state, phase2);
  push(state, 'function activate(next) {');
  state.indent += 1;
  push(state, `${itemName} = next;`);
  for (const step of entry.activate) step();
  state.indent -= 1;
  push(state, '}');
  const update = [`${itemName} = next;`, ...entry.refreshes.map((name) => `${name}(true);`)].join(
    ' ',
  );
  push(state, `return { nodes: ${nodesVar}, activate, update(next) { ${update} } };`);
  if (!outerEntryName) state.entryNames.delete(itemName);
  state.textOrdinals = outerOrdinals;
  state.claimCursorShared = outerShared;
  state.claimActivationVar = outerActivation;
  state.claimEntry = outerEntry;
  state.scopeVar = outerScope;
  state.indent -= 1;
  push(state, '}');
}

/**
 * One claim-time keyed sync. `previous` is the seeded list on the strict first
 * call and the live entry list afterwards. Matching keeps mount's
 * `entry.key === key` identity plus the mount used-set rule, so duplicate
 * client keys adopt the wire entry once per occurrence and insert the
 * remainder. The strict call is the seed assignment's defense: an unmatched
 * seeded entry is a mismatch, never a delete. The non-strict refresh disposes
 * removed entries exactly like mount.
 *
 * Every key is preflighted with `encodeListKey` before any mutation, and an
 * inserted entry writes its marker from `encodeListKey`, never the mount-only
 * `u` payload. An unsupported update therefore fails closed with the old DOM,
 * owners and entries intact; the caller's refresh assignment keeps the previous
 * entry list, so a later legal signal value recovers.
 */
function emitClaimListSync(
  state: EmitState,
  functionName: string,
  entryCreateFn: string,
  endVar: string,
  path: string,
  anchor: SpanLike,
): void {
  push(state, `function ${functionName}(items, keys, previous, strict) {`, anchor);
  state.indent += 1;
  // A supported key is a precondition of every write below. The preflight runs
  // before matching, updates, inserts and placement, so a claimed list that is
  // updated to an unsupported key throws the internal unsupported identity with
  // the claimed DOM, owners and entries untouched. The refresh assignment keeps
  // the previous entry list, so the next legal signal value can recover.
  push(state, 'for (const key of keys) encodeListKey(key);');
  push(state, 'const next = [];');
  push(state, 'const used = new Set();');
  push(state, 'for (let index = 0; index < items.length; index++) {');
  state.indent += 1;
  push(state, 'const item = items[index];');
  push(state, 'const key = keys[index];');
  push(state, 'let found = null;');
  push(
    state,
    'for (const entry of previous) { if (entry.key === key && !used.has(entry)) { found = entry; break; } }',
  );
  push(state, 'if (found !== null) {');
  state.indent += 1;
  push(state, 'used.add(found); found.item = item; found.update(item); next.push(found);');
  state.indent -= 1;
  push(state, '} else {');
  state.indent += 1;
  push(state, `const owner = ${state.scopeVar}.child();`);
  push(state, 'let built;');
  push(state, 'try {');
  state.indent += 1;
  push(state, `built = ${entryCreateFn}(owner, item);`);
  state.indent -= 1;
  push(state, '} catch (error) { owner.dispose(true); throw error; }');
  push(state, 'const token = encodeListKey(key);');
  push(state, 'built.nodes.unshift(emitComment(entryKeyMarker(token)));');
  push(state, 'owner.addRangeCleanup(() => removeNodes(built.nodes));');
  push(state, 'next.push({ key, item, owner, nodes: built.nodes, update: built.update });');
  state.indent -= 1;
  push(state, '}');
  state.indent -= 1;
  push(state, '}');
  push(state, 'for (const entry of previous) if (!used.has(entry)) {');
  state.indent += 1;
  push(
    state,
    `if (strict) throw ${claimError(`server entry key has no client item at ${path}/each`, anchor)};`,
  );
  push(state, 'entry.owner.dispose(true);');
  state.indent -= 1;
  push(state, '}');
  push(state, `const parent = ${endVar}.parentNode;`);
  push(state, 'if (parent !== null) {');
  state.indent += 1;
  push(state, `let reference = ${endVar};`);
  push(state, 'for (let entryIndex = next.length - 1; entryIndex >= 0; entryIndex--) {');
  state.indent += 1;
  push(state, 'const nodes = next[entryIndex].nodes;');
  push(state, 'for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) {');
  state.indent += 1;
  push(state, 'const node = nodes[nodeIndex];');
  push(
    state,
    'if (node.parentNode !== parent || node.nextSibling !== reference) parent.insertBefore(node, reference);',
  );
  push(state, 'reference = node;');
  state.indent -= 1;
  push(state, '}');
  state.indent -= 1;
  push(state, '}');
  state.indent -= 1;
  push(state, '}');
  push(state, 'return next;');
  state.indent -= 1;
  push(state, '}');
}

/**
 * Claim one keyed (or unkeyed positional) list.
 *
 * Verify order is deliberate: anchor, every `oe:k:` entry and its read-only
 * template adoption, the `oe:/each` end, then one items evaluation and one key
 * evaluation per item. The seed predicate runs before any assignment write or
 * activation; a wire token with more occurrences than the client list, an extra
 * wire token or an unsupported wire key leaves the borrowed DOM untouched and
 * opens no subscription. The seed predicate's client-key failure is also the
 * only place an unsupported client key can stop the claim. Each wire occurrence
 * is assigned the next client occurrence of the same token, so duplicates are
 * distinct identities and reorder is grouped per token.
 *
 * Activation is queued on the shared phase-2 path: every seeded entry activates
 * (compare-write refresh + subscriptions), then the list/key outer
 * subscriptions, then one strict sync. A client-more seed inserts after that;
 * reorder only moves existing nodes. No seeded node is ever deleted. The strict
 * sync preflights every key with `encodeListKey`, so an unsupported key throws
 * before any DOM write (the claimed `u`-free contract).
 */
function emitClaimList(
  state: EmitState,
  node: FunctionModelList,
  cursor: string,
  path: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  phase2: Array<() => void>,
  adopt: (name: string) => void,
): void {
  const slot = prepareClaimSlot(state, node.items, records);
  if (slot === null) return;
  const here = path;
  const anchorVar = nextName(state, 'eachAnchor');
  push(state, `const ${anchorVar} = ${cursor}.node;`, node.span);
  push(
    state,
    `assertEachAnchor(${anchorVar}, ${JSON.stringify(`${here}/each/anchor`)}${originArgs(node.span)});`,
    node.span,
  );
  push(state, `${cursor}.node = ${anchorVar}.nextSibling;`);
  adopt(anchorVar);

  const entryClaimFn = nextName(state, 'eachEntryClaim');
  emitClaimEntryBuilder(
    state,
    entryClaimFn,
    nextName(state, 'eachEntryClaimScope'),
    cursor,
    nextName(state, 'eachEntryItem'),
    node.parameter,
    node.template,
    records,
    `${here}/each/entry`,
    node.span,
  );
  const entryCreateFn = nextName(state, 'eachEntryCreate');
  state.listDepth += 1;
  try {
    emitEntryBuilder(
      state,
      entryCreateFn,
      nextName(state, 'eachCreateScope'),
      nextName(state, 'eachCreateItem'),
      node.parameter,
      node.template,
      records,
      node.span,
    );
  } finally {
    state.listDepth -= 1;
  }
  const keyFn = nextName(state, 'eachKey');
  const keyInfo = emitListKeyFunction(state, keyFn, node, records);
  if (keyInfo === null) return;
  const keyDependencies = keyInfo.dependencies;

  const wireTokensVar = nextName(state, 'eachWireTokens');
  const seededVar = nextName(state, 'eachSeeded');
  push(state, `const ${wireTokensVar} = [];`);
  push(state, `const ${seededVar} = [];`);
  push(state, 'for (;;) {');
  state.indent += 1;
  const markerVar = nextName(state, 'entryMarker');
  push(state, `const ${markerVar} = ${cursor}.node;`);
  const parsedVar = nextName(state, 'entryParsed');
  push(
    state,
    `const ${parsedVar} = ${markerVar} !== null && ${markerVar}.nodeType === 8 ? parseEntryKeyMarker(${markerVar}.nodeValue) : null;`,
  );
  push(state, `if (${parsedVar} === null) break;`);
  const tokenVar = nextName(state, 'entryToken');
  push(
    state,
    `const ${tokenVar} = readEntryKeyMarker(${markerVar}, ${JSON.stringify(`${here}/each/entry`)}${originArgs(node.span)});`,
  );
  push(state, `${cursor}.node = ${markerVar}.nextSibling;`);
  const ownerVar = nextName(state, 'entryOwner');
  push(state, `const ${ownerVar} = ${state.scopeVar}.child();`);
  const builtVar = nextName(state, 'entryBuilt');
  push(state, `let ${builtVar};`);
  push(state, 'try {');
  state.indent += 1;
  push(state, `${builtVar} = ${entryClaimFn}(${ownerVar}, ${cursor}, null);`);
  state.indent -= 1;
  push(state, `} catch (error) { ${ownerVar}.dispose(false); throw error; }`);
  push(
    state,
    `${ownerVar}.addRangeCleanup(() => removeNodes([${markerVar}, ...${builtVar}.nodes]));`,
  );
  const seededEntryVar = nextName(state, 'entry');
  push(
    state,
    `const ${seededEntryVar} = { token: ${tokenVar}, key: null, item: null, assigned: false, owner: ${ownerVar}, nodes: [${markerVar}, ...${builtVar}.nodes], activate: ${builtVar}.activate, update: ${builtVar}.update };`,
  );
  push(state, `${seededVar}.push(${seededEntryVar}); ${wireTokensVar}.push(${tokenVar});`);
  adopt(markerVar);
  const adoptedChildVar = nextName(state, 'entryChild');
  push(state, `for (const ${adoptedChildVar} of ${builtVar}.nodes) {`);
  adopt(adoptedChildVar);
  push(state, '}');
  state.indent -= 1;
  push(state, '}');
  push(
    state,
    `assertEachEndMarker(${cursor}.node, ${JSON.stringify(`${here}/each/end`)}${originArgs(node.span)});`,
    node.span,
  );
  const endVar = nextName(state, 'eachEnd');
  push(state, `const ${endVar} = ${cursor}.node;`);
  push(state, `${cursor}.node = ${endVar}.nextSibling;`);
  adopt(endVar);

  const itemsVar = nextName(state, 'eachItems');
  pushParts(state, [`const ${itemsVar} = (`, { record: slot.record }, ');'], node.span);
  const keysVar = nextName(state, 'eachKeys');
  const tokensVar = nextName(state, 'eachTokens');
  push(state, `const ${keysVar} = [];`);
  push(state, `const ${tokensVar} = [];`);
  push(state, `for (let index = 0; index < ${itemsVar}.length; index++) {`);
  state.indent += 1;
  push(state, `const key = ${keyFn}(${itemsVar}[index], index);`);
  push(state, `${keysVar}.push(key); ${tokensVar}.push(tryEncodeListKey(key));`);
  state.indent -= 1;
  push(state, '}');
  const mismatchVar = nextName(state, 'seedMismatch');
  push(state, `const ${mismatchVar} = entrySeedMismatch(${wireTokensVar}, ${tokensVar});`);
  // The detail stays a generated expression; the origin is still the authored
  // list node, so the strict seed mismatch reports where the list was written.
  const seedDetail = `${mismatchVar} + ${JSON.stringify(` at ${here}/each`)}`;
  push(state, `if (${mismatchVar} !== null) throw ${claimErrorFrom(seedDetail, node.span)};`);
  push(state, `for (let index = 0; index < ${itemsVar}.length; index++) {`);
  state.indent += 1;
  push(state, `const token = ${tokensVar}[index];`);
  push(state, 'if (token === null) continue;');
  push(state, `for (const entry of ${seededVar}) {`);
  state.indent += 1;
  push(
    state,
    'if (!entry.assigned && entry.token === token) { entry.assigned = true; entry.key = ' +
      `${keysVar}[index]; entry.item = ${itemsVar}[index]; break; }`,
  );
  state.indent -= 1;
  push(state, '}');
  state.indent -= 1;
  push(state, '}');
  push(
    state,
    `for (const entry of ${seededVar}) if (!entry.assigned) throw ${claimError(`server entry key has no client item at ${here}/each`, node.span)};`,
  );

  const entriesVar = nextName(state, 'eachEntries');
  push(state, `let ${entriesVar} = [];`);
  const syncFn = nextName(state, 'eachSync');
  emitClaimListSync(state, syncFn, entryCreateFn, endVar, here, node.span);
  const refreshVar = nextName(state, 'eachRefresh');
  push(state, `function ${refreshVar}() {`, node.span);
  state.indent += 1;
  const refreshItemsVar = nextName(state, 'eachItems');
  pushParts(state, [`const ${refreshItemsVar} = (`, { record: slot.record }, ');'], node.span);
  const refreshKeysVar = nextName(state, 'eachKeys');
  push(state, `const ${refreshKeysVar} = [];`);
  push(state, `for (let index = 0; index < ${refreshItemsVar}.length; index++) {`);
  state.indent += 1;
  push(state, `${refreshKeysVar}.push(${keyFn}(${refreshItemsVar}[index], index));`);
  state.indent -= 1;
  push(state, '}');
  push(
    state,
    `${entriesVar} = ${syncFn}(${refreshItemsVar}, ${refreshKeysVar}, ${entriesVar}, false);`,
  );
  state.indent -= 1;
  push(state, '}');

  phase2.push(() => {
    push(state, `for (const entry of ${seededVar}) entry.activate(entry.item);`);
  });
  const subscribed = new Set<string>();
  const uniqueDependencies: Dependency[] = [];
  for (const dependency of [...slot.dependencies, ...keyDependencies]) {
    if (subscribed.has(dependency.name)) continue;
    subscribed.add(dependency.name);
    uniqueDependencies.push(dependency);
  }
  if (uniqueDependencies.length > 0) {
    phase2.push(() => {
      emitDependencySubscriptions(state, uniqueDependencies, refreshVar, node.span);
    });
  }
  phase2.push(() => {
    push(state, `${entriesVar} = ${syncFn}(${itemsVar}, ${keysVar}, ${seededVar}, true);`);
  });
  registerRefresh(state, refreshVar);
}

function emitClaimInto(
  state: EmitState,
  nodes: readonly FunctionModelNode[],
  cursor: string,
  path: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  phase2: Array<() => void>,
  adopt: (name: string) => void,
  adoptIf: (name: string, condition: string) => void,
  parentExpr: string,
  collect: boolean,
  namespace: 'html' | 'svg' = 'html',
): void {
  const list = state.emitTextBoundaries ? normalizeTextRuns(nodes) : nodes;
  list.forEach((node, index) => {
    if (state.diagnostics.length > 0) return;
    const here = `${path}/${index}`;
    if (node.kind === 'condition') {
      emitConditionClaim(state, node, cursor, here, records, phase2, adopt);
      return;
    }
    if (node.kind === 'list') {
      emitClaimList(state, node, cursor, here, records, phase2, adopt);
      return;
    }
    if (node.kind === 'fragment') {
      emitClaimInto(
        state,
        node.children,
        cursor,
        here,
        records,
        phase2,
        adopt,
        adoptIf,
        parentExpr,
        collect,
        namespace,
      );
      return;
    }
    if (node.kind === 'insertion-site') {
      emitClaimInsertion(state, node, parentExpr, collect);
      return;
    }
    if (node.kind === 'children-projection') {
      emitClaimChildrenProjection(state, node, parentExpr, collect);
      return;
    }
    if (node.kind === 'component-ref') {
      emitClaimComponentRef(state, node, records, parentExpr, collect);
      return;
    }
    if (node.kind === 'text') {
      const name = nextName(state, 'text');
      emitClaimTake(state, cursor, name, here, node.span);
      emitClaimMismatch(
        state,
        `${name}.nodeType !== 3 || ${name}.nodeValue !== ${JSON.stringify(node.value)}`,
        `static text at ${here}`,
        node.span,
      );
      adopt(name);
      return;
    }
    if (node.kind === 'dynamic-text') {
      const slot = prepareClaimSlot(state, node.expression, records);
      if (slot === null) return;
      const ordinal = textOrdinal(state, node);
      if (ordinal === null) return;
      const start = nextName(state, 'textStart');
      emitClaimTake(state, cursor, start, `${here}/text-start`, node.span);
      push(
        state,
        `assertTextSlotMarker(${start}, ${ordinal}, false, ${JSON.stringify(`${here}/text-start`)}${originArgs(node.span)});`,
        node.span,
      );
      const slotText = nextName(state, 'slotText');
      push(state, `let ${slotText} = null;`);
      const maybeText = nextName(state, 'maybeText');
      push(state, `const ${maybeText} = ${cursor}.node;`);
      push(state, `if (${maybeText} !== null && ${maybeText}.nodeType === 3) {`);
      push(state, `  ${slotText} = ${maybeText};`);
      push(state, `  ${cursor}.node = ${maybeText}.nextSibling;`);
      push(state, `}`);
      const end = nextName(state, 'textEnd');
      emitClaimTake(state, cursor, end, `${here}/text-end`, node.span);
      push(
        state,
        `assertTextSlotMarker(${end}, ${ordinal}, true, ${JSON.stringify(`${here}/text-end`)}${originArgs(node.span)});`,
        node.span,
      );
      adopt(start);
      adoptIf(slotText, `${slotText} !== null`);
      adopt(end);
      phase2.push(() =>
        emitClaimSlot(state, slot.dependencies, node.span, () =>
          emitClaimTextSlotWrite(state, slotText, end, slot.record),
        ),
      );
      return;
    }
    if (node.kind === 'element') {
      const name = nextName(state, 'el');
      // alpha16 nested-expansion: a dash tag is a NESTED custom-element host,
      // exactly as in the SSR producer. Its tag carries runtime-managed
      // attributes the parent never authored, and when the render expanded a
      // LIGHT-root child its children are that child's region — so both facts
      // route through the host-aware runtime predicates below.
      const isNestedHost = node.tag.includes('-');
      emitClaimTake(state, cursor, name, here, node.span);
      emitClaimMismatch(
        state,
        `${name}.nodeType !== 1 || String(${name}.localName || ${name}.tagName || "").toLowerCase() !== ${JSON.stringify(node.tag)}`,
        `expected element '${node.tag}' at ${here}`,
        node.span,
      );
      const elementNamespace = node.tag === 'svg' ? 'svg' : namespace;
      if (elementNamespace === 'svg') {
        emitClaimElementNamespace(state, name, 'svg', here, node.span);
      } else if (namespace === 'svg') {
        // HTML inside an SVG subtree (`foreignObject`): the element itself is
        // HTML, but its ancestors are legitimately SVG, so the own-namespace
        // rule applies instead of the ancestor walk.
        emitClaimElementNamespace(state, name, 'html', here, node.span);
      } else {
        emitClaimHtmlNamespace(state, name, here, node.span);
      }
      emitClaimStaticAttributeSeed(state, name, node.attributes, here, node.span, isNestedHost);
      for (const attribute of node.attributes) {
        if (attribute.kind === 'static') continue;
        if (attribute.kind === 'dynamic' && CONSUMED_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
          continue;
        }
        if (attribute.kind === 'dynamic' && CLIENT_ONLY_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
          if (!clientOnlyAttributeAdmitted(state, node.tag, attribute.name, attribute.span)) {
            return;
          }
          const record = recordFor(state, attribute.expression, records);
          if (record === null || !declareReads(state, record)) return;
          const elementName = name;
          const clientAttribute = attribute;
          phase2.push(() => emitClientOnlyInstall(state, elementName, clientAttribute, record));
          continue;
        }
        const slot = prepareClaimSlot(state, attribute.expression, records);
        if (slot === null) return;
        const attributeName = attribute.name;
        const channel = attribute.channel;
        const span = attribute.span;
        const adoptsInputValue =
          elementNamespace === 'html' &&
          node.tag === 'input' &&
          channel === 'property' &&
          attributeName === 'value';
        phase2.push(() =>
          emitClaimSlot(
            state,
            slot.dependencies,
            span,
            (inputValueClaim) =>
              emitClaimAttributeWrite(
                state,
                name,
                attributeName,
                channel,
                slot.record,
                span,
                inputValueClaim,
              ),
            adoptsInputValue,
          ),
        );
      }
      const ranges = directoryParentAllowed(node.tag)
        ? staticElementDirectory(node.children)
        : null;
      const emitClaimChildren = (): void => {
        if (ranges !== null) {
          emitClaimedDirectory(state, name, ranges);
          return;
        }
        const childCursor = nextName(state, 'cursor');
        push(state, `const ${childCursor} = { node: ${name}.firstChild };`);
        const saved = state.claimCursorShared ? nextName(state, 'savedCursor') : null;
        // Shared-cursor interiors are a `try` block. Child node bindings are
        // block-scoped, so their refresh closures must be emitted in that same
        // block; flushing them on the parent phase2 would name a binding the
        // refresh cannot see.
        const childPhase2: Array<() => void> = [];
        if (saved !== null) {
          push(state, `const ${saved} = __oe_claimCursor;`);
          push(state, `__oe_claimCursor = ${childCursor};`);
          push(state, 'try {');
          state.indent += 1;
        }
        emitClaimInto(
          state,
          node.children,
          childCursor,
          here,
          records,
          saved !== null ? childPhase2 : phase2,
          () => {},
          () => {},
          name,
          false,
          elementNamespace,
        );
        emitClaimCursorEnd(state, childCursor, here, node.span);
        if (saved !== null) {
          emitPhase2Steps(state, childPhase2);
          state.indent -= 1;
          push(state, `} finally { __oe_claimCursor = ${saved}; }`);
        }
      };
      if (isNestedHost && node.children.length === 0) {
        // A childless nested host's interior is NOT the parent's to claim:
        //   - an expanded LIGHT-root child wrote its content as this element's
        //     children (`data-oe-light` is the ownership marker), so the child's
        //     own element claim consumes them and the parent must treat the
        //     interior as opaque;
        //   - with no marker the host owns no light region, so the strict empty
        //     child check stays: a foreign node injected there is still drift.
        emitClaimMismatch(
          state,
          `!isExpandedLightRootHost(${name}) && ${name}.firstChild !== null`,
          `extra node at ${here}`,
          node.span,
        );
      } else if (isNestedHost) {
        // An expanded light child owns its whole interior, including its
        // fallback when the caller produced no visible children. If it received
        // caller content, the shared marker makes both upgrade orders fail
        // closed before either side can claim through the other.
        push(state, `if (isExpandedLightRootHost(${name})) { /* child-owned fallback */ } else {`);
        state.indent += 1;
        emitClaimChildren();
        state.indent -= 1;
        push(state, '}');
      } else if (ranges !== null) {
        emitClaimedDirectory(state, name, ranges);
      } else {
        emitClaimChildren();
      }
      adopt(name);
    }
  });
}

function emitClaimCollectedList(state: EmitState, listExpr: string, collect: boolean): void {
  if (!collect || state.claimAdoptedVar === null) return;
  const child = nextName(state, 'child');
  push(state, `for (const ${child} of ${listExpr}) ${state.claimAdoptedVar}.push(${child});`);
}

/**
 * One reusable-JSX insertion during claim. The recipe claim adopts its own
 * nodes from the active cursor; this call only opens an independent projection.
 */
function emitClaimInsertion(
  state: EmitState,
  node: FunctionModelInsertionSite,
  parentExpr: string,
  collect: boolean,
): void {
  const recipeVar = state.recipeVars.get(node.recipeId);
  if (recipeVar === undefined) {
    diag(
      state,
      'OEIR_LEAF_MISSING_RECIPE',
      `insertion site '${node.recipeId}' has no claim-time recipe`,
      node.span,
    );
    return;
  }
  state.usesClaimRecipe = true;
  const projection = nextName(state, 'projection');
  push(
    state,
    `const ${projection} = claimRecipe(${state.scopeVar}, ${recipeVar}, ${parentExpr});`,
    node.span,
  );
  emitClaimCollectedList(state, `${projection}.nodes`, collect);
}

/** One `{props.children}` site. The caller-supplied recipe owns the node shape. */
function emitClaimChildrenProjection(
  state: EmitState,
  node: FunctionModelChildrenProjection,
  parentExpr: string,
  collect: boolean,
): void {
  const recipeVar = state.childrenRecipeVar;
  if (recipeVar === null) {
    diag(
      state,
      'OEIR_LEAF_MISSING_CHILDREN',
      'children projection has no claim-level `props.children` recipe read',
      node.span,
    );
    return;
  }
  state.usesClaimRecipe = true;
  const projection = nextName(state, 'childrenProjection');
  push(
    state,
    `const ${projection} = claimRecipe(${state.scopeVar}, ${recipeVar}, ${parentExpr});`,
    node.span,
  );
  emitClaimCollectedList(state, `${projection}.nodes`, collect);
}

/**
 * Claim one component reference in authored position. Mirrors the mount's
 * child scope and per-read props, but adopts existing nodes and rolls a
 * throwing claim back with `dispose(false)` so borrowed DOM stays.
 */
function emitClaimComponentRef(
  state: EmitState,
  node: FunctionModelComponentRef,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  parentExpr: string,
  collect: boolean,
): void {
  const span: IrSpan = node.span;
  const childrenRecipeVar =
    node.childrenRecipeId === null ? null : (state.recipeVars.get(node.childrenRecipeId) ?? null);
  if (node.childrenRecipeId !== null && childrenRecipeVar === null) {
    diag(
      state,
      'OEIR_LEAF_MISSING_RECIPE',
      `children recipe '${node.childrenRecipeId}' of '<${node.name}>' has no claim-time recipe`,
      span,
    );
    return;
  }
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
    if (attribute.name === 'key' || attribute.name === 'children') continue;
    admitted.push(attribute);
  }
  const id = state.counter.value++;
  const propsVar = `${INTERNAL_PREFIX}childProps${id}`;
  // 16b-LC retained-child: the claim mirror of the mount site. The same authored span yields
  // the same site key, the retained record is reused (setup never re-runs) and
  // the per-connect claim scope stays parented on the structural owner.
  const retained = state.retention !== null && state.retention.retainedRefs.has(node);
  const hostVar = `${INTERNAL_PREFIX}childHost${id}`;
  const scopeVar = `${INTERNAL_PREFIX}childScope${id}`;
  const nodesVar = `${INTERNAL_PREFIX}childNodes${id}`;
  const setupHostVar = `${INTERNAL_PREFIX}childSetupHost${id}`;
  const instanceVar = `${INTERNAL_PREFIX}childInstance${id}`;
  const failureVar = `${INTERNAL_PREFIX}childFailure${id}`;
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
  for (const prop of admitted) {
    if (prop.kind === 'static') {
      resolved.push(prop);
      continue;
    }
    const record = recordFor(state, prop.expression, records);
    if (record === null || !declareReads(state, record)) return;
    const dependencies = dependencyNames(state, record);
    if (dependencies === null) return;
    for (const dependency of dependencies) {
      if (dependency.fromProps) needsParentProps = true;
      else propDeps.add(dependency.name);
    }
    resolved.push({ kind: 'dynamic', name: prop.name, record, span: prop.span });
  }
  if (resolved.length > 0 || childrenRecipeVar !== null) {
    push(state, `const ${propsVar} = {`, span);
    state.indent += 1;
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
  const depParts = [...propDeps];
  if (needsParentProps) depParts.push(`...${state.hostVar}.propDeps`);
  const propsExpr = resolved.length > 0 || childrenRecipeVar !== null ? propsVar : '{}';
  const depList = `[${depParts.join(', ')}]`;

  if (!retained) {
    push(
      state,
      `const ${hostVar} = { bindings: ${state.hostVar}.bindings, propDeps: ${depList} };`,
      span,
    );
    push(state, `const ${scopeVar} = ${state.scopeVar}.child();`, span);
    push(state, `let ${nodesVar};`);
    push(state, 'try {');
    state.indent += 1;
    push(
      state,
      `${nodesVar} = ${node.name}${CLAIM_SUFFIX}(${scopeVar}, ${propsExpr}, ${hostVar}, ${parentExpr});`,
      span,
    );
    state.indent -= 1;
    push(state, `} catch (error) { ${scopeVar}.dispose(false); throw error; }`);
    push(state, `${scopeVar}.addRangeCleanup(() => removeNodes(${nodesVar}));`);
    emitClaimCollectedList(state, nodesVar, collect);
    return;
  }

  // Retained claim site: one retain per mount/claim pair, SAME site key and
  // SAME structural-owner parenting as the mount site (B1). The setup factory
  // reuses the mount-time record, so the claim does not re-evaluate setup.
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
  push(state, 'try {');
  state.indent += 1;
  push(
    state,
    `${nodesVar} = ${node.name}${CLAIM_SUFFIX}(${scopeVar}, ${propsExpr}, ${hostVar}, ${parentExpr});`,
    span,
  );
  state.indent -= 1;
  // B2 cleanup-first claim rollback: borrowed DOM stays (`dispose(false)`), the
  // ledger entry is released second, both always attempted and the original
  // construction error wins when both cleanups are clean.
  push(state, `} catch (error) {`);
  state.indent += 1;
  push(state, `let ${failureVar} = null;`);
  push(state, `try { ${scopeVar}.dispose(false); } catch (failure) { ${failureVar} = failure; }`);
  push(
    state,
    `try { releaseChildInstance(${state.hostVar}.instance, ${siteKey}); } catch (failure) { ${failureVar} ??= failure; }`,
  );
  push(state, `throw ${failureVar} ?? error;`);
  state.indent -= 1;
  push(state, `}`);
  push(state, `${scopeVar}.addRangeCleanup(() => removeNodes(${nodesVar}));`);
  emitClaimCollectedList(state, nodesVar, collect);
}

/**
 * Claim-time recipes. The mount-time recipe's definition owner is the mount
 * scope, which claim disposes before adoption, so lineage would reject it.
 * These objects exist only so `claimRecipe` can open an independent projection;
 * calling `mount` on them is a coded mismatch, not a second mount.
 */
function emitClaimTimeRecipes(
  state: EmitState,
  file: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const referenced = referencedRecipeIds(state.component);
  if (referenced.size === 0) return;
  const ctx: ClaimContext = { componentByName: state.componentByName, stack: new Set() };
  for (const recipe of state.component.recipes) {
    if (state.diagnostics.length > 0) return;
    if (!referenced.has(recipe.id)) continue;
    if (!nodeClaimable(recipe.target, state.component, ctx)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_NODE',
        `recipe '${recipe.id}' is outside the M07-1 claim slice`,
        recipe.span,
      );
      return;
    }
    const outerOrdinals = state.textOrdinals;
    const preparedTarget = normalizeTextRuns([recipe.target]);
    state.textOrdinals = textSlotOrdinals(preparedTarget);
    if (!assertTextBoundaryContext(state, preparedTarget)) {
      state.textOrdinals = outerOrdinals;
      return;
    }
    const recipeVar = nextName(state, 'claimRecipe');
    state.recipeVars.set(recipe.id, recipeVar);
    const scopeParam = nextName(state, 'recipeScope');
    const propsParam = nextName(state, 'recipeProps');
    const parentParam = nextName(state, 'recipeParent');
    const adoptedVar = nextName(state, 'adopted');
    push(state, `const ${recipeVar} = createRecipe({`, recipe.span);
    state.indent += 1;
    push(state, `definitionOwner: ${MOUNT_SCOPE},`);
    push(
      state,
      `source: ${JSON.stringify(`${file}#${state.component.name}:${recipe.id.replace(/^#/, '')}`)},`,
    );
    state.usesLeafClaimMismatch = true;
    push(state, `mount() { throw ${claimError('claim-time recipe has no mount', recipe.span)}; },`);
    push(state, `claim(${scopeParam}, ${propsParam}, ${parentParam}) {`, recipe.span);
    state.indent += 1;
    const outerScope = state.scopeVar;
    const outerAdopted = state.claimAdoptedVar;
    const outerActivation = state.claimActivationVar;
    state.scopeVar = scopeParam;
    state.claimAdoptedVar = adoptedVar;
    // This claim is either a top-level claim (it owns and drains the queue) or
    // part of an enclosing verify walk (it appends to that owner's queue). It
    // must never flush before the enclosing root structure check.
    state.claimActivationVar = CLAIM_ACTIVATION;
    const phase2: Array<() => void> = [];
    const activationSteps = emitClaimQueueInit(state, parentParam);
    push(state, `const ${adoptedVar} = [];`);
    push(state, 'try {');
    state.indent += 1;
    // A claim-time recipe body is emitted inside the claim chunk but it is a
    // reusable-JSX body, not the root retaining body: no ledger text and no
    // release text may be emitted inside it.
    state.claimTimeRecipeDepth += 1;
    emitClaimHtmlNamespace(state, parentParam, '/', recipe.span);
    emitClaimInto(
      state,
      [recipe.target],
      '__oe_claimCursor',
      '',
      records,
      phase2,
      (name) => {
        push(state, `${adoptedVar}.push(${name});`);
      },
      (name, condition) => {
        push(state, `if (${condition}) ${adoptedVar}.push(${name});`);
      },
      parentParam,
      true,
    );
    state.usesLeafClaimMismatch = true;
    push(
      state,
      `if (__oe_cursorOwned && __oe_claimCursor.node !== null) throw ${claimError('extra node at /', recipe.span)};`,
    );
    emitPhase2Steps(state, phase2);
    emitClaimActivationCapture(state, activationSteps);
    state.indent -= 1;
    emitClaimOwnerFinally(state);
    emitClaimActivationDrain(state, activationSteps);
    state.claimTimeRecipeDepth -= 1;
    push(state, `return ${adoptedVar};`);
    state.scopeVar = outerScope;
    state.claimAdoptedVar = outerAdopted;
    state.claimActivationVar = outerActivation;
    state.indent -= 1;
    push(state, '},');
    state.indent -= 1;
    push(state, '});');
    state.textOrdinals = outerOrdinals;
  }
}

export function emitClaimFunction(
  file: string,
  component: FunctionModelComponent,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
  sharedClaimCursor: boolean,
  rootSetup: boolean,
  /**
   * `16b-CTX`: whether the body aliases the retained setup record. It is the
   * SAME fact `emitComponent` computed for the mount (setup locals present, or a
   * context intrinsic whose owner scope the factory carries), passed in so the
   * claim makes the identical decision and a hook-only component keeps its
   * exact pre-existing bytes.
   */
  aliasesSetupRecord: boolean,
  rootComponent: boolean,
  connectReplaySource: 'bindings' | 'setup' | null,
  connectEnvReplaySource: 'bindings' | 'setup' | null,
  retention: RetentionPlan | null,
  claimStyleLinkPrefix: boolean,
): ClaimEmission | null {
  const ctx: ClaimContext = { componentByName, stack: new Set() };
  if (!componentClaimable(component, ctx)) return null;
  const useShared = sharedClaimCursor && !isDirectoryRootComponent(component);
  const projectsChildren = componentProjectsChildren(component);
  const propsName = component.propsParam;
  const state: EmitState = {
    component,
    lines: [],
    physicalLine: 0,
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
    declaredRecipeIds: declaredRecipeIdSet(component),
    recipeNames: new Set(),
    recipeVars: new Map(),
    entryNames: new Set(),
    refreshStack: [],
    listDepth: 0,
    recipeDepth: 0,
    childrenRecipeVar: projectsChildren ? `${INTERNAL_PREFIX}childrenRecipe` : null,
    ssrRecipeVars: new Map(),
    ssrChildrenRenderVar: null,
    directorySource: `${file}#${component.name}`,
    usesStaticSiblingDirectoryConsumer: false,
    claimCursorShared: useShared,
    claimStyleLinkPrefix: claimStyleLinkPrefix && rootComponent,
    claimAdoptedVar: null,
    claimActivationVar: null,
    usesClaimRecipe: false,
    emitDirectoryMarkers: false,
    emitTextBoundaries: true,
    textOrdinals: textSlotOrdinals(component.roots),
    claimEntry: null,
    usesLeafClaimMismatch: false,
    retention,
    retainBody: retention !== null && retention.rootName === component.name,
    leafBody: retention?.leafBodies.has(component.name) === true,
    retainsChildren: retention?.retainingBodies.has(component.name) === true,
    claimTimeRecipeDepth: 0,
  };
  if (!assertTextBoundaryContext(state, component.roots)) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      segments: [],
      placements: [],
    };
  }
  const localLines: SetupLocal[] = [];
  for (const resource of component.resources) {
    if (!IDENTIFIER_PATTERN.test(resource.name) || resource.name.startsWith(INTERNAL_PREFIX)) {
      continue;
    }
    if (resource.kind === 'ref') {
      // `16b-REF`: a handle is a compiler-owned value, not a lowered snapshot;
      // only its OPTIONAL notification record needs read classification. A
      // DECLARED notification that cannot be resolved fails closed through
      // `recordFor`'s own diagnostic — it never silently degrades to the
      // handle-only form, which would drop the author's callback.
      if (resource.expression === null) {
        localLines.push({ name: resource.name, kind: 'ref', record: null, span: resource.span });
        continue;
      }
      const record = recordFor(state, resource.expression, records);
      if (record === null || !declareReads(state, record)) continue;
      state.localResources.add(resource.name);
      localLines.push({ name: resource.name, kind: 'ref', record, span: resource.span });
      continue;
    }
    if (resource.kind === 'host') {
      // `16b-REF` / `useHost`: no lowered expression and no read classification
      // — the value is a compiler-owned host-record field, exactly like a ref
      // handle is a compiler-owned object.
      state.localResources.add(resource.name);
      localLines.push({ name: resource.name, kind: 'host', record: null, span: resource.span });
      continue;
    }
    if (resource.kind === 'context') {
      // `16b-CTX`: a consumer is a retained setup value (the signal identity is
      // the contract, so a reconnect writes into the same object). Only its
      // TOKEN record needs read classification; a declared token that cannot be
      // resolved fails closed through `recordFor`'s own diagnostic.
      if (resource.expression === null) continue;
      const record = recordFor(state, resource.expression, records);
      if (record === null || !declareReads(state, record)) continue;
      state.localResources.add(resource.name);
      localLines.push({ name: resource.name, kind: 'context', record, span: resource.span });
      continue;
    }
    if (resource.kind === 'local') {
      if (resource.recipeId !== null || resource.expression === null) continue;
      const record = recordFor(state, resource.expression, records);
      if (record === null || !declareReads(state, record)) continue;
      state.localResources.add(resource.name);
      localLines.push({ name: resource.name, kind: 'local', record, span: resource.span });
      continue;
    }
    state.hostBindings.add(resource.name);
    state.requiredBindings.add(resource.name);
  }
  const leafSetup = state.leafBody && localLines.length > 0;
  // 16b-LC retained-child: the ROOT retaining body opens exactly one instance pass before
  // any claim work, so a failed claim is evicted by the shell's abort. Only the
  // root body has a ledger; every leaf/legacy/recipe body emits no ledger text.
  if (state.retainBody) {
    // 16b-LC depth >= 2: capture the token only when a retained child is
    // itself a retaining body; a depth-1 module keeps the bare call bytes.
    const beginCall = `beginInstancePass(${MOUNT_HOST}.instance)`;
    push(
      state,
      state.retention?.transaction === true
        ? `const ${TRANSACTION_VAR} = ${beginCall};`
        : `${beginCall};`,
    );
  }
  const phase2: Array<() => void> = [];
  // M08-2 B2: only the shared-cursor claim queues activation. Its per-element
  // blocks are flushed before the enclosing cursor owner's final structure
  // check, so they must append closures and let the owner drain after that
  // check. The non-shared path already validates its root before phase 2.
  state.claimActivationVar = useShared ? CLAIM_ACTIVATION : null;
  const rootAdoptedVar = useShared ? null : nextName(state, 'adopted');
  if (!useShared) {
    // Local snapshots are setup work (B1). A non-root chunk evaluates them once
    // before the claim walk reads them (authored side effects therefore run
    // during claim); the ROOT aliases the retained `createInstance` record
    // instead and never re-runs an initializer (T3 / 16b-LC-1).
    if (rootSetup && aliasesSetupRecord) {
      // `16b-CTX`: the alias prologue also declares the retained OWNER SCOPE
      // (from the record's `__oe_contextScope` field), so a context-only root
      // with no setup locals still aliases rather than falling through. A
      // HOOK-only root keeps the pre-existing no-op fallback (byte identity).
      emitSetupAlias(state, localLines, ROOT_SETUP_HOST_PROPERTY);
    } else if (leafSetup && (localLines.length > 0 || componentUsesContextIntrinsic(component))) {
      emitSetupAlias(state, localLines, LEAF_SETUP_HOST_PROPERTY);
    } else {
      for (const line of localLines) emitSetupBinding(state, line);
    }
    emitJoinTransaction(state);
    push(state, `const ${rootAdoptedVar} = [];`);
  }
  const rootDirectory = staticElementDirectory(component.roots);
  // M09-2e / #1803 + F16: a DSD template may PREFIX its claimed content with
  // canonical marked stylesheet links — this module's own declared sheets, or a
  // nested LIGHT child's sheets the runtime lifted into the template. Both claim
  // forms skip exactly that leading run: the general cursor walk below, and the
  // directory consumer (`openStaticSiblingDirectory`), whose parse starts after
  // the run when the claim parent is the ShadowRoot. The prefix is a property of
  // the TEMPLATE, never of this module's styling declaration, so the directory
  // fast path stays available for every root shape and the admissibility of the
  // shape is unchanged.
  if (!useShared && rootDirectory !== null) {
    for (const interior of emitClaimedDirectory(state, CLAIM_PARENT, rootDirectory)) {
      push(state, `${rootAdoptedVar}.push(${interior});`);
    }
  } else if (!useShared) {
    emitClaimHtmlNamespace(state, CLAIM_PARENT, '/', component.span);
    const rootCursor = nextName(state, 'cursor');
    if (state.claimStyleLinkPrefix) {
      // D-claim-prefix (M09-2e / #1803, widened by F16): a DSD template may
      // declare canonical marked `<link>` nodes BEFORE the authored content —
      // this module's own sheets, or a nested LIGHT child's lifted sheets. They
      // are borrowed server DOM: the claim adopts the authored nodes after them
      // and never writes, moves or duplicates a link. The skip is exactly the
      // marked-LINK run; an unmarked link, a marked non-link, or a marked link
      // anywhere past the run stays a structural mismatch.
      const startVar = nextName(state, 'claimStart');
      push(state, `let ${startVar} = ${CLAIM_PARENT}.firstChild;`);
      push(
        state,
        `while (${startVar} !== null && ${startVar}.nodeType === 1 && ${startVar}.nodeName === "LINK" && ${startVar}.hasAttribute(${JSON.stringify(STATIC_STYLES_MARKER)})) ${startVar} = ${startVar}.nextSibling;`,
      );
      push(state, `const ${rootCursor} = { node: ${startVar} };`);
    } else {
      push(state, `const ${rootCursor} = { node: ${CLAIM_PARENT}.firstChild };`);
    }
    emitClaimInto(
      state,
      component.roots,
      rootCursor,
      '',
      records,
      phase2,
      (name) => {
        push(state, `${rootAdoptedVar}.push(${name});`);
      },
      (name, condition) => {
        push(state, `if (${condition}) ${rootAdoptedVar}.push(${name});`);
      },
      CLAIM_PARENT,
      true,
    );
    emitClaimCursorEnd(state, rootCursor, '/', component.span);
  } else {
    // Shared-cursor claim: both branches of the claim walk read the same setup
    // names, so this branch aliases the retained root record exactly like the
    // non-shared one instead of re-evaluating the setup initializers.
    if (rootSetup && aliasesSetupRecord) {
      emitSetupAlias(state, localLines, ROOT_SETUP_HOST_PROPERTY);
    } else if (leafSetup && (localLines.length > 0 || componentUsesContextIntrinsic(component))) {
      emitSetupAlias(state, localLines, LEAF_SETUP_HOST_PROPERTY);
    } else {
      for (const line of localLines) emitSetupBinding(state, line);
    }
    emitJoinTransaction(state);
    if (state.childrenRecipeVar !== null) {
      push(state, `const ${state.childrenRecipeVar} = ${MOUNT_PROPS}.children;`);
      push(
        state,
        `if (${state.childrenRecipeVar} == null || typeof ${state.childrenRecipeVar} !== "object" || typeof ${state.childrenRecipeVar}.mount !== "function" || ${state.childrenRecipeVar}.definitionOwner == null) throw new Error("OEIR_LEAF_MISSING_CHILDREN: component '<${component.name}>' projects props.children but the mounted instance was given no children recipe");`,
      );
    }
    emitClaimHtmlNamespace(state, CLAIM_PARENT, '/', component.span);
    emitClaimTimeRecipes(state, file, records);
    const adoptedVar = nextName(state, 'adopted');
    state.claimAdoptedVar = adoptedVar;
    push(state, `const ${adoptedVar} = [];`);
    const activationSteps = emitClaimQueueInit(state, CLAIM_PARENT);
    if (state.claimStyleLinkPrefix) {
      // D-claim-prefix (M09-2e / #1803) for the shared-cursor owner: the
      // module-level cursor was initialized at `parent.firstChild`; skip exactly
      // the canonical marked stylesheet links before the authored walk.
      push(
        state,
        `while (__oe_claimCursor.node !== null && __oe_claimCursor.node.nodeType === 1 && __oe_claimCursor.node.nodeName === "LINK" && __oe_claimCursor.node.hasAttribute(${JSON.stringify(STATIC_STYLES_MARKER)})) __oe_claimCursor.node = __oe_claimCursor.node.nextSibling;`,
      );
    }
    push(state, 'try {');
    state.indent += 1;
    emitClaimInto(
      state,
      component.roots,
      '__oe_claimCursor',
      '',
      records,
      phase2,
      (name) => {
        push(state, `${adoptedVar}.push(${name});`);
      },
      (name, condition) => {
        push(state, `if (${condition}) ${adoptedVar}.push(${name});`);
      },
      CLAIM_PARENT,
      true,
    );
    state.usesLeafClaimMismatch = true;
    push(
      state,
      `if (__oe_cursorOwned && __oe_claimCursor.node !== null) throw ${claimError('extra node at /', component.span)};`,
    );
    emitPhase2Steps(state, phase2);
    emitClaimActivationCapture(state, activationSteps);
    state.indent -= 1;
    emitClaimOwnerFinally(state);
    emitClaimActivationDrain(state, activationSteps);
    if (state.retainBody) push(state, `endInstancePass(${MOUNT_HOST}.instance);`);
    push(state, `return ${adoptedVar};`);
  }
  if (state.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      segments: [],
      placements: [],
    };
  }
  if (!useShared) {
    emitPhase2Steps(state, phase2);
    if (state.retainBody) push(state, `endInstancePass(${MOUNT_HOST}.instance);`);
    push(state, `return ${rootAdoptedVar};`);
  }

  const prologue: string[] = [
    `function ${component.name}${CLAIM_SUFFIX}(${MOUNT_SCOPE}, ${MOUNT_PROPS}, ${MOUNT_HOST}, ${CLAIM_PARENT}) {`,
  ];
  if (
    propsName !== null &&
    IDENTIFIER_PATTERN.test(propsName) &&
    !propsName.startsWith(INTERNAL_PREFIX)
  ) {
    prologue.push(`  const ${propsName} = ${MOUNT_PROPS};`);
  }
  if (state.requiredBindings.size > 0) {
    prologue.push(
      `  const ${INTERNAL_PREFIX}requireBinding = (name) => { const value = ${MOUNT_HOST}.bindings[name]; if (value === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: " + name); return value; };`,
    );
    for (const binding of [...state.requiredBindings].sort()) {
      prologue.push(
        `  const ${binding} = ${INTERNAL_PREFIX}requireBinding(${JSON.stringify(binding)});`,
      );
    }
  }
  // `16b-LC` option 1a: the claim is a NEW connection, so the retained connect
  // callbacks are replayed here on the fresh per-connection scope before any
  // claim work. No setup is repeated (the callbacks come from the retained
  // instance record) and the probe is absent on the hook-free bytes path.
  if (connectReplaySource !== null) {
    for (const line of emitLifecycleReplay(connectReplaySource)) prologue.push(line);
  }
  if (connectEnvReplaySource !== null) {
    for (const line of emitLifecycleEnvReplay(connectEnvReplaySource)) prologue.push(line);
  }
  const shift = fragmentLineCount(prologue);
  return {
    lines: [...prologue, ...state.lines, '}', ''],
    diagnostics: [],
    usesStaticSiblingDirectoryConsumer: state.usesStaticSiblingDirectoryConsumer,
    usesClaimRecipe: state.usesClaimRecipe,
    usesLeafClaimMismatch: state.usesLeafClaimMismatch,
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
