/** Emit server HTML from the same component model. */

import {
  type FunctionModelNode,
  type FunctionModelComponent,
  type FunctionModelAttribute,
  type FunctionModelComponentRef,
  type FunctionExpressionRef,
  type FunctionModelRecipe,
} from '../../semantic-core/function-frontend.ts';
import { VOID_TAGS } from '@openelement/protocol/part-program';
import { unsafeStreamFrameAttribute } from '@openelement/protocol/stream-frame-policy';
import { BOOLEAN_ATTRIBUTES } from '../../semantic-core/attribute-classification.ts';
import { type IrDiagnostic, type IrSpan } from '../types.ts';
import { type EmissionSegment } from '../../semantic-core/source-map.ts';
import { type LoweredExpressionRecord } from '../../semantic-core/expression-registry.ts';
import {
  type SlotAnchors,
  normalizeTextRuns,
  staticElementDirectory,
  slotNameOf,
  declaredRecipeIdSet,
  textSlotOrdinals,
  componentProjectsChildren,
  referencedRecipeIds,
  assertTextBoundaryContext,
  textOrdinal,
  emissionNodes,
  directoryParentAllowed,
  treeHasComposition,
  lightSlotAnchorsEnabled,
  ssrSlotAnchorOrdinals,
} from './structure.ts';
import {
  TAG_PATTERN,
  CLIENT_ONLY_ATTRIBUTE_CHANNELS,
  type ExpressionPlacement,
  type EmitState,
  MOUNT_SCOPE,
  MOUNT_HOST,
  SSR_CHILDREN_RENDER,
  ADMITTED_ATTRIBUTE_CHANNELS,
  recordFor,
  declareReads,
  pushParts,
  nextName,
  push,
  diag,
  type SpanLike,
  componentPropAdmitted,
  INTERNAL_PREFIX,
  IDENTIFIER_PATTERN,
  SSR_HELPER_PREFIX,
  SSR_SUFFIX,
  CONSUMED_ATTRIBUTE_CHANNELS,
  ATTRIBUTE_PATTERN,
  MOUNT_PROPS,
  fragmentLineCount,
} from './emission.ts';
import {
  componentNeedsSsrContextScope,
  GENERATED_CONTEXT_SCOPE_RECORD,
  componentUsesContextIntrinsic,
  emitSsrContextScope,
  emitContextProviders,
  emitSetupBinding,
  SSR_CONTEXT_PARAM,
} from './instance-emission.ts';

/**
 * SSR producer, static slice (M08-1a).
 *
 * A claimable component whose roots are fully static also emits `<Name>__ssr()`,
 * which returns the HTML the mount would build — at compile time, because a
 * static subtree's bytes are known then. The point is the pairing: a generated
 * module that can claim existing DOM can now also produce that DOM, which is
 * the precondition for the M08 SSR→claim parity proof.
 *
 * Boundary of this slice: dynamic text/attribute/property slots, conditions,
 * lists, component references and insertion sites return `null`, so no `__ssr`
 * is emitted for them. Slice M08-1b adds the admitted dynamic slots; the
 * void-element slice admits canonical `VOID_TAGS` as a start tag + attributes
 * with no close tag. For every other shape the absence of `__ssr` is the honest
 * shape of "this component is not SSR-producible yet".
 *
 * Escaping is NOT re-implemented here: the emitted code calls the runtime's
 * `escapeText` / `escapeAttrValue`, which are the same contract the serializers
 * use. A second escape table in the compiler would be exactly the drift P6
 * forbids.
 */
function staticSsrDirectory(
  ranges: readonly FunctionModelNode[],
  slots: SlotAnchors | null,
): string | null {
  const parts: string[] = [];
  for (const [ordinal, range] of ranges.entries()) {
    // The mount suppresses directories inside a range (`allowDirectory` false
    // in emitMountedDirectory), so a range interior never carries its own
    // `oe:r` pair. The SSR form is the same tree: markers stop at this range
    // layer. Emitting markers into the interior would put nested comments
    // there and the directory parser would refuse its own SSR output.
    const inner = staticSsrNode(range, false, slots);
    if (inner === null) return null;
    parts.push(
      `"<!--" + markerText(rangeMarker(${ordinal})) + "-->"`,
      inner,
      `"<!--" + markerText(rangeMarker(${ordinal}, true)) + "-->"`,
    );
  }
  return parts.length === 0 ? '""' : parts.join(' + ');
}

function staticSsrExpression(
  nodes: readonly FunctionModelNode[],
  markers: boolean,
  slots: SlotAnchors | null,
): string | null {
  const parts: string[] = [];
  for (const node of normalizeTextRuns(nodes)) {
    const part = staticSsrNode(node, markers, slots);
    if (part === null) return null;
    parts.push(part);
  }
  return parts.length === 0 ? '""' : parts.join(' + ');
}

function literalText(value: string): string {
  return JSON.stringify(value);
}

function staticSsrNode(
  node: FunctionModelNode,
  markers: boolean,
  slots: SlotAnchors | null,
): string | null {
  if (node.kind === 'text') return `escapeText(${literalText(node.value)})`;
  if (node.kind === 'fragment') return staticSsrExpression(node.children, markers, slots);
  if (node.kind !== 'element') return null;
  if (!TAG_PATTERN.test(node.tag)) return null;
  // alpha16 nested-expansion: a DASH tag is a nested custom-element host, and a
  // host's markup is only correct once the render has had the chance to expand
  // it. The static form is a compile-time string with no such call, so a static
  // host would silently stay unexpanded — the exact defect this slice exists to
  // fix. Returning null here routes the whole component to the dynamic producer,
  // whose dash-tag branch routes through `nestedHost` and falls back to these
  // same literal bytes when nothing admits the tag.
  if (node.tag.includes('-')) return null;
  const isVoid = VOID_TAGS.has(node.tag);
  // A void element has no content model. The frontend refuses authored
  // children with `OEC9013`; this null is the generator's fail-closed guard for
  // a model that bypassed the source diagnostic (never a child drop).
  if (isVoid && node.children.length > 0) return null;
  const attributes: string[] = [];
  for (const attribute of node.attributes) {
    // Client-only channels render no bytes: skipping them keeps a component
    // with only handlers/refs on the M08-1a static producer path.
    if (attribute.kind === 'dynamic' && CLIENT_ONLY_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
      continue;
    }
    // Slice 1a: static attributes only. A dynamic slot means the value is not
    // known at compile time, so this component has no static SSR form yet.
    if (attribute.kind !== 'static') return null;
    if (unsafeStreamFrameAttribute(attribute.name, attribute.value)) return null;
    // Same canonical spelling as the mount: a static BOOLEAN attribute renders
    // as `name=""` (the class lane and the HTML parser's own spelling), so the
    // SSR bytes and the created DOM agree byte-for-byte.
    const staticValue = BOOLEAN_ATTRIBUTES.has(attribute.name.toLowerCase()) ? '' : attribute.value;
    attributes.push(
      [
        '" "',
        literalText(`${attribute.name}="`),
        `escapeAttrValue(${literalText(staticValue)})`,
        literalText('"'),
      ].join(' + '),
    );
  }
  const open = `"<${node.tag}"`;
  // HTML void elements: the start tag and its attributes, no close tag. A
  // `</input>` would be parsed as a stray end tag by the HTML parser and the
  // claim's fixed cursor never expects it.
  if (isVoid) return [open, ...attributes, '">"'].join(' + ');
  // The mount wraps a static sibling directory in its marker comments; the SSR
  // form must carry the same comments or the claim cannot find its ranges.
  const directory = markers ? staticElementDirectory(node.children) : null;
  const children =
    directory === null
      ? staticSsrExpression(node.children, markers, slots)
      : staticSsrDirectory(directory, slots);
  if (children === null) return null;
  const close = `"</${node.tag}>"`;
  // The slot anchor brackets the slot ELEMENT'S INTERIOR, not the element: the
  // serializer substitutes the caller's children for the fallback content and
  // keeps the `<slot>` node itself, which is exactly the shape the class lane's
  // projected-children channel produces (`<slot name="x">…projection…</slot>`).
  // A light root is the only root whose children are projections; the caller
  // gates `slots` to that case, and a slotless tree passes null, so its bytes
  // stay byte-identical.
  if (node.tag !== 'slot' || slots === null) {
    return [open, ...attributes, '">"', children, close].join(' + ');
  }
  const ordinal = slots.get(node);
  const name = ordinal === undefined ? null : slotNameOf(node);
  // A slot this producer's map does not cover (a reusable-JSX body is its own
  // render helper and is not part of the root's map) is emitted UNANCHORED, not
  // refused: an unprojected slot must still render its fallback, and a
  // projection into it fails closed at the serializer because no anchor names
  // it. A non-static name never reaches here — `lightSlotAnchorsEnabled` refused it.
  if (name === null || ordinal === undefined) {
    return [open, ...attributes, '">"', children, close].join(' + ');
  }
  return [
    open,
    ...attributes,
    '">"',
    `"<!--" + markerText(slotAnchorMarker(${ordinal}, ${literalText(name)})) + "-->"`,
    children,
    `"<!--" + markerText(slotAnchorMarker(${ordinal}, ${literalText(name)}, true)) + "-->"`,
    close,
  ].join(' + ');
}

/**
 * M08-1b dynamic SSR producer. This is the emitted form for a component whose
 * claimable tree contains a dynamic text/attribute/boolean slot. It walks the
 * same `FunctionModelNode` and `LoweredExpressionRecord` inputs as mount and
 * claim; nothing is re-resolved or stored as a program.
 *
 * The emitted body evaluates the lowered text once per call (request-time
 * snapshot), through the runtime's one coercion/escape/security contract. It
 * creates no owner, no DOM, no subscription and no cleanup; a missing host
 * binding keeps the mount's `OEIR_LEAF_MISSING_VALUE: <name>` identity.
 */
interface SsrEmission {
  readonly lines: readonly string[];
  readonly diagnostics: readonly IrDiagnostic[];
  readonly segments: readonly EmissionSegment[];
  readonly placements: readonly ExpressionPlacement[];
}

/**
 * A fresh `EmitState` for SSR. SSR uses only the expression placement/segment
 * machinery and the binding declaration; the mount-only fields stay inert.
 */
function ssrEmitState(
  component: FunctionModelComponent,
  file: string,
  propsName: string | null,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
  projectsChildren: boolean,
): EmitState {
  return {
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
    // Composition SSR consumes the SAME model links the mount/claim use: the
    // component map for a component reference and the declared recipe ids for
    // an insertion site. It never re-derives them.
    componentByName,
    declaredRecipeIds: declaredRecipeIdSet(component),
    recipeNames: new Set(),
    recipeVars: new Map(),
    entryNames: new Set(),
    refreshStack: [],
    listDepth: 0,
    recipeDepth: 0,
    childrenRecipeVar: null,
    ssrRecipeVars: new Map(),
    ssrChildrenRenderVar: projectsChildren ? SSR_CHILDREN_RENDER : null,
    directorySource: `${file}#${component.name}`,
    usesStaticSiblingDirectoryConsumer: false,
    claimCursorShared: false,
    claimStyleLinkPrefix: false,
    claimAdoptedVar: null,
    claimActivationVar: null,
    usesClaimRecipe: false,
    emitDirectoryMarkers: false,
    emitTextBoundaries: true,
    textOrdinals: textSlotOrdinals(component.roots),
    claimEntry: null,
    usesLeafClaimMismatch: false,
    // SSR producers never mount a logical instance: no ledger text.
    retention: null,
    retainBody: false,
    leafBody: false,
    retainsChildren: false,
    claimTimeRecipeDepth: 0,
  };
}

function failedSsr(state: EmitState): SsrEmission {
  return {
    lines: [],
    diagnostics: state.diagnostics,
    segments: [],
    placements: [],
  };
}

/**
 * One request-time attribute fragment. `channel` is admitted by the leaf claim
 * boundary, so `attribute`/`boolean` are the only dynamic non-static channels
 * that can reach this emitter.
 */
function emitSsrDynamicAttribute(
  state: EmitState,
  attribute: Extract<FunctionModelAttribute, { readonly kind: 'dynamic' }>,
  outVar: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  /**
   * When present, the same evaluated value is ALSO recorded as an `[name, value]`
   * pair. A nested custom-element host hands those pairs to the render's
   * expander, so the value is evaluated ONCE and both the serialized bytes and
   * the expander's props read that one evaluation — no second getter read.
   */
  pairsVar?: string,
  slotCaptureVar?: string,
  valueCaptureVar?: string,
): boolean {
  if (CLIENT_ONLY_ATTRIBUTE_CHANNELS.has(attribute.channel)) return false;
  if (!ADMITTED_ATTRIBUTE_CHANNELS.has(attribute.channel)) return false;
  const record = recordFor(state, attribute.expression, records);
  if (record === null || !declareReads(state, record)) return false;
  const literal = JSON.stringify(attribute.name);
  if (attribute.channel === 'boolean') {
    if (pairsVar !== undefined) {
      pushParts(
        state,
        [
          `if (Boolean((`,
          { record },
          `))) { ${outVar}.push(${JSON.stringify(` ${attribute.name}=""`)}); ${pairsVar}.push([${literal}, ${JSON.stringify('')}]); }`,
        ],
        attribute.span,
      );
      return true;
    }
    pushParts(
      state,
      [
        `if (Boolean((`,
        { record },
        `))) ${outVar}.push(${JSON.stringify(` ${attribute.name}=""`)});`,
      ],
      attribute.span,
    );
    return true;
  }
  // A PROPERTY channel renders as an HTML ATTRIBUTE in SSR (owner decision F16).
  // `el.value = x` is the correct CLAIM behaviour — it sets the DOM property
  // without clobbering user input — but the server has no live DOM and no user
  // input to preserve: the honest server artifact for `value={x}` is
  // `value="x"`, which is also what the browser parses back before any claim
  // runs. Refusing here made every form page unproducible as a generated page
  // root (measured: `ssrHostExport: null`), which is why nine fixtures could not
  // leave the class lane.
  if (attribute.channel !== 'attribute' && attribute.channel !== 'property') return false;
  const valueVar = nextName(state, 'value');
  pushParts(state, [`const ${valueVar} = attributeValueOf((`, { record }, '));'], attribute.span);
  if (valueCaptureVar !== undefined) {
    push(state, `${valueCaptureVar} = ${valueVar};`, attribute.span);
  }
  if (slotCaptureVar !== undefined && attribute.name.toLowerCase() === 'slot') {
    push(state, `${slotCaptureVar} = ${valueVar} ?? \"\";`, attribute.span);
  }
  push(state, `if (${valueVar} !== null) {`, attribute.span);
  push(state, `  assertSafeUrlAttribute(${literal}, ${valueVar});`, attribute.span);
  push(
    state,
    `  ${outVar}.push(${JSON.stringify(` ${attribute.name}="`)}, escapeAttrValue(${valueVar}), ${JSON.stringify('"')});`,
    attribute.span,
  );
  if (pairsVar !== undefined)
    push(state, `  ${pairsVar}.push([${literal}, ${valueVar}]);`, attribute.span);
  push(state, `}`, attribute.span);
  return true;
}

/**
 * M08 composition SSR — one component reference. The emitted call uses the
 * SAME model component map and the SAME per-read props record the mount builds:
 * a fresh `{ get name() { return <lowered record>; } }` object at this call
 * site, never a cached value. The child body is emitted once per module
 * (`<Child>__ssr`), so two references with different props call one function
 * twice and each call evaluates its own record.
 *
 * A children-projecting target is called through its module-local
 * `__oe_ssrComponent_<Child>` helper with the children recipe's render function as the
 * third argument; that function is the one referenced-recipe helper, so a
 * child projecting twice calls it twice. A reference with JSX children to a
 * child that ignores them passes no renderer, exactly like mount's unused
 * children channel.
 */
function emitSsrComponentRef(
  state: EmitState,
  node: FunctionModelComponentRef,
  outVar: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): boolean {
  const span: IrSpan = node.span;
  if (state.listDepth > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
      `component '<${node.name}>' inside a list entry template needs the child update hook (M06b1b); a keyed reuse would keep the first mount's props`,
      span,
    );
    return false;
  }
  const target = state.componentByName.get(node.name);
  if (target === undefined) {
    diag(
      state,
      'OEIR_LEAF_UNKNOWN_COMPONENT',
      `component '<${node.name}>' is not declared in this module (external components are M06b2)`,
      span,
    );
    return false;
  }
  if (target.propsParam === null) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
      `component '<${node.name}>' has no named props parameter (destructured or absent); component references need a named props parameter (M06b2 owns destructuring)`,
      span,
    );
    return false;
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
    return false;
  }
  if (node.childrenRecipeId !== null && state.recipeDepth > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_CHILDREN',
      `children on '<${node.name}>' inside a reusable JSX value body are outside the M06b2a slice: the children recipe would be created once per component mount, but its definition owner is the recipe instance scope (created per insertion)`,
      span,
    );
    return false;
  }
  if (node.childrenRecipeId === null && componentProjectsChildren(target)) {
    diag(
      state,
      'OEIR_LEAF_MISSING_CHILDREN',
      `component '<${node.name}>' projects props.children but this reference passes no JSX children; every projection needs a children recipe`,
      span,
    );
    return false;
  }
  const childrenRenderVar =
    node.childrenRecipeId === null
      ? null
      : (state.ssrRecipeVars.get(node.childrenRecipeId) ?? null);
  if (node.childrenRecipeId !== null && childrenRenderVar === null) {
    diag(
      state,
      'OEIR_LEAF_MISSING_RECIPE',
      `children recipe '${node.childrenRecipeId}' of '<${node.name}>' has no emitted SSR render function (it is not reachable from any admitted root)`,
      span,
    );
    return false;
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
  let refused = false;
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
  if (refused) return false;
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
    if (record === null || !declareReads(state, record)) return false;
    resolved.push({ kind: 'dynamic', name: prop.name, record, span: prop.span });
  }
  let propsExpr = '{}';
  if (resolved.length > 0) {
    const id = state.counter.value++;
    const propsVar = `${INTERNAL_PREFIX}childProps${id}`;
    push(state, `const ${propsVar} = {`, span);
    state.indent += 1;
    for (const prop of resolved) {
      const key = IDENTIFIER_PATTERN.test(prop.name) ? prop.name : JSON.stringify(prop.name);
      if (prop.kind === 'static') {
        push(state, `${key}: ${JSON.stringify(prop.value)},`);
        continue;
      }
      pushParts(state, [`get ${key}() { return (`, { record: prop.record }, '); },'], prop.span);
    }
    state.indent -= 1;
    push(state, '};');
    propsExpr = propsVar;
  }
  // `16b-CTX` SERVER side: a child producer whose subtree uses context takes the
  // render scope as its trailing argument. The scope is the CALLER's own
  // (`__oe_contextScope`), and the child joins it as `owner()` — which is why a
  // nested provider shadows the outer one for its subtree and a sibling
  // reference cannot see it, on the server exactly as on the client.
  const childScopeArg = componentNeedsSsrContextScope(target, state.componentByName)
    ? `, ${GENERATED_CONTEXT_SCOPE_RECORD}`
    : '';
  if (componentProjectsChildren(target)) {
    if (childrenRenderVar === null) return false;
    push(
      state,
      `${outVar}.push(${SSR_HELPER_PREFIX}${target.name}(${propsExpr}, ${state.hostVar}, ${childrenRenderVar}${childScopeArg}));`,
      span,
    );
  } else {
    // A fully static child keeps the parameterless M08-1a function; extra
    // arguments are harmless and the static body reads no prop by definition.
    push(
      state,
      `${outVar}.push(${node.name}${SSR_SUFFIX}(${propsExpr}, ${state.hostVar}${childScopeArg}));`,
      span,
    );
  }
  return true;
}

/**
 * M08 composition SSR — one module-local render function per referenced
 * reusable-JSX/children recipe. All function names are published before any
 * body is emitted so a site inside another recipe body can reference any
 * recipe (the mount graph is acyclic, so this cannot recurse unboundedly).
 * Each helper is its own text/ordinal chunk, matching the mount recipe body and
 * the claim-time recipe chunk.
 */
function emitSsrRecipeHelpers(
  state: EmitState,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): boolean {
  const referenced = referencedRecipeIds(state.component);
  if (referenced.size === 0) return true;
  const plans: Array<{ readonly recipe: FunctionModelRecipe; readonly name: string }> = [];
  for (const recipe of state.component.recipes) {
    if (!referenced.has(recipe.id)) continue;
    const name = nextName(state, 'ssrRecipe');
    state.ssrRecipeVars.set(recipe.id, name);
    plans.push({ recipe, name });
  }
  for (const plan of plans) {
    const outerOrdinals = state.textOrdinals;
    const prepared = normalizeTextRuns([plan.recipe.target]);
    state.textOrdinals = textSlotOrdinals(prepared);
    if (!assertTextBoundaryContext(state, prepared)) {
      state.textOrdinals = outerOrdinals;
      return false;
    }
    push(state, `function ${plan.name}() {`, plan.recipe.span);
    state.indent += 1;
    const outVar = nextName(state, 'ssrOut');
    push(state, `const ${outVar} = [];`);
    const outerDepth = state.recipeDepth;
    state.recipeDepth = outerDepth + 1;
    const emitted = emitDynamicSsrNodes(state, prepared, outVar, true, records, null);
    state.recipeDepth = outerDepth;
    state.textOrdinals = outerOrdinals;
    if (!emitted) return false;
    push(state, `return ${outVar}.join("");`);
    state.indent -= 1;
    push(state, '}');
  }
  return true;
}

/**
 * Walk the admitted M08-1b tree into `outVar`. Returns false for any shape
 * outside the dynamic leaf slice; the caller then emits no `__ssr` rather than
 * a partial producer. The marker rule mirrors `staticSsrNode`: a range
 * interior recurses with markers suppressed, so the SSR output is what the
 * M07b directory parser accepts.
 */
function staticCompositionSlotName(node: FunctionModelNode): string | null {
  if (node.kind !== 'element') return '';
  const slot = node.attributes.find((attribute) => attribute.name.toLowerCase() === 'slot');
  return slot === undefined ? '' : slot.kind === 'static' ? slot.value : null;
}

interface SsrSelectContext {
  readonly value: string;
  readonly multiple: string;
  readonly state: string;
}

interface SsrFormContext {
  readonly select?: SsrSelectContext;
  readonly optionText?: string;
}

interface SsrCompositionGroups {
  readonly groups: string;
}

function emitDynamicSsrNodes(
  state: EmitState,
  nodes: readonly FunctionModelNode[],
  outVar: string,
  markers: boolean,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  slots: SlotAnchors | null,
  slotCaptureVar?: string,
  formContext?: SsrFormContext,
  composition?: SsrCompositionGroups,
): boolean {
  const list = state.emitTextBoundaries ? normalizeTextRuns(nodes) : nodes;
  for (const node of list) {
    // A dynamic condition/list can produce different top-level roots at render
    // time. Keep each selected root as its own group so a static or dynamic
    // `slot` attribute on that root still controls projection into a nested
    // light host. Fragments and control-flow nodes recurse with this context;
    // the root itself is rendered without it so descendants do not become
    // separate projection groups.
    if (
      composition !== undefined &&
      node.kind !== 'fragment' &&
      node.kind !== 'condition' &&
      node.kind !== 'list'
    ) {
      const childHtmlVar = nextName(state, 'nestedChild');
      const childSlotVar = nextName(state, 'nestedChildSlot');
      const staticSlot = staticCompositionSlotName(node);
      push(state, `const ${childHtmlVar} = [];`, node.span);
      push(
        state,
        `let ${childSlotVar} = ${staticSlot === null ? '""' : literalText(staticSlot)};`,
        node.span,
      );
      if (
        !emitDynamicSsrNodes(
          state,
          [node],
          childHtmlVar,
          markers,
          records,
          slots,
          childSlotVar,
          formContext,
        )
      )
        return false;
      const childHtmlTextVar = nextName(state, 'nestedChildText');
      push(state, `const ${childHtmlTextVar} = ${childHtmlVar}.join("");`, node.span);
      push(state, `${outVar}.push(${childHtmlTextVar});`, node.span);
      push(state, `${composition.groups}.push([${childSlotVar}, ${childHtmlTextVar}]);`, node.span);
      continue;
    }
    if (node.kind === 'text') {
      if (formContext?.optionText !== undefined) {
        push(state, `${formContext.optionText}.push(${literalText(node.value)});`, node.span);
      }
      push(state, `${outVar}.push(escapeText(${literalText(node.value)}));`, node.span);
      continue;
    }
    if (node.kind === 'fragment') {
      if (
        !emitDynamicSsrNodes(
          state,
          node.children,
          outVar,
          markers,
          records,
          slots,
          slotCaptureVar,
          formContext,
          composition,
        )
      )
        return false;
      continue;
    }
    if (node.kind === 'dynamic-text') {
      const record = recordFor(state, node.expression, records);
      if (record === null || !declareReads(state, record)) return false;
      const ordinal = textOrdinal(state, node);
      if (ordinal === null) return false;
      const optionTextCaptureVar = formContext?.optionText;
      const textValueVar =
        optionTextCaptureVar === undefined ? undefined : nextName(state, 'ssrTextValue');
      if (textValueVar !== undefined) {
        pushParts(state, [`const ${textValueVar} = displayValue((`, { record }, '));'], node.span);
        push(state, `${optionTextCaptureVar}.push(${textValueVar});`, node.span);
      }
      push(
        state,
        `${outVar}.push("<!--", markerText(textSlotMarker(${ordinal})), "-->");`,
        node.span,
      );
      if (textValueVar !== undefined) {
        push(state, `${outVar}.push(escapeText(${textValueVar}));`, node.span);
      } else {
        pushParts(
          state,
          [`${outVar}.push(escapeText(displayValue((`, { record }, '))));'], // displayValue((expr))
          node.span,
        );
      }
      push(
        state,
        `${outVar}.push("<!--", markerText(textSlotMarker(${ordinal}, true)), "-->");`,
        node.span,
      );
      continue;
    }
    if (node.kind === 'condition') {
      const record = recordFor(state, node.test, records);
      if (record === null || !declareReads(state, record)) return false;
      // Evaluate the test once per __ssr call. The branch selection is a
      // request-time fact, so a static branch body still needs this producer.
      const testVar = nextName(state, 'whenTest');
      pushParts(state, [`const ${testVar} = (`, { record }, ');'], node.span);
      // Keep the control markers in `outVar`, the caller's raw fallback bytes.
      // A selected branch may project roots into different slot parents, so a
      // single when range cannot be copied into the expanded groups safely.
      push(state, `${outVar}.push("<!--", markerText(MARKERS.when), "-->");`, node.span);
      push(state, `if (${testVar}) {`, node.span);
      state.indent += 1;
      const thenOrdinals = state.textOrdinals;
      const preparedThen = emissionNodes(state, node.consequent);
      state.textOrdinals = textSlotOrdinals(preparedThen);
      if (
        !emitDynamicSsrNodes(
          state,
          preparedThen,
          outVar,
          markers,
          records,
          slots,
          slotCaptureVar,
          formContext,
          composition,
        )
      ) {
        state.textOrdinals = thenOrdinals;
        return false;
      }
      state.textOrdinals = thenOrdinals;
      state.indent -= 1;
      push(state, '} else {', node.span);
      state.indent += 1;
      if (node.alternate !== null && node.alternate.length > 0) {
        const elseOrdinals = state.textOrdinals;
        const preparedElse = emissionNodes(state, node.alternate);
        state.textOrdinals = textSlotOrdinals(preparedElse);
        if (
          !emitDynamicSsrNodes(
            state,
            preparedElse,
            outVar,
            markers,
            records,
            slots,
            slotCaptureVar,
            formContext,
            composition,
          )
        ) {
          state.textOrdinals = elseOrdinals;
          return false;
        }
        state.textOrdinals = elseOrdinals;
      }
      state.indent -= 1;
      push(state, '}', node.span);
      push(state, `${outVar}.push("<!--", markerText(MARKERS.whenEnd), "-->");`, node.span);
      continue;
    }
    if (node.kind === 'list') {
      const itemsRecord = recordFor(state, node.items, records);
      if (itemsRecord === null || !declareReads(state, itemsRecord)) return false;
      if (!IDENTIFIER_PATTERN.test(node.parameter) || node.parameter.startsWith(INTERNAL_PREFIX)) {
        return false;
      }
      const itemsVar = nextName(state, 'eachItems');
      pushParts(state, [`const ${itemsVar} = (`, { record: itemsRecord }, ');'], node.span);
      // List and entry markers remain in `outVar`, which is also the raw
      // unexpanded fallback. Projected groups are individual slot-owned roots;
      // placing one each range around roots in different slots would split its
      // start/end markers across unrelated parent nodes.
      push(state, `${outVar}.push("<!--", markerText(MARKERS.each), "-->");`, node.span);
      const indexVar = nextName(state, 'eachIndex');
      push(state, `for (let ${indexVar} = 0; ${indexVar} < ${itemsVar}.length; ${indexVar}++) {`);
      state.indent += 1;
      const itemVar = node.parameter;
      push(state, `const ${itemVar} = ${itemsVar}[${indexVar}];`);
      const outerEntryName = state.entryNames.has(node.parameter);
      state.entryNames.add(node.parameter);
      const tokenVar = nextName(state, 'eachToken');
      if (node.key !== null) {
        const keyRecord = recordFor(state, node.key, records);
        if (keyRecord === null || !declareReads(state, keyRecord)) {
          if (!outerEntryName) state.entryNames.delete(node.parameter);
          return false;
        }
        pushParts(
          state,
          [`const ${tokenVar} = encodeListKey((`, { record: keyRecord }, '));'],
          node.key.span,
        );
      } else {
        // Unkeyed lists keep mount's positional key contract (index is the key).
        push(state, `const ${tokenVar} = encodeListKey(${indexVar});`, node.span);
      }
      push(
        state,
        `${outVar}.push("<!--", markerText(entryKeyMarker(${tokenVar})), "-->");`,
        node.span,
      );
      const outerOrdinals = state.textOrdinals;
      const prepared = emissionNodes(state, node.template);
      state.textOrdinals = textSlotOrdinals(prepared);
      // A component reference inside an entry cannot re-read props on a keyed
      // reuse (M06b1b), so the SSR walk keeps mount's refusal.
      state.listDepth += 1;
      const entriesEmitted = emitDynamicSsrNodes(
        state,
        prepared,
        outVar,
        markers,
        records,
        slots,
        slotCaptureVar,
        formContext,
        composition,
      );
      state.listDepth -= 1;
      state.textOrdinals = outerOrdinals;
      if (!outerEntryName) state.entryNames.delete(node.parameter);
      if (!entriesEmitted) return false;
      state.indent -= 1;
      push(state, '}');
      push(state, `${outVar}.push("<!--", markerText(MARKERS.eachEnd), "-->");`, node.span);
      continue;
    }
    if (node.kind === 'component-ref') {
      if (formContext?.select !== undefined || formContext?.optionText !== undefined) {
        diag(
          state,
          'OEIR_LEAF_UNSUPPORTED_NODE',
          'a controlled select cannot determine option selectedness across a component reference',
          node.span,
        );
        return false;
      }
      if (!emitSsrComponentRef(state, node, outVar, records)) return false;
      continue;
    }
    if (node.kind === 'insertion-site') {
      if (formContext?.select !== undefined || formContext?.optionText !== undefined) {
        diag(
          state,
          'OEIR_LEAF_UNSUPPORTED_NODE',
          'a controlled select cannot determine option selectedness across a reusable JSX value',
          node.span,
        );
        return false;
      }
      if (!state.declaredRecipeIds.has(node.recipeId)) {
        diag(
          state,
          'OEIR_LEAF_UNSUPPORTED_RECIPE',
          `insertion site '${node.recipeId}' does not target a direct component-local JSX initializer; only those values are reusable recipes in this slice`,
          node.span,
        );
        return false;
      }
      const renderRecipe = state.ssrRecipeVars.get(node.recipeId);
      if (renderRecipe === undefined) {
        diag(
          state,
          'OEIR_LEAF_MISSING_RECIPE',
          `insertion site '${node.recipeId}' has no emitted SSR render function (the value is not reachable from any admitted root)`,
          node.span,
        );
        return false;
      }
      push(state, `${outVar}.push(${renderRecipe}());`, node.span);
      continue;
    }
    if (node.kind === 'children-projection') {
      if (formContext?.select !== undefined || formContext?.optionText !== undefined) {
        diag(
          state,
          'OEIR_LEAF_UNSUPPORTED_NODE',
          'a controlled select cannot determine option selectedness across children projection',
          node.span,
        );
        return false;
      }
      if (state.recipeDepth > 0) {
        diag(
          state,
          'OEIR_LEAF_UNSUPPORTED_NODE',
          `children projection inside a reusable JSX value body is outside the M06b2a slice: the projection would need the recipe instance scope, which exists only at insertion time`,
          node.span,
        );
        return false;
      }
      if (state.ssrChildrenRenderVar === null) {
        diag(
          state,
          'OEIR_LEAF_MISSING_CHILDREN',
          'children projection has no server children renderer (internal model mismatch)',
          node.span,
        );
        return false;
      }
      push(state, `${outVar}.push(${state.ssrChildrenRenderVar}());`, node.span);
      continue;
    }
    if (node.kind !== 'element') return false;
    if (!TAG_PATTERN.test(node.tag)) return false;
    const isVoid = VOID_TAGS.has(node.tag);
    if (isVoid && node.children.length > 0) {
      // Source admission refuses this with `OEC9013`; a model that bypassed
      // the source check still must not emit a start tag that silently omits
      // its children. Fail the producer instead.
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_VOID_CHILDREN',
        `void element <${node.tag}> may not have children`,
        node.span,
      );
      return false;
    }
    const tagName = node.tag.toLowerCase();
    const attributeOf = (name: string): FunctionModelAttribute | undefined =>
      node.attributes.find((attribute) => attribute.name.toLowerCase() === name);
    const selectValueAttribute = tagName === 'select' ? attributeOf('value') : undefined;
    let activeSelect = formContext?.select;
    let selectValueVar: string | undefined;
    let selectMultipleVar: string | undefined;
    if (selectValueAttribute !== undefined) {
      selectValueVar = nextName(state, 'selectValue');
      selectMultipleVar = nextName(state, 'selectMultiple');
      push(state, `let ${selectValueVar};`, node.span);
      push(state, `let ${selectMultipleVar} = false;`, node.span);
      const stateVar = nextName(state, 'selectState');
      push(state, `const ${stateVar} = { selected: false };`, node.span);
      activeSelect = { value: selectValueVar, multiple: selectMultipleVar, state: stateVar };
    }

    const textareaValueAttribute = tagName === 'textarea' ? attributeOf('value') : undefined;
    let textareaValueVar: string | undefined;
    if (textareaValueAttribute !== undefined) {
      textareaValueVar = nextName(state, 'textareaValue');
      push(state, `let ${textareaValueVar};`, node.span);
    }

    const controlledOption = tagName === 'option' && activeSelect !== undefined;
    const optionOpenVar = controlledOption ? nextName(state, 'optionOpen') : undefined;
    const optionChildrenVar = controlledOption ? nextName(state, 'optionChildren') : undefined;
    const optionTextVar = controlledOption ? nextName(state, 'optionText') : undefined;
    const optionValueVar = controlledOption ? nextName(state, 'optionValue') : undefined;
    if (controlledOption) {
      push(state, `const ${optionOpenVar} = [];`, node.span);
      push(state, `const ${optionChildrenVar} = [];`, node.span);
      push(state, `const ${optionTextVar} = [];`, node.span);
      push(state, `let ${optionValueVar} = null;`, node.span);
      const staticValue = attributeOf('value');
      if (staticValue?.kind === 'static') {
        push(state, `${optionValueVar} = ${literalText(staticValue.value)};`, staticValue.span);
      }
    }
    const childFormContext: SsrFormContext | undefined =
      controlledOption && activeSelect !== undefined
        ? { select: activeSelect, optionText: optionTextVar }
        : activeSelect === undefined
          ? formContext
          : {
              select: activeSelect,
              ...(formContext?.optionText === undefined
                ? {}
                : { optionText: formContext.optionText }),
            };

    if (formContext?.select !== undefined && node.tag.includes('-')) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_NODE',
        'a controlled select cannot determine option selectedness across a custom-element host',
        node.span,
      );
      return false;
    }
    // A light-root `<slot>` anchor: the pair brackets the slot element's
    // INTERIOR (after the open tag, around the fallback content), so the
    // serializer substitutes the caller's children for the fallback while the
    // `<slot>` node itself stays — the same shape the class lane's
    // projected-children channel produces. Both halves carry the slot NAME so a
    // substitution needs no lookup. `slots` is non-null only for a light root
    // that contains a slot (`lightSlotAnchorsEnabled`), so a shadow/absent root
    // and a slotless light tree emit exactly the pre-slice bytes.
    const slotOrdinal = node.tag === 'slot' && slots !== null ? slots.get(node) : undefined;
    // A slot outside this producer's map (a reusable-JSX body is a separate
    // render helper) renders UNANCHORED: its fallback must still appear, and a
    // projection into it fails closed at the serializer because no anchor names
    // it.
    const slotName = slotOrdinal === undefined ? null : slotNameOf(node);
    // alpha16 nested-expansion: a dash tag is a NESTED CUSTOM-ELEMENT HOST. Its
    // bytes are built into their own buffers and then routed through the ONE
    // `nestedHost` helper, which asks the render to expand it and falls back to
    // these same literal bytes when nothing admits the tag. An intrinsic tag
    // keeps direct pushes (byte-identical).
    const isNestedHost = node.tag.includes('-');
    const bytesVar = isNestedHost ? nextName(state, 'nestedOpen') : (optionOpenVar ?? outVar);
    const pairsVar = isNestedHost ? nextName(state, 'nestedAttrs') : undefined;
    const kidsVar = isNestedHost ? nextName(state, 'nestedKids') : undefined;
    const groupsVar = isNestedHost ? nextName(state, 'nestedGroups') : undefined;
    if (isNestedHost) {
      push(state, `const ${bytesVar} = [];`, node.span);
      push(state, `const ${pairsVar} = [];`, node.span);
      push(state, `const ${kidsVar} = [];`, node.span);
      push(state, `const ${groupsVar} = [];`, node.span);
    }
    push(state, `${bytesVar}.push(${literalText(`<${node.tag}`)});`, node.span);
    for (const attribute of node.attributes) {
      const attributeName = attribute.name.toLowerCase();
      if (tagName === 'select' && selectValueAttribute !== undefined && attributeName === 'value') {
        if (attribute.kind === 'static') {
          push(state, `${selectValueVar} = ${literalText(attribute.value)};`, attribute.span);
        } else {
          const record = recordFor(state, attribute.expression, records);
          if (record === null || !declareReads(state, record)) return false;
          pushParts(state, [`${selectValueVar} = (`, { record }, ');'], attribute.span);
        }
        continue;
      }
      if (
        tagName === 'textarea' &&
        textareaValueAttribute !== undefined &&
        attributeName === 'value'
      ) {
        if (attribute.kind === 'static') {
          push(state, `${textareaValueVar} = ${literalText(attribute.value)};`, attribute.span);
        } else {
          const record = recordFor(state, attribute.expression, records);
          if (record === null || !declareReads(state, record)) return false;
          pushParts(state, [`${textareaValueVar} = (`, { record }, ');'], attribute.span);
        }
        continue;
      }
      if (controlledOption && attributeName === 'selected') {
        continue;
      }
      if (
        tagName === 'select' &&
        selectValueAttribute !== undefined &&
        attributeName === 'multiple' &&
        attribute.kind === 'dynamic' &&
        attribute.channel === 'boolean'
      ) {
        const record = recordFor(state, attribute.expression, records);
        if (record === null || !declareReads(state, record)) return false;
        const multipleValueVar = nextName(state, 'selectMultipleValue');
        pushParts(
          state,
          [`const ${multipleValueVar} = Boolean((`, { record }, '));'],
          attribute.span,
        );
        push(state, `${selectMultipleVar} = ${multipleValueVar};`, attribute.span);
        push(
          state,
          `if (${selectMultipleVar}) ${bytesVar}.push(${JSON.stringify(' multiple=""')});`,
          attribute.span,
        );
        continue;
      }
      if (
        tagName === 'select' &&
        selectValueAttribute !== undefined &&
        attributeName === 'multiple' &&
        attribute.kind === 'dynamic' &&
        attribute.channel !== 'boolean'
      ) {
        const record = recordFor(state, attribute.expression, records);
        if (record === null || !declareReads(state, record)) return false;
        const multipleValueVar = nextName(state, 'selectMultipleValue');
        pushParts(
          state,
          [`const ${multipleValueVar} = attributeValueOf((`, { record }, '));'],
          attribute.span,
        );
        push(state, `${selectMultipleVar} = ${multipleValueVar} !== null;`, attribute.span);
        push(
          state,
          `if (${multipleValueVar} !== null) ${bytesVar}.push(${JSON.stringify(' multiple="')}, escapeAttrValue(${multipleValueVar}), ${JSON.stringify('"')});`,
          attribute.span,
        );
        continue;
      }
      if (
        tagName === 'select' &&
        selectValueAttribute !== undefined &&
        attributeName === 'multiple' &&
        attribute.kind === 'static'
      ) {
        push(state, `${selectMultipleVar} = true;`, attribute.span);
      }
      if (
        attribute.kind === 'dynamic' &&
        (CONSUMED_ATTRIBUTE_CHANNELS.has(attribute.channel) ||
          CLIENT_ONLY_ATTRIBUTE_CHANNELS.has(attribute.channel))
      ) {
        // `key` is list identity, never a DOM write; event/ref are client-only
        // attachments that render no server bytes (same rule as mount).
        continue;
      }
      if (attribute.kind === 'static') {
        if (!ATTRIBUTE_PATTERN.test(attribute.name)) return false;
        if (unsafeStreamFrameAttribute(attribute.name, attribute.value)) return false;
        // Same canonical spelling as the mount and the static producer: a
        // static BOOLEAN attribute renders `name=""`.
        const ssrValue = BOOLEAN_ATTRIBUTES.has(attribute.name.toLowerCase())
          ? ''
          : attribute.value;
        push(
          state,
          `${bytesVar}.push(${JSON.stringify(` ${attribute.name}="`)}, escapeAttrValue(${literalText(ssrValue)}), ${JSON.stringify('"')});`,
          attribute.span,
        );
        if (pairsVar !== undefined) {
          push(
            state,
            `${pairsVar}.push([${JSON.stringify(attribute.name)}, ${literalText(ssrValue)}]);`,
            attribute.span,
          );
        }
        continue;
      }
      if (
        !emitSsrDynamicAttribute(
          state,
          attribute,
          bytesVar,
          records,
          pairsVar,
          slotCaptureVar,
          controlledOption && attributeName === 'value' ? optionValueVar : undefined,
        )
      )
        return false;
    }
    if (!controlledOption) push(state, `${bytesVar}.push(">");`, node.span);
    if (isVoid) {
      if (isNestedHost)
        pushNestedHostExpansion(state, outVar, bytesVar, pairsVar!, kidsVar!, groupsVar!, node);
      continue;
    }
    const childVar = kidsVar ?? optionChildrenVar ?? outVar;
    if (slotOrdinal !== null && slotName !== null) {
      push(
        state,
        `${childVar}.push("<!--", markerText(slotAnchorMarker(${slotOrdinal}, ${literalText(slotName)})), "-->");`,
        node.span,
      );
    }
    // A nested light host needs caller child groups as well as their concatenated
    // fallback bytes: its own <slot> anchors route each authored child to the
    // right named region. The composition context flattens fragments and walks
    // selected condition/list roots at producer time, rendering each root once
    // into both channels.
    const directory =
      !isNestedHost && textareaValueVar === undefined && markers && directoryParentAllowed(node.tag)
        ? staticElementDirectory(node.children)
        : null;
    if (isNestedHost) {
      if (
        !emitDynamicSsrNodes(
          state,
          node.children,
          kidsVar!,
          markers,
          records,
          slots,
          undefined,
          undefined,
          {
            groups: groupsVar!,
          },
        )
      )
        return false;
    } else if (directory !== null) {
      for (const [ordinal, range] of directory.entries()) {
        push(
          state,
          `${childVar}.push("<!--", markerText(rangeMarker(${ordinal})), "-->");`,
          range.span,
        );
        if (
          !emitDynamicSsrNodes(
            state,
            [range],
            childVar,
            false,
            records,
            slots,
            undefined,
            childFormContext,
          )
        )
          return false;
        push(
          state,
          `${childVar}.push("<!--", markerText(rangeMarker(${ordinal}, true)), "-->");`,
          range.span,
        );
      }
    } else if (textareaValueVar !== undefined) {
      const textareaTextVar = nextName(state, 'textareaText');
      push(
        state,
        `if (${textareaValueVar} !== null && ${textareaValueVar} !== undefined) {`,
        node.span,
      );
      state.indent += 1;
      push(
        state,
        `const ${textareaTextVar} = displayValue(${textareaValueVar}).replace(/\\r\\n?/g, "\\n");`,
        node.span,
      );
      push(
        state,
        `${outVar}.push(escapeText(${textareaTextVar}.startsWith("\\n") ? "\\n" + ${textareaTextVar} : ${textareaTextVar}));`,
        node.span,
      );
      state.indent -= 1;
      push(state, '} else {', node.span);
      state.indent += 1;
      if (
        !emitDynamicSsrNodes(
          state,
          node.children,
          childVar,
          markers,
          records,
          slots,
          undefined,
          childFormContext,
        )
      )
        return false;
      state.indent -= 1;
      push(state, '}');
    } else if (
      !emitDynamicSsrNodes(
        state,
        node.children,
        childVar,
        markers,
        records,
        slots,
        undefined,
        childFormContext,
      )
    ) {
      return false;
    }
    if (slotOrdinal !== null && slotName !== null) {
      push(
        state,
        `${childVar}.push("<!--", markerText(slotAnchorMarker(${slotOrdinal}, ${literalText(slotName)}, true)), "-->");`,
        node.span,
      );
    }
    if (isNestedHost) {
      pushNestedHostExpansion(state, outVar, bytesVar, pairsVar!, kidsVar!, groupsVar!, node);
      continue;
    }
    if (controlledOption && activeSelect !== undefined) {
      const optionEffectiveValue = nextName(state, 'optionEffectiveValue');
      push(
        state,
        `const ${optionEffectiveValue} = ${optionValueVar} === null ? selectOptionValue(${optionTextVar}.join("")) : ${optionValueVar};`,
        node.span,
      );
      push(
        state,
        `if (selectOptionSelected(${activeSelect.value}, ${optionEffectiveValue}, ${activeSelect.multiple}, ${activeSelect.state})) ${optionOpenVar}.push(${JSON.stringify(' selected=""')});`,
        node.span,
      );
      push(state, `${optionOpenVar}.push(">");`, node.span);
      push(
        state,
        `${outVar}.push(${optionOpenVar}.join(""), ${optionChildrenVar}.join(""), ${literalText(`</${node.tag}>`)});`,
        node.span,
      );
      continue;
    }
    push(state, `${outVar}.push(${literalText(`</${node.tag}>`)});`, node.span);
  }
  return true;
}

/**
 * alpha16 nested-expansion: close one nested custom-element host.
 *
 * The element's bytes are in two buffers (`open`: the start tag plus attributes
 * and `>`; `kids`: its children), and the attribute pairs were recorded as they
 * were serialized. The emitted call hands all three to `nestedHost`, which asks
 * the render's host to expand the tag and falls back to the caller's own literal
 * bytes when nothing admits it — so an un-admitted tag produces exactly the
 * markup the direct pushes would have produced.
 *
 * Stated as a request record (never positional arguments) because the expander
 * is host-supplied code: a named shape is what makes the contract readable at
 * both ends.
 */
function pushNestedHostExpansion(
  state: EmitState,
  outVar: string,
  openVar: string,
  pairsVar: string,
  kidsVar: string,
  groupsVar: string,
  node: {
    readonly tag: string;
    readonly span: SpanLike;
    readonly children: readonly FunctionModelNode[];
  },
): void {
  const htmlVar = nextName(state, 'nestedHtml');
  const kidsHtmlVar = nextName(state, 'nestedKids');
  push(state, `const ${htmlVar} = ${openVar}.join("");`, node.span);
  push(state, `const ${kidsHtmlVar} = ${kidsVar}.join("");`, node.span);
  push(
    state,
    `${outVar}.push(nestedHost(${state.hostVar}, { tag: ${JSON.stringify(node.tag)}, attributes: ${pairsVar}, open: ${htmlVar}, children: ${kidsHtmlVar}, groups: ${groupsVar}, hasChildren: ${node.children.length > 0}, fallback: ${htmlVar} + ${kidsHtmlVar} + ${JSON.stringify(`</${node.tag}>`)} }));`,
    node.span,
  );
}

/**
 * Which local setup resources the dynamic SSR producer actually evaluates.
 *
 * The producer used to declare/evaluate EVERY local setup resource, even one
 * referenced only from a client-only channel (an event handler or ref
 * callback). Those expressions can read imported callables, so an unused
 * declaration made `__ssr` request a callable it never used. This walk mirrors
 * the producer's traversal — server-rendered text, attribute/boolean values,
 * condition/list expressions, component-reference prop records and every
 * recipe target reachable from an insertion site — and then closes over local
 * resources transitively: a reachable local's initializer may read another
 * local. Resources used only by client-only attributes (or by other pruned
 * locals) are not declared.
 *
 * Deliberately conservative in one direction: an entry-local mapper name that
 * coincides with an outer local resource keeps the outer declaration.
 * Over-declaration reproduces the old bytes; under-declaration would be a
 * runtime ReferenceError. Evaluation order of the SURVIVING locals is the
 * authored order (the loop keeps the component.resources order).
 */
function ssrReachableLocalResourceNames(
  component: FunctionModelComponent,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  /**
   * ADR-0183 D-4: records the producer evaluates OUTSIDE the JSX tree — the
   * `signal`/`computed` derivations it creates inline. A setup local those
   * bodies read (a shared chrome-copy snapshot, a formatter input) is
   * server-reachable exactly as one the JSX reads is; without these seeds the
   * producer emitted the derivation and dropped the local it captures, which is
   * a runtime `undefined` at SSG.
   */
  extraSeeds: readonly LoweredExpressionRecord[] = [],
): ReadonlySet<string> {
  const localRecords = new Map<string, LoweredExpressionRecord>();
  for (const resource of component.resources) {
    // A `16b-REF` handle is a CLIENT-ONLY channel value (its `ref` attribute
    // never renders SSR bytes and its notification never runs on the server),
    // so it is never a server-reachable local. Its notification callback is not
    // a value the producer reads either.
    if (resource.kind !== 'local' || resource.recipeId !== null || resource.expression === null) {
      continue;
    }
    const record = records.get(resource.expression.id);
    if (record !== undefined) localRecords.set(resource.name, record);
  }
  const recipes = new Map(component.recipes.map((recipe) => [recipe.id, recipe] as const));
  const usedRecords = new Set<LoweredExpressionRecord>();
  const visitedNodes = new Set<FunctionModelNode>();
  const visitedRecipes = new Set<string>();
  const collect = (ref: FunctionExpressionRef | null | undefined): void => {
    if (ref === null || ref === undefined) return;
    const record = records.get(ref.id);
    if (record !== undefined) usedRecords.add(record);
  };
  const walkAttributes = (attributes: readonly FunctionModelAttribute[]): void => {
    for (const attribute of attributes) {
      if (attribute.kind !== 'dynamic') continue;
      if (CLIENT_ONLY_ATTRIBUTE_CHANNELS.has(attribute.channel)) continue;
      collect(attribute.expression);
    }
  };
  const walkNodes = (nodes: readonly FunctionModelNode[]): void => {
    for (const node of nodes) walkNode(node);
  };
  const walkRecipe = (recipeId: string): void => {
    if (visitedRecipes.has(recipeId)) return;
    visitedRecipes.add(recipeId);
    const recipe = recipes.get(recipeId);
    if (recipe !== undefined) walkNode(recipe.target);
  };
  const walkNode = (node: FunctionModelNode): void => {
    if (visitedNodes.has(node)) return;
    visitedNodes.add(node);
    if (node.kind === 'text') return;
    if (node.kind === 'fragment') {
      walkNodes(node.children);
      return;
    }
    if (node.kind === 'dynamic-text') {
      collect(node.expression);
      return;
    }
    if (node.kind === 'element') {
      walkAttributes(node.attributes);
      walkNodes(node.children);
      return;
    }
    if (node.kind === 'condition') {
      collect(node.test);
      walkNodes(node.consequent);
      if (node.alternate !== null) walkNodes(node.alternate);
      return;
    }
    if (node.kind === 'list') {
      collect(node.items);
      if (node.key !== null) collect(node.key);
      walkNodes(node.template);
      return;
    }
    if (node.kind === 'component-ref') {
      walkAttributes(node.props);
      if (node.childrenRecipeId !== null) walkRecipe(node.childrenRecipeId);
      return;
    }
    if (node.kind === 'insertion-site') walkRecipe(node.recipeId);
  };
  walkNodes(component.roots);
  for (const record of extraSeeds) usedRecords.add(record);

  // Transitive closure over the local initializers the server output reads.
  const reachable = new Set<string>();
  const queue: LoweredExpressionRecord[] = [...usedRecords];
  const seen = new Set<LoweredExpressionRecord>(queue);
  while (queue.length > 0) {
    const record = queue.pop()!;
    for (const read of record.reads) {
      const localRecord = localRecords.get(read.name);
      if (localRecord === undefined) continue;
      reachable.add(read.name);
      if (!seen.has(localRecord)) {
        seen.add(localRecord);
        queue.push(localRecord);
      }
    }
  }
  return reachable;
}

/**
 * Emit `<Name>__ssr(props, host)` for a component with at least one admitted
 * dynamic slot. Returns null when the shape is outside the slice (for example
 * a condition, list, component reference, insertion site or property channel);
 * diagnostics are returned as a failed emission so the module fails closed the
 * same way mount/claim failures do. Void elements are admitted: they emit the
 * start tag and attributes only.
 */
function emitDynamicSsrFunction(
  file: string,
  component: FunctionModelComponent,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
  slots: SlotAnchors | null,
  /** ADR-0183 D-4: this body is the element root's producer (see `EmitState`). */
  elementRootBinding: boolean,
): SsrEmission | null {
  const propsName = component.propsParam;
  const projectsChildren = componentProjectsChildren(component);
  const composition = treeHasComposition(component.roots);
  const state = ssrEmitState(component, file, propsName, componentByName, projectsChildren);
  if (elementRootBinding) state.elementRootBinding = true;
  if (!assertTextBoundaryContext(state, component.roots)) return failedSsr(state);
  const usesContext = componentUsesContextIntrinsic(component);
  // `16b-CTX` SERVER side: the render's owner scope is a PARAMETER of this
  // producer call (or a fresh scope created here for the module root). It is
  // declared before any consumer/provider line so the emitted body reads exactly
  // one scope, and it is never module state — two concurrent renders cannot see
  // each other's providers (see `CompiledContextService.forRender`). A component
  // that only FORWARDS a scope to a context-using child still declares one: that
  // is the server image of "every component reference is one owner".
  if (componentNeedsSsrContextScope(component, componentByName)) emitSsrContextScope(state);
  // Providers publish BEFORE consumers resolve, so a component that both
  // provides and consumes reads its OWN value — the same ordering the client's
  // retained setup factory uses.
  if (usesContext) emitContextProviders(state, component.contextProviders, records);
  // Only locals the server output actually (transitively) evaluates are
  // declared. A client-only handler/ref helper must not make `__ssr` request a
  // callable it never reads; surviving locals keep their authored order.
  // ADR-0183 D-4: the derived nodes' own bodies are evaluated here too, so the
  // reachability closure is seeded with them.
  const reachableLocalResources = ssrReachableLocalResourceNames(
    component,
    records,
    (elementRootBinding ? component.resources : [])
      .filter(
        (resource) =>
          (resource.kind === 'signal' || resource.kind === 'computed') &&
          resource.expression !== null,
      )
      .map((resource) => records.get(resource.expression!.id))
      .filter((record): record is LoweredExpressionRecord => record !== undefined),
  );
  for (const resource of component.resources) {
    if (!IDENTIFIER_PATTERN.test(resource.name) || resource.name.startsWith(INTERNAL_PREFIX)) {
      continue;
    }
    if (resource.kind === 'ref') {
      // `16b-REF`: the handle exists on the CLIENT only. The `ref` channel
      // renders no SSR bytes and its notification never runs on the server, so
      // the producer neither builds the handle nor evaluates the callback —
      // exactly the phase-labelled setup-pruning rule the plain `ref` channel
      // already follows for client-only setup locals.
      state.localResources.add(resource.name);
      continue;
    }
    if (resource.kind === 'context') {
      // `16b-CTX`: a consumer is resolved AT RENDER TIME from the nearest
      // provider the render's owner scope can see, so the producer builds the
      // SAME consumer-local signal the client builds — with the PROVIDED value
      // instead of the declared default. The signal is written synchronously by
      // `use` (render mode has no connection and no later write), which is what
      // makes the server bytes and the claimed value provably the same rule.
      if (resource.expression === null) continue;
      const record = recordFor(state, resource.expression, records);
      if (record === null || !declareReads(state, record)) return failedSsr(state);
      state.localResources.add(resource.name);
      emitSetupBinding(state, {
        name: resource.name,
        kind: 'context',
        record,
        span: resource.span,
      });
      continue;
    }
    if (resource.kind === 'local') {
      if (resource.recipeId !== null || resource.expression === null) continue;
      // Recognized as a local for read classification even when pruned, so a
      // miss would fail as a missing declaration instead of a fake binding.
      state.localResources.add(resource.name);
      if (!reachableLocalResources.has(resource.name)) continue;
      const record = recordFor(state, resource.expression, records);
      if (record === null || !declareReads(state, record)) return failedSsr(state);
      pushParts(state, [`const ${resource.name} = (`, { record }, ');'], resource.span);
      continue;
    }
    // ADR-0183 D-4: the server has no bindings channel and must not acquire one
    // (a per-render, no-graph contract), so a `signal`/`computed` resource is
    // CREATED here and the producer reads it as a local. This is what keeps one
    // component working in both phases instead of only after hydration.
    if ((resource.kind === 'signal' || resource.kind === 'computed') && state.elementRootBinding) {
      if (resource.expression === null) {
        state.hostBindings.add(resource.name);
        state.requiredBindings.add(resource.name);
        continue;
      }
      const record = recordFor(state, resource.expression, records);
      if (record === null || !declareReads(state, record)) return failedSsr(state);
      state.localResources.add(resource.name);
      pushParts(
        state,
        [
          resource.kind === 'computed'
            ? `const ${resource.name} = computed(`
            : `const ${resource.name} = signal((`,
          { record },
          resource.kind === 'computed' ? ');' : '));',
        ],
        resource.span,
      );
      continue;
    }
    state.hostBindings.add(resource.name);
    state.requiredBindings.add(resource.name);
  }
  if (state.diagnostics.length > 0) return failedSsr(state);
  // Mount reads `props.children` once before the roots and fails closed when
  // the host supplied no recipe (M06b2a). The server root instance has the
  // same boundary: it has no children renderer, so a children projection must
  // not render nothing. A component reference supplies the renderer instead.
  if (projectsChildren) {
    push(
      state,
      `if (${SSR_CHILDREN_RENDER} === null) throw new Error("OEIR_LEAF_MISSING_CHILDREN: component '<${component.name}>' projects props.children but the server instance was given no children renderer");`,
      component.span,
    );
  }
  if (composition) {
    // One local render function per referenced recipe (reusable JSX value or
    // children recipe), then calls at every projection. Same recipe twice =
    // one function, two calls; this is not a second AST and not serialized JSON.
    if (!emitSsrRecipeHelpers(state, records)) {
      return state.diagnostics.length > 0 ? failedSsr(state) : null;
    }
  }
  const outVar = nextName(state, 'out');
  push(state, `const ${outVar} = [];`);
  if (!emitDynamicSsrNodes(state, component.roots, outVar, true, records, slots)) {
    return state.diagnostics.length > 0 ? failedSsr(state) : null;
  }
  push(state, `return ${outVar}.join("");`);
  if (state.diagnostics.length > 0) return failedSsr(state);

  // A composition body is reachable from two call sites (the exported wrapper
  // and a component reference that must pass a children renderer), so it
  // lives in one module-local helper. The exported interface keeps its
  // existing M08-1b `(props, host)` shape; the helper name never leaves the
  // generated module (no cross-module/A17 ABI).
  //
  // `16b-CTX`: a producer whose SUBTREE uses context also takes the render scope
  // as a trailing parameter, so the scope rides the call graph and is never
  // module state (two concurrent renders stay independent). A producer that
  // neither provides, consumes nor references a context user keeps its exact
  // pre-`16b-CTX` signature and bytes.
  const needsScope = componentNeedsSsrContextScope(component, componentByName);
  const scopeParam = needsScope ? `, ${SSR_CONTEXT_PARAM}` : '';
  const prologue: string[] = composition
    ? [
        `function ${SSR_HELPER_PREFIX}${component.name}(${MOUNT_PROPS}, ${MOUNT_HOST}, ${SSR_CHILDREN_RENDER}${scopeParam}) {`,
      ]
    : [
        `export function ${component.name}${SSR_SUFFIX}(${MOUNT_PROPS}, ${MOUNT_HOST}${scopeParam}) {`,
      ];
  if (propsName !== null) {
    prologue.push(`  const ${propsName} = ${MOUNT_PROPS};`);
    state.requiredProps.add(propsName);
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
  const wrapper: string[] = composition
    ? [
        `export function ${component.name}${SSR_SUFFIX}(${MOUNT_PROPS}, ${MOUNT_HOST}${scopeParam}) {`,
        `  return ${SSR_HELPER_PREFIX}${component.name}(${MOUNT_PROPS}, ${MOUNT_HOST}, null${needsScope ? `, ${SSR_CONTEXT_PARAM}` : ''});`,
        '}',
        '',
      ]
    : [];
  const shift = fragmentLineCount(prologue);
  return {
    lines: [...prologue, ...state.lines, '}', ...wrapper],
    diagnostics: [],
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
 * Emit the SSR function for a claimable component. A fully static component
 * keeps the M08-1a `__ssr()` form (no parameters, byte-identical output); a
 * component with an admitted dynamic slot gets the M08-1b
 * `__ssr(props, host)` form. Returns `null` when the tree is outside the
 * producer slice.
 *
 * `lightRoot` is the ONE gate for the slot-anchor family. It is true only for
 * the root component of a light-descriptor generated element; a shadow root's
 * children are distributed by the platform (a `<slot>` in the shadow tree plus
 * light DOM after `</template>`) and a hostless leaf module is not a host, so
 * both emit no anchor and keep their pre-slice bytes.
 */
export function emitSsrFunction(
  file: string,
  component: FunctionModelComponent,
  rootDirectory: readonly FunctionModelNode[] | null,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
  lightRoot: boolean,
  /**
   * ADR-0183 D-4 compiler-private marker: the ELEMENT ROOT component whose
   * `signal`/`computed` resources the producer must create per render, because
   * the element host record has no bindings channel. `null` for a hostless leaf
   * module, whose consumer supplies the bindings record (unchanged behavior).
   */
  rootComponent: string | null,
): SsrEmission | null {
  // The gate runs FIRST, on its own emit state: a dynamic slot name must be
  // refused before any byte is emitted, and both producer shapes below share the
  // resulting map so a static and a dynamic tree cannot disagree about an
  // ordinal. A null map means "emit nothing" — the byte-identity cases, where no
  // emission site is reached at all.
  const state = ssrEmitState(
    component,
    file,
    component.propsParam,
    componentByName,
    componentProjectsChildren(component),
  );
  const enabled = lightSlotAnchorsEnabled(state, lightRoot);
  if (state.diagnostics.length > 0) return failedSsr(state);
  // The SSR producers INLINE conditions and list templates (mount/claim emit
  // them as their own chunks), so this map descends into both: a slot inside a
  // branch still needs an ordinal, and it must be the one the producer writes.
  const slots = enabled ? ssrSlotAnchorOrdinals(component.roots) : null;
  let expression: string | null;
  if (rootDirectory !== null) {
    expression = staticSsrDirectory(rootDirectory, slots);
  } else {
    expression = staticSsrExpression(component.roots, true, slots);
  }
  if (expression !== null) {
    return {
      lines: [
        `export function ${component.name}${SSR_SUFFIX}() {`,
        `  return ${expression};`,
        '}',
        '',
      ],
      diagnostics: [],
      segments: [],
      placements: [],
    };
  }
  return emitDynamicSsrFunction(
    file,
    component,
    records,
    componentByName,
    slots,
    rootComponent !== null && component.name === rootComponent,
  );
}
