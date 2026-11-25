/** Shared emission state and JavaScript text helpers. */

import {
  type FunctionModelImport,
  type FunctionModelComponent,
  type FunctionModelNode,
  type FunctionExpressionRef,
  type FunctionModelAttribute,
  type FunctionModelComponentRef,
} from '../../semantic-core/function-frontend.ts';
import { type IrDiagnostic, type IrSpan } from '../types.ts';
import { type EmissionSegment } from '../../semantic-core/source-map.ts';
import { type LoweredExpressionRecord } from '../../semantic-core/expression-registry.ts';
import { type BindingId } from '../../semantic-core/scope-resolution.ts';

export const INTERNAL_PREFIX = '__oe_';

/**
 * 16b-LC depth >= 2 (2026-11-21): the transaction token local of a retaining
 * body. The root body captures `beginInstancePass`'s return in it; a retained
 * body reads the token from its compiler-private host literal and joins. The
 * `__oe_` prefix is refused for authored identifiers, so it cannot collide.
 */
export const TRANSACTION_VAR = `${INTERNAL_PREFIX}txn`;

/** The namespace URI an `<svg>` subtree is created and claimed in. */
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * `16b-EB`: the compiler-private host-record property that carries the
 * update-phase error sink into `guardUpdate`. A GETTER on the shell side, so
 * registration order cannot matter; generated code only reads it where a refresh
 * subscription is opened.
 */
export const ERROR_REPORT_PROPERTY = `${INTERNAL_PREFIX}reportError`;

/**
 * Whether any component in the module registers an `onError` handler
 * (`16b-EB`). The registration AND the update-phase sink ride the host-record
 * literals only for such a module, so every other module keeps its exact bytes
 * (including every `guardUpdate` call, which stays a two-name call).
 */
export function moduleUsesErrorBoundary(state: EmitState): boolean {
  for (const component of state.componentByName.values()) {
    if (component.lifecycle.some((hook) => hook.kind === 'error')) return true;
  }
  return false;
}

/**
 * The M02 marked-printer placeholder for a JSX value lowered inside an
 * expression (`__oe_recipe_ref("id")`). The function model keeps the recipe
 * identity for the M02 §recipe model, but the generated leaf module can only
 * execute recipes created by a direct component-local JSX initializer, so any
 * lowered record carrying this placeholder fails closed.
 */
export const RECIPE_REFERENCE_CALLEE = '__oe_recipe_ref';

/**
 * Module-level component mount (M06b1a-1): `<Name>__mount(scope, props, host)`.
 * The mount builds one detached instance and returns its top-level nodes; both
 * the exported root factory and every component-reference call site delegate to
 * it, so one component body is emitted exactly once per module.
 */
export const MOUNT_SUFFIX = '__mount';

/** Fixed module-level mount parameters; they define the emitted host record shape. */
export const MOUNT_SCOPE = `${INTERNAL_PREFIX}scope`;

export const MOUNT_PROPS = `${INTERNAL_PREFIX}props`;

export const MOUNT_HOST = `${INTERNAL_PREFIX}host`;

/**
 * Module-level claim (M07a): `<Name>__claim(scope, props, host, parent)` adopts
 * the existing children of `parent`. Emitted only for the static leaf shape.
 */
export const CLAIM_SUFFIX = '__claim';

/** Static SSR producer (M08-1a): `<Name>__ssr()` returns the mount HTML. */
export const SSR_SUFFIX = '__ssr';

/**
 * M08 composition SSR: the third parameter of the module-local
 * `__oe_ssrComponent_<Component>` helper. It renders the children recipe a
 * `<Frame>…</Frame>` reference passed, once per `{props.children}` projection.
 * The exported `<Name>__ssr(props, host)` wrapper passes null, so a root
 * instance of a children-projecting component still fails closed.
 */
export const SSR_CHILDREN_RENDER = `${INTERNAL_PREFIX}renderChildren`;

/** Module-local helper name prefix for a composition component (`__oe_ssrComponent_<Name>`). */
export const SSR_HELPER_PREFIX = `${INTERNAL_PREFIX}ssrComponent_`;

export const CLAIM_PARENT = `${INTERNAL_PREFIX}parent`;

/**
 * The module-level mount's host record: the parent-provided host bindings plus
 * the defining-scope signals a child instance refreshes props reads through.
 * The root factory supplies `[host.propsChanged]`; a component-reference call
 * site supplies the parent bindings its prop expressions depend on.
 */
const MOUNT_DEP_LOOP = `${INTERNAL_PREFIX}propDep`;

export const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;

export const ATTRIBUTE_PATTERN = /^[A-Za-z_:][A-Za-z0-9_:.-]*$/;

/**
 * Dynamic intrinsic-element channels the generated leaf can install. `event`
 * and `ref` are client-only attachment channels: they never become DOM
 * attributes and never render SSR bytes.
 */
export const ADMITTED_ATTRIBUTE_CHANNELS: ReadonlySet<string> = new Set([
  'attribute',
  'boolean',
  'property',
  'event',
  'ref',
]);

/**
 * The channels a component REFERENCE may pass as props. Event/ref stay refused
 * here: a child callback prop would be a second callback API, not the
 * intrinsic DOM-handler/ref channel this slice admits.
 */
const COMPONENT_PROP_ATTRIBUTE_CHANNELS: ReadonlySet<string> = new Set([
  'attribute',
  'boolean',
  'property',
]);

/** Attributes the compiler consumes as identity (never a DOM write). */
export const CONSUMED_ATTRIBUTE_CHANNELS: ReadonlySet<string> = new Set(['key']);

/**
 * Client-only attachment channels: installed as listeners/handlers on the
 * created/adopted element, excluded from SSR bytes and from the claim's
 * attribute seed, and never DOM attributes. They are event handlers (called
 * with the native event) and ref handlers (called with the element on attach,
 * with the returned cleanup on detach, then with null).
 */
export const CLIENT_ONLY_ATTRIBUTE_CHANNELS: ReadonlySet<string> = new Set(['event', 'ref']);

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

/**
 * The module's static import table as the generated lane may keep it.
 *
 * Registered per component in a WeakMap so the many `EmitState` construction
 * sites keep their shape: a read that resolves to a static import stays a
 * DIRECT module reference (the import is re-emitted verbatim) instead of
 * becoming a host binding the shell would have to supply.
 */
export interface ModuleImportContext {
  readonly byLocal: ReadonlyMap<string, FunctionModelImport>;
  readonly used: Map<string, FunctionModelImport>;
}

export const importContexts = new WeakMap<FunctionModelComponent, ModuleImportContext>();

export function importContextOf(
  component: FunctionModelComponent,
): ModuleImportContext | undefined {
  return importContexts.get(component);
}

export interface EmitState {
  readonly component: FunctionModelComponent;
  /**
   * ADR-0183 D-4: this SSR body belongs to the ELEMENT ROOT, whose host record
   * has no bindings channel — so its `signal`/`computed` resources are created
   * inline per render instead of being read from `host.bindings`.
   */
  elementRootBinding?: boolean;
  readonly lines: string[];
  /**
   * Physical generated lines emitted so far in this chunk. `lines` holds one
   * array element per statement, but a multi-line lowered expression is ONE
   * element containing real newlines; line numbers must count those, or every
   * placement after it drifts by the embedded-newline count.
   */
  physicalLine: number;
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
   * the component projects no children. Emitted before the roots so the nested
   * branch/entry builders emitted inside the mount close over one value; every
   * projection site inserts through this same recipe.
   */
  childrenRecipeVar: string | null;
  /**
   * M08 composition SSR: recipe id → the module-local render function emitted
   * inside this component's SSR body. One function per referenced recipe, so
   * the same recipe inserted twice calls one function twice. Empty outside
   * composition SSR.
   */
  readonly ssrRecipeVars: Map<string, string>;
  /**
   * M08 composition SSR: the `props.children` renderer parameter of a
   * children-projecting component, or null when this component projects no
   * children. The exported `<Name>__ssr` wrapper supplies null; a component
   * reference supplies the render function of the children recipe it passes.
   */
  ssrChildrenRenderVar: string | null;
  /** `file#Component` label passed to a static sibling directory. */
  directorySource: string;
  /**
   * True once this emitted chunk calls `openStaticSiblingDirectory` (the
   * generated claim). The module header imports the directory consumer only
   * when at least one component chunk needs it; mount emission alone does not.
   */
  usesStaticSiblingDirectoryConsumer: boolean;
  /**
   * M07-1: claim walks `__oe_claimCursor` so a nested recipe or component claim
   * continues the parent sibling list instead of restarting at `parent.childNodes`.
   * Static-only claims leave this false and keep the M07a local cursor.
   */
  claimCursorShared: boolean;
  /** M09-2e / #1803: skip the canonical marked stylesheet-link prefix before the root claim walk. */
  claimStyleLinkPrefix: boolean;
  /** Runtime array that collects adopted root nodes, or null for the M07a static return. */
  claimAdoptedVar: string | null;
  /**
   * M08-2 B2: the generated activation-queue variable for the claim being
   * emitted, or null when phase-2 work is emitted inline. Only the shared
   * cursor path queues: its per-element blocks cannot be flushed until the
   * enclosing cursor owner has validated its final structure.
   */
  claimActivationVar: string | null;
  /** True once this claim chunk calls `claimRecipe`. */
  usesClaimRecipe: boolean;
  /**
   * ADR-0175 D-2. Mount emits range markers only when this component emits a
   * claim function. A pure-mount tree leaves the flag false.
   */
  emitDirectoryMarkers: boolean;
  /**
   * M08 text boundary gate. True for a claimable component/chunk: mount emits
   * the same `oe:t` pair the claim consumes, and static adjacent text is
   * normalized to one run. A pure-mount tree leaves the flag false (authored
   * granularity, no inert comments).
   */
  emitTextBoundaries: boolean;
  /**
   * Chunk-local pre-order ordinal for every `dynamic-text` node in the current
   * emitted chunk (component roots or one recipe target). The map is built by
   * the pure `textSlotOrdinals` helper; a missing entry is an internal
   * diagnostic, never a guessed ordinal.
   */
  textOrdinals: ReadonlyMap<FunctionModelNode, number>;
  /**
   * M08 list entry-claim scratch, or null outside an entry claim chunk. The
   * refreshes are function-scoped slot writes the entry's `update(next)` can
   * force; the activate emitters are emitted inside the returned `activate`
   * closure only, so verify performs no write and opens no subscription.
   */
  claimEntry: {
    readonly refreshes: string[];
    readonly activate: Array<() => void>;
  } | null;
  /** True once this chunk throws the leaf-claim mismatch. */
  usesLeafClaimMismatch: boolean;
  /**
   * Depth-1 nested-retention plan (`16b-LC retained-child`), or null when this module emits
   * today's bytes. Reference sites resolve their retained-vs-legacy emission
   * against `retainedRefs` (reference identity), never a counter or a name.
   */
  readonly retention: RetentionPlan | null;
  /**
   * True while emitting the ROOT retaining body: the only body that brackets an
   * instance pass, retains children and emits the R1–R6 release text. False in
   * every non-root/leaf/recipe body.
   */
  retainBody: boolean;
  /** True while emitting a leaf instance body (aliases the retained record). */
  leafBody: boolean;
  /** This body emits retain calls (root, or a retained body with retained children). */
  retainsChildren: boolean;
  /**
   * Number of enclosing claim-time recipe bodies (M07a). It is separate from
   * `recipeDepth` because claim-time recipe closures are emitted inside the
   * claim chunk without the mount recipe-depth walk; reference sites and
   * release text must treat them as recipe bodies (ineligible, no ledger text).
   */
  claimTimeRecipeDepth: number;
}

export function diag(state: EmitState, code: string, message: string, span: IrSpan): void {
  state.diagnostics.push({
    severity: 'error',
    code,
    message,
    span,
    origin: 'ir-object',
  });
}

export interface SpanLike {
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

/** Real newlines in one emitted line element (a multi-line lowered expression). */
function countLineBreaks(line: string): number {
  let count = 0;
  for (const character of line) if (character === '\n') count += 1;
  return count;
}

/** Physical lines a generated fragment occupies (elements may contain newlines). */
export function fragmentLineCount(lines: readonly string[]): number {
  let count = 0;
  for (const line of lines) count += 1 + countLineBreaks(line);
  return count;
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
export function push(state: EmitState, text: string, anchor?: SpanLike): void {
  const lineNumber = state.physicalLine + 1;
  if (anchor !== undefined) {
    // Structural anchors map from the generated line start (statement position).
    addSegment(state, lineNumber, 0, anchor.line, anchor.column - 1);
  }
  const line = `${'  '.repeat(state.indent)}${text}`;
  state.lines.push(line);
  state.physicalLine += 1 + countLineBreaks(line);
}

/**
 * Append one generated line containing lowered expression text: the placement
 * is recorded and the A2 expression segments are rebased into module
 * coordinates (multi-line lowering keeps later lines at their own columns).
 */
export function pushParts(state: EmitState, parts: readonly LinePart[], anchor?: SpanLike): void {
  const lineNumber = state.physicalLine + 1;
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
  state.physicalLine += 1 + countLineBreaks(text);
}

/** Register one generated refresh function with the enclosing entry builder. */
export function registerRefresh(state: EmitState, name: string): void {
  const collector = state.refreshStack[state.refreshStack.length - 1];
  if (collector !== undefined) collector.push(name);
}

/**
 * True when the record reads a name bound by an enclosing list-entry builder
 * (the mapper parameter). Such a read has no reactive dependency: a keyed reuse
 * or an unkeyed positional reuse re-binds the parameter through
 * `update(next)`. A zero-dependency slot that reads an entry-local name must
 * therefore still register a refresh closure, otherwise it keeps the first
 * snapshot (the M06b2c defect).
 */
export function readsEntryLocal(state: EmitState, record: LoweredExpressionRecord): boolean {
  // Outside an entry builder there is nothing to re-run against (a component
  // mount has no `update` hook); keep today's static write byte-identical.
  if (state.refreshStack.length === 0) return false;
  return record.reads.some(
    (read) => state.entryNames.has(read.name) || state.entryNames.has(read.binding.name),
  );
}

/**
 * Emit `function <refresh>() { <write> } <refresh>();` and return the refresh
 * name. The caller decides whether it registers with the enclosing entry builder
 * and whether dependency subscriptions are added (zero-dependency vs tracked).
 */
export function emitLocalRefresh(state: EmitState, anchor: SpanLike, write: () => void): string {
  const refresh = nextName(state, 'refresh');
  push(state, `function ${refresh}() {`, anchor);
  state.indent += 1;
  write();
  state.indent -= 1;
  push(state, `}`);
  push(state, `${refresh}();`);
  return refresh;
}

export function nextName(state: EmitState, prefix: string): string {
  return `${INTERNAL_PREFIX}${prefix}${state.counter.value++}`;
}

export function toIrSpan(ref: FunctionExpressionRef): IrSpan {
  return ref.span;
}

function bindingKey(id: BindingId): string {
  return `${id.scope.path}#${id.name}#${id.declarationOrder}`;
}

export function recordFor(
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
export function declareReads(
  state: EmitState,
  record: LoweredExpressionRecord,
  /**
   * Names the ENCLOSING retained setup factory declares as sibling locals
   * (ADR-0183 D-4: the ROOT's `signal`/`computed` resources). A read of one is a
   * closure capture there, not a host-binding demand: the factory creates the
   * value before the hook closures are recorded, and mount/claim demand the same
   * name through the bindings record in their own `declareReads` calls. An empty
   * set (every non-root component) changes no behaviour.
   */
  localCaptures?: ReadonlySet<string>,
): boolean {
  for (const read of record.reads) {
    if (localCaptures?.has(read.name) || localCaptures?.has(read.binding.name)) continue;
    // The enclosing list-entry mapper shadows every same-named outer binding,
    // including `props`. Check the entry binding before the component-props
    // branch: a legal `items.map((props) => …)` read is entry-local, never a
    // component props read.
    if (state.entryNames.has(read.name) || state.entryNames.has(read.binding.name)) {
      continue;
    }
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
    if (state.localResources.has(read.name) || state.hostBindings.has(read.name)) {
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
    // A read of a STATIC MODULE IMPORT is a direct reference: the generated
    // module re-emits the import at the same graph position, so the value needs
    // no host binding and no shell channel. The resource checks below stay
    // first: a component-local declaration shadows the import.
    const imported = importContextOf(state.component)?.byLocal.get(read.name);
    if (imported !== undefined) {
      importContextOf(state.component)!.used.set(
        `${imported.specifier}#${imported.imported}#${imported.local}`,
        imported,
      );
      continue;
    }
    const resource = state.component.resources.find((candidate) => candidate.name === read.name);
    if (resource !== undefined && resource.kind === 'ref') {
      // `16b-REF`: the handle is a component-local compiler-owned value, so a
      // read of it is a closure capture (never a host binding). Reading it in a
      // TRACKED slot is a different question: `current` is not a reactive
      // source, so the frontend admits the handle only in a `ref` attribute
      // expression and the read never reaches a refresh subscription.
      state.localResources.add(read.name);
      continue;
    }
    if (resource !== undefined && resource.kind === 'context') {
      // `16b-CTX`: the consumer is a component-local compiler-owned Signal. A
      // read of the DECLARATION (the signal object) is a closure capture; a
      // tracked slot reads `.value` through the ordinary signal protocol, and
      // `dependencyNames` turns that into the lane's standard subscription.
      state.localResources.add(read.name);
      continue;
    }
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

export interface Dependency {
  readonly name: string;
  /** Props reads refresh through the host `propsChanged` signal (see contract). */
  readonly fromProps: boolean;
  /**
   * `16b-CTX`: a read of a component-local compiler-owned Signal (a `useContext`
   * consumer). It needs a real write subscription like any other dependency but
   * NO host-binding declaration — the retained setup factory already emitted the
   * `const`. Without this the consumer would be misreported as an unbound host
   * binding and the module would be refused.
   */
  readonly local: boolean;
}

export function dependencyNames(
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
    // A read bound by the enclosing mapper parameter is entry-local: the entry
    // `update(next)` re-binds the parameter, so it is not a host/props
    // subscription (B2: `props` as a mapper name must not become fromProps).
    if (state.entryNames.has(read.name) || state.entryNames.has(read.binding.name)) {
      continue;
    }
    const fromProps = read.name === 'props' || read.binding.name === 'props';
    // `16b-CTX`: a consumer is a component-local setup value, so it is neither a
    // props read nor a host binding. It still refreshes through the ordinary
    // `bindSignalWrites` subscription below — the signal protocol is the same
    // one every other dependency uses.
    const local = state.component.resources.some(
      (resource) => resource.kind === 'context' && resource.name === read.name,
    );
    if (local) {
      // Already a declared local (the setup factory emitted it); nothing to add.
    } else if (fromProps) {
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
      names.push({ name: read.name, fromProps, local });
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
export function emitDependencySubscriptions(
  state: EmitState,
  dependencies: readonly Dependency[],
  refreshVar: string,
  anchor: SpanLike,
  options?: {
    /**
     * Condition refreshes interpret their first argument as `force`. The signal
     * subscription callback receives the signal VALUE (`bindSignalWrites` calls
     * `fn(value)`), and the generated element root's `propsChanged` channel is a
     * monotonically increasing number: passing it through would make every
     * props write look like an explicit force and rebuild the branch even when
     * the condition test is unchanged. Subscribe through `() => refresh()` for
     * condition collectors; entry/list collectors keep their explicit
     * `refresh(true)` calls.
     */
    readonly ignoreSignalValue?: boolean;
  },
): void {
  const handler = options?.ignoreSignalValue === true ? `() => ${refreshVar}()` : refreshVar;
  // `16b-EB`: a module that registers an `onError` handler submits its refresh
  // closures through the executor's existing `guardUpdate` (the ONE
  // update-phase isolation contract: a throw is reported to the sink and never
  // rethrown, so the subscription stays live for the next write). The sink is
  // the shell's compiler-private reporter, read off the host record HERE, at
  // subscribe time, so a refresh registered before the handler still reaches it
  // (the reporter re-reads the live list at dispatch time).
  //
  // A module WITHOUT the intrinsic keeps the exact two-name call: `bindSignalWrites`
  // is handed the bare refresh, which is byte-identical to the pre-`16b-EB`
  // output and allocates no wrapper. The predicate reads the SAME module-wide
  // fact that forwards the sink through the host literals, so a new emission
  // site cannot forget the guard.
  const guarded = moduleUsesErrorBoundary(state)
    ? `guardUpdate(${handler}, ${state.hostVar}.${ERROR_REPORT_PROPERTY})`
    : handler;
  for (const dependency of dependencies) {
    if (dependency.fromProps) {
      push(
        state,
        `for (const ${MOUNT_DEP_LOOP} of ${state.hostVar}.propDeps) bindSignalWrites(${state.scopeVar}, ${MOUNT_DEP_LOOP}, ${JSON.stringify(dependency.name)}, ${guarded});`,
        anchor,
      );
      continue;
    }
    push(
      state,
      `bindSignalWrites(${state.scopeVar}, ${dependency.name}, ${JSON.stringify(dependency.name)}, ${guarded});`,
      anchor,
    );
  }
}

/** Validate one prop of a component reference; `key` is consumed before this. */
export function componentPropAdmitted(
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
  if (!COMPONENT_PROP_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
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
 * DEPTH-1 nested-retention plan (`16b-LC retained-child`, plan v3 §4.1).
 *
 * The generated ROOT mount/claim body is the ONE "root retaining body": it
 * brackets an instance pass and retains its DIRECT hostless child instances.
 * A non-root component becomes a "leaf instance body" when every reference to
 * it is a retention-eligible root-body site and its setup locals pass the
 * root-style gateway (no setup local reads a host `bindings` name or
 * `propsChanged`). Its body aliases the retained record and emits NO ledger
 * text; references inside it stay today's legacy text.
 *
 * Eligibility is a monotone fixpoint over every emitted reference:
 *
 * - a reference is retention-eligible only when it is emitted in the root
 *   body, outside a recipe/claim-time recipe body and outside a list entry;
 * - a target is demoted as soon as ANY reference to it is ineligible, and a
 *   demoted target's root-body sites then emit today's legacy text (no
 *   cascade to other targets: every non-root owner is ineligible by rule);
 * - a component with no emitted reference is never a leaf body, so a module
 *   that retains nothing keeps today's bytes.
 *
 * The plan is a pure analysis over the function model + expression registry;
 * it emits nothing and fails closed to `null` (today's bytes) on the two
 * whole-module guards: no root marker, or any reference targeting the module
 * root (B3b — conservative superset over every component/recipe path, no new
 * diagnostic).
 */
export interface RetentionPlan {
  /** The module-root component whose bodies are the root retaining body. */
  readonly rootName: string;
  /** Reference sites that emit `retainChildInstance` (mount == claim identity). */
  readonly retainedRefs: ReadonlySet<FunctionModelComponentRef>;
  /** Non-root components emitted as retained (leaf) instance bodies. */
  readonly leafBodies: ReadonlySet<string>;
  /** Leaf targets that also emit their module-scope `<Name>__setup` factory. */
  readonly setupBodies: ReadonlySet<string>;
  /**
   * Bodies that emit retain calls: the root plus every retained component that
   * itself retains children (depth >= 2). A body NOT in this set emits no
   * ledger text; a retained body in this set JOINS the root's transaction.
   */
  readonly retainingBodies: ReadonlySet<string>;
  /**
   * True when at least one retained child is itself a retaining body, so the
   * root body must capture `beginInstancePass`'s token and thread it through
   * the ref-site host literals. False keeps the depth-1 bytes exactly.
   */
  readonly transaction: boolean;
}

/**
 * The optional trailing origin argument: `, { file, line, column }` or empty
 * when the emitter has no authored anchor. Both values are compile-time
 * constants; the runtime never parses a source map. `line`/`column` are the
 * 1-based `SpanLike` values, used as-is.
 */
export function originArgs(anchor: SpanLike | undefined): string {
  if (anchor === undefined) return '';
  return `, { file: ${JSON.stringify(anchor.file)}, line: ${anchor.line}, column: ${anchor.column} }`;
}
