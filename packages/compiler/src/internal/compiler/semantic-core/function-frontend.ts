// Single-file cohesion is a deliberate trade against small-parts granularity (comply-or-explain, design-principles.md:16-19): the frontend is the one parallel entry joining the M03 slices (scope resolution, expression registry, type erasure) into a single component model with a shared OEC diagnostics dialect, which is what the Alpha15 parity harness compares field-for-field; the boundary is explicit — it emits no Part Program v2, no __partProgram, no module ABI and no generated module, and nothing here is serialized, package-exported or written to disk.
/**
 * M03-I-4 — production function-component frontend (Alpha16a, compiler-private).
 *
 * This is the **parallel entry** for the function-component authoring model: it
 * does not wrap, call or modify the Alpha15 class frontend (`compile.ts` →
 * `lower-program.ts` → `emit-program.ts` → `emit-module.ts`), emits **no Part
 * Program v2**, no `__partProgram`, no module ABI v2 and no generated module.
 * The class frontend stays the default production behaviour for Alpha16a and
 * the regression baseline until the Alpha16b retirement; there is no adapter
 * between the two frontends (approved P-5).
 *
 * The pipeline consumes the merged M03 slices:
 * - A1 `resolveModule` — lexical scopes, binding identity/value kinds, reads,
 *   captures, dependencies and the module-level diagnostic surface;
 * - A2 `createExpressionRegistry` — Route 3 marked-print lowering, recipe
 *   references, node-start anchors and expression source-map segments;
 * - A3 `type-erasure` (inside A2) — TypeScript-only syntax stripping.
 *
 * What this module produces is a compiler-private component model plus the
 * per-compilation `ExpressionRegistry` sidecar; M05/M06 consume the model for
 * codegen, M04 consumes captures/owners. Nothing here is serialized, exported
 * from the package entry, or written to disk.
 *
 * Diagnostics dialect: the frontend speaks the compiler's OEC dialect
 * (`CompilerDiagnostic`: code, message, file, line, character, start, end) so
 * the Alpha15 parity harness can compare it field-for-field with the class
 * frontend. Shared admission/security rules reuse the canonical predicates
 * instead of a second table: `forbiddenSinkReason` from
 * `@openelement/protocol/forbidden-sinks`, `isSafeAttributeName` from
 * `analyze-module.ts`, and `classifyIntrinsicAttribute` from
 * `attribute-classification.ts`.
 *
 * The five A1-A3 provisional `OEIR_*` codes stay compiler-private: this
 * frontend wraps any resolver/lowering refusal in `OEC9043` and keeps the
 * original code in the message for traceability. A4a is the diagnostics half
 * of the M03 exit evidence; source-map/security parity matrices and the M03
 * ledger flip are M03-I-4b.
 */

import ts from 'typescript';
import { forbiddenSinkReason } from '@openelement/protocol/forbidden-sinks';
import { VOID_TAGS } from '@openelement/protocol/void-tags';
import { classifyIntrinsicAttribute } from './attribute-classification.ts';
import { isSafeAttributeName } from './analyze-module.ts';
import { type CompilerDiagnostic, diagnosticAt } from './diagnostics/index.ts';
import {
  createExpressionRegistry,
  type ExprId,
  type ExpressionRegistry,
} from './expression-registry.ts';
import {
  resolveModule,
  type ComponentFunction,
  type EvaluationMode,
  type ImportClassifier,
  type ResolvedModule,
  type ScopeDiagnostic,
  type SourceSpan,
} from './scope-resolution.ts';
import { typescriptParser } from './parse-module.ts';

// ─── Diagnostics vocabulary (new codes, documented for review) ──────────────

/**
 * Function-frontend diagnostics. Codes `OEC9010`/`OEC9011`/`OEC9017` are the
 * EXISTING Alpha15 admission/security codes, reused verbatim by the shared
 * predicates so parity holds for equivalent authored constructs. The `OEC9040`
 * band is new to this slice and documented here; `OEC9043` carries a private
 * `OEIR_*` refusal in its message until A4 promotes the vocabulary.
 */
const CODES = {
  /** No component found / component shape outside the admitted model. */
  shape: 'OEC9040',
  /** A statement outside the admitted component body grammar. */
  statement: 'OEC9041',
  /** A declaration or JSX form outside the admitted component grammar. */
  form: 'OEC9042',
  /** A read/expression refused by A1/A2/A3 (original code kept in message). */
  expression: 'OEC9043',
  /** A security sink the function model refuses on its own. */
  security: 'OEC9044',
} as const;

/**
 * The module specifiers the compiler-erased intrinsics may be imported from
 * (A16-LANE-M, M10-P1/P4; `16b-REF` adds `ref` to the same table).
 *
 * Both spellings name the SAME functions: `@openelement/element/lifecycle` is a
 * side-effect-free subpath that re-exports the identical fail-closed stand-ins,
 * and exists only so an author module's import survives tree shaking — the root
 * entry is flagged in `sideEffects` (it carries the hydration and Block install
 * edges), so importing an intrinsic the compiler will ERASE from the root
 * dragged the generic executor into the client graph for a binding the emitted
 * module never references.
 *
 * Admission is otherwise IDENTICAL for both spellings: the same import form,
 * the same imported names, the same placement/arity/shape rules. A subpath
 * other than this one stays a foreign module (unchanged fall-through to the
 * pre-existing component-body grammar), and an unrelated name imported from
 * `/lifecycle` is not an intrinsic.
 */
const LIFECYCLE_INTRINSIC_SPECIFIERS: ReadonlySet<string> = new Set([
  '@openelement/element',
  '@openelement/element/lifecycle',
]);

/** True when `specifier` is a canonical lifecycle-intrinsic module. */
function isLifecycleIntrinsicSpecifier(specifier: string): boolean {
  return LIFECYCLE_INTRINSIC_SPECIFIERS.has(specifier);
}

// ─── Component model (compiler-private; M05/M06 consumers) ─────────────────

/** One lowered expression reference: registry id + evaluation mode. */
export interface FunctionExpressionRef {
  readonly id: ExprId;
  readonly mode: EvaluationMode;
  readonly span: SourceSpan;
}

export interface FunctionModelStaticAttribute {
  readonly kind: 'static';
  readonly name: string;
  readonly value: string;
  readonly span: SourceSpan;
}

export interface FunctionModelDynamicAttribute {
  readonly kind: 'dynamic';
  readonly name: string;
  readonly channel: ReturnType<typeof classifyIntrinsicAttribute>;
  readonly expression: FunctionExpressionRef;
  readonly span: SourceSpan;
}

export type FunctionModelAttribute = FunctionModelStaticAttribute | FunctionModelDynamicAttribute;

export interface FunctionModelElement {
  readonly kind: 'element';
  readonly tag: string;
  readonly attributes: readonly FunctionModelAttribute[];
  readonly children: readonly FunctionModelNode[];
  readonly span: SourceSpan;
}

export interface FunctionModelFragment {
  readonly kind: 'fragment';
  readonly children: readonly FunctionModelNode[];
  readonly span: SourceSpan;
}

export interface FunctionModelText {
  readonly kind: 'text';
  readonly value: string;
  readonly span: SourceSpan;
}

export interface FunctionModelDynamicText {
  readonly kind: 'dynamic-text';
  readonly expression: FunctionExpressionRef;
  readonly span: SourceSpan;
}

export interface FunctionModelComponentRef {
  readonly kind: 'component-ref';
  readonly name: string;
  readonly props: readonly FunctionModelAttribute[];
  /**
   * The children recipe this reference passes as `props.children` (M06b2a,
   * JSX value model §4.4): non-null only for `<Frame>…</Frame>`, where the
   * children node list is the fragment recipe with this id. A recipe id, never
   * a data prop: `props.children` is a recipe channel the child projects, not a
   * value the authored expression may read.
   */
  readonly childrenRecipeId: string | null;
  readonly span: SourceSpan;
}

export interface FunctionModelCondition {
  readonly kind: 'condition';
  readonly test: FunctionExpressionRef;
  readonly consequent: readonly FunctionModelNode[];
  readonly alternate: readonly FunctionModelNode[] | null;
  readonly span: SourceSpan;
}

export interface FunctionModelList {
  readonly kind: 'list';
  /** Authored mapper parameter name (`items.map((item) => …)`). */
  readonly parameter: string;
  readonly items: FunctionExpressionRef;
  readonly key: FunctionExpressionRef | null;
  readonly template: readonly FunctionModelNode[];
  readonly span: SourceSpan;
}

export interface FunctionModelInsertionSite {
  readonly kind: 'insertion-site';
  readonly recipeId: string;
  readonly span: SourceSpan;
}

export interface FunctionModelChildrenProjection {
  readonly kind: 'children-projection';
  readonly span: SourceSpan;
}

export type FunctionModelNode =
  | FunctionModelElement
  | FunctionModelFragment
  | FunctionModelText
  | FunctionModelDynamicText
  | FunctionModelComponentRef
  | FunctionModelCondition
  | FunctionModelList
  | FunctionModelInsertionSite
  | FunctionModelChildrenProjection;

/** A value-position JSX node lowered to a reusable recipe (M02 §recipe). */
export interface FunctionModelRecipe {
  readonly id: string;
  /**
   * What one insertion mounts: a JSX value (element or component reference) or,
   * for a children recipe (M06b2a), the fragment wrapping a component
   * reference's JSX children (`<Frame>…</Frame>` passes this as
   * `props.children`).
   */
  readonly target: FunctionModelElement | FunctionModelComponentRef | FunctionModelFragment;
  readonly span: SourceSpan;
}

/** One component-scope value declaration. */
export interface FunctionModelResource {
  readonly name: string;
  /**
   * `ref` is a `16b-REF` NODE HANDLE, not a readable value: it is a
   * compiler-owned object whose `current` field the emitted `ref` channel
   * writes on attach and clears on detach. Its `expression` carries the
   * OPTIONAL authored notification callback (the same
   * `(element | null) => void | cleanup` contract the plain `ref` channel
   * already has), lowered in `handler` mode; `null` means "handle only, no
   * notification". A `ref` handle differs from `local` in that its initializer
   * is not evaluated once as a snapshot — the compiler emits the handle itself.
   *
   * `context` is a `16b-CTX` CONSUMER (`const value = useContext(token)`): the
   * name is bound to ONE persistent consumer-local Signal the compiler builds in
   * the retained setup factory, so a tracked slot reading `.value` is a real
   * reactive dependency (unlike `ref`) and a reconnect re-reads the nearest
   * provider into the same object. `expression` carries the lowered TOKEN.
   */
  readonly kind: 'signal' | 'computed' | 'local' | 'ref' | 'context' | 'host';
  /** Lowered initializer/derivation; absent when the declared form has none. */
  readonly expression: FunctionExpressionRef | null;
  /**
   * The reusable JSX value this declaration created (M06b1a-2): non-null only
   * for an identifier bound to a direct JSX initializer, where `expression` is
   * null. The generator emits one recipe per declaration and every `{name}`
   * slot refers to it by this id; it never re-derives the link from spans.
   */
  readonly recipeId: string | null;
  readonly span: SourceSpan;
}

/**
 * One admitted lifecycle intrinsic statement of the generated element ROOT
 * setup (`16b-LC`, option 1a): a direct top-level `onConnect(cb)` or
 * `onDispose(cb)` call whose callee is a canonical named import of
 * '@openelement/element' (aliases followed). The callback is lowered exactly
 * like any other authored expression (type-erased, JSX-free), so the generator
 * emits it as an ordinary closure inside the compiler-owned
 * `__oe_rootInstance` factory; the intrinsic call itself is erased.
 *
 * The model carries no runtime hook identity: there is no dispatcher, no
 * hook-order slot and no callback-context record. `receivesEnv` is a plain
 * static fact about the authored callback: `true` when it declares the one
 * admitted `env` parameter, `false` when it keeps the zero-argument form. The
 * generator uses it only to decide whether the replay passes the env argument
 * (zero-argument callbacks and their emitted bytes stay exactly as they were).
 * Nested/hostless component hooks are admitted module-wide; their placement
 * verdict stays with the generator (authored-span refusal).
 */
export interface FunctionModelLifecycleHook {
  readonly kind: 'connect' | 'dispose' | 'property-change' | 'error';
  readonly callback: FunctionExpressionRef;
  /** `true` when the authored callback declares the one admitted env parameter. */
  readonly receivesEnv: boolean;
  readonly span: SourceSpan;
}

/**
 * One admitted `16b-CTX` PROVIDER statement of a generated component setup.
 *
 * `provideContext(token, () => value)` is erased into the retained setup
 * factory, which registers it on the component's owner scope. The value is a
 * THUNK by contract: the emitted closure is re-read on connect and after every
 * declared-property commit, so "provider changed" is this lane's existing change
 * channel and no second reactivity model is introduced (the lane deliberately
 * has no author `computed`).
 */
export interface FunctionModelContextProvider {
  /** The lowered context token expression (usually a static module import). */
  readonly token: FunctionExpressionRef;
  /** The lowered value thunk — an inline arrow/function expression. */
  readonly value: FunctionExpressionRef;
  readonly span: SourceSpan;
}

/** One function component of the module. */
export interface FunctionModelComponent {
  readonly name: string;
  /** Authored props parameter name; `null` for a destructured props parameter. */
  readonly propsParam: string | null;
  readonly resources: readonly FunctionModelResource[];
  readonly recipes: readonly FunctionModelRecipe[];
  readonly roots: readonly FunctionModelNode[];
  /**
   * The admitted root lifecycle intrinsic statements, in authored order
   * (`16b-LC`). Empty for every other component and for a hook-free root; the
   * generator is the only consumer.
   */
  readonly lifecycle: readonly FunctionModelLifecycleHook[];
  /**
   * The admitted `16b-CTX` provider statements, in authored order. Empty for a
   * component that provides nothing; the generator is the only consumer.
   */
  readonly contextProviders: readonly FunctionModelContextProvider[];
  readonly span: SourceSpan;
}

/** The lowered module: components plus the per-compilation expression sidecar. */
/**
 * One static import of the authored module, as the generated lane may keep it.
 *
 * The generated module replaces the authored one at the same graph position, so
 * a used import is re-emitted verbatim (`specifier` + the local spelling) and a
 * read of it stays a direct module reference instead of becoming a host
 * binding. The sidecar helper and the erased intrinsics are never READ in a
 * component body, so they are never re-emitted.
 */
export interface FunctionModelImport {
  readonly specifier: string;
  readonly imported: string;
  readonly local: string;
  readonly form: 'named' | 'default' | 'namespace';
}

export interface FunctionModelModule {
  readonly file: string;
  readonly components: readonly FunctionModelComponent[];
  /** A2 sidecar: lowered text, captures/dependencies, anchors, segments. */
  readonly expressions: ExpressionRegistry;
  /**
   * The module's static (non-type-only) imports. Optional so a hand-built model
   * in a fixture keeps its exact meaning; the generated lane treats an absent
   * list as "no import channel".
   */
  readonly imports?: readonly FunctionModelImport[];
}

/**
 * `16b-LC` compiler-private lifecycle admission (never author syntax).
 *
 * - `root`: only the named component's direct top-level intrinsics are admitted
 *   (the pre-nested slice behavior);
 * - `module`: every component's direct top-level intrinsics are admitted. ONLY
 *   the generated-element lane selects this mode, and the GENERATOR owns
 *   placement: a hook is carried only by the generated element root setup or a
 *   depth-1 retained hostless child setup; every other placement fails closed
 *   with the authored span. No dispatcher, hook slot or lifecycle context is
 *   introduced.
 *
 * Omitted (function pages, leaf tests, the facts projection) keeps the existing
 * statement grammar exactly: a hook call stays the "statement outside the
 * admitted component grammar" refusal (`OEC9041`).
 */
export type FunctionLifecycleAdmission =
  | { readonly admission: 'root'; readonly root: string }
  | { readonly admission: 'module' };

export interface FunctionFrontendOptions {
  /** Host classifier for imported symbols (A1 §6); omitted = nothing known. */
  readonly importClassifier?: ImportClassifier;
  /** Compiler-private lifecycle admission; see {@linkcode FunctionLifecycleAdmission}. */
  readonly lifecycleAdmission?: FunctionLifecycleAdmission;
}

export interface FunctionFrontendResult {
  /** Non-null only when `diagnostics` is empty (fail closed). */
  readonly module: FunctionModelModule | null;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function spanOf(sourceFile: ts.SourceFile, node: ts.Node): SourceSpan {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    file: sourceFile.fileName,
    start,
    end,
    line: position.line + 1,
    column: position.character + 1,
  };
}

function fromRefusal(sourceFile: ts.SourceFile, diagnostic: ScopeDiagnostic): CompilerDiagnostic {
  return {
    code: CODES.expression,
    message: `[${diagnostic.code}] ${diagnostic.message}`,
    file: diagnostic.span.file,
    line: diagnostic.span.line,
    character: diagnostic.span.column,
    start: diagnostic.span.start,
    end: diagnostic.span.end,
  };
}

/** Unwrap the transparent wrappers the admitted grammar allows around JSX. */
function unwrap(node: ts.Node): ts.Node {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function isJsxLike(node: ts.Node): boolean {
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node) ||
    ts.isConditionalExpression(node) ||
    (ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
  );
}

function isComponentTag(tag: string): boolean {
  return /^[A-Z]/.test(tag);
}

/**
 * A void element has no content model. Whitespace-only JSX text and an empty
 * JSX expression slot are formatting and emit no child; any real child is a
 * source diagnostic rather than a child the mount appends and the SSR producer
 * silently drops.
 */
function hasMeaningfulVoidChild(child: ts.JsxChild): boolean {
  if (ts.isJsxText(child)) return child.text.trim() !== '';
  if (ts.isJsxExpression(child)) return child.expression !== undefined;
  return true;
}

/** A discovered component candidate: the function node plus its authored name. */
interface ComponentCandidate {
  readonly name: string;
  readonly node: ComponentFunction;
}

function discoverComponents(sourceFile: ts.SourceFile): ComponentCandidate[] {
  const candidates: ComponentCandidate[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body !== undefined && statement.name) {
      candidates.push({ name: statement.name.text, node: statement });
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const initializer = declaration.initializer;
      if (
        initializer !== undefined &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        candidates.push({ name: declaration.name.text, node: initializer });
      }
    }
  }
  return candidates;
}

/**
 * A function is a component when its body returns JSX-like output. Helpers that
 * never return JSX are module-local functions, not components.
 */
function isComponentShape(candidate: ComponentCandidate): boolean {
  const body = candidate.node.body;
  if (body === undefined) return false;
  if (!ts.isBlock(body)) return isJsxLike(unwrap(body));
  const returns = body.statements.filter(ts.isReturnStatement);
  return (
    returns.length === 1 &&
    returns[0]!.expression !== undefined &&
    isJsxLike(unwrap(returns[0]!.expression!))
  );
}

// ─── Builder ───────────────────────────────────────────────────────────────

class FunctionFrontendBuilder {
  private readonly sourceFile: ts.SourceFile;
  private readonly resolved: ResolvedModule;
  private readonly registry: ExpressionRegistry;
  /** `16b-LC`: the compiler-private lifecycle admission mode for this module. */
  private readonly lifecycleAdmission: FunctionLifecycleAdmission | undefined;
  private readonly diagnostics: CompilerDiagnostic[] = [];
  private readonly recipeIds = new Map<ts.Node, string>();
  /**
   * Component-scope identifier → recipe id for a direct JSX initializer
   * (M06b1a-2): the one place a `{name}` slot is known to be an insertion site
   * rather than a dynamic text read. Reset per component so a name can never
   * leak a recipe across components.
   */
  private localRecipeNames = new Map<string, string>();
  /** List-mapper parameters enclosing the slot being built (shadowing guard). */
  private readonly entryParameters: string[] = [];
  private recipeCounter = 0;
  private childrenRecipeCounter = 0;

  constructor(
    sourceFile: ts.SourceFile,
    resolved: ResolvedModule,
    lifecycleAdmission: FunctionLifecycleAdmission | undefined,
  ) {
    this.sourceFile = sourceFile;
    this.resolved = resolved;
    this.lifecycleAdmission = lifecycleAdmission;
    this.registry = createExpressionRegistry({
      module: resolved,
      recipeReference: (jsx) => this.recipeReference(jsx),
    });
  }

  // ── diagnostics ────────────────────────────────────────────────────────

  private fail(node: ts.Node, code: string, message: string): void {
    this.diagnostics.push(diagnosticAt(this.sourceFile, node, code, message));
  }

  private hasErrors(): boolean {
    return this.diagnostics.length > 0;
  }

  // ── recipe identity ────────────────────────────────────────────────────

  private recipeReference(jsx: ts.Node): { callee: string; id: string } | undefined {
    const id = this.ensureRecipeId(jsx);
    return id === undefined ? undefined : { callee: RECIPE_REFERENCE_CALLEE, id };
  }

  private ensureRecipeId(jsx: ts.Node): string | undefined {
    const existing = this.recipeIds.get(jsx);
    if (existing !== undefined) return existing;
    const target = unwrap(jsx);
    if (!ts.isJsxElement(target) && !ts.isJsxSelfClosingElement(target)) {
      this.fail(
        jsx,
        CODES.form,
        'a JSX value in an expression must be an element or component reference',
      );
      return undefined;
    }
    const id = `#recipe${this.recipeCounter}`;
    this.recipeCounter += 1;
    this.recipeIds.set(jsx, id);
    this.pendingRecipes.push({ id, jsx: target });
    return id;
  }

  /** Recipes created while lowering expressions; drained by the component walk. */
  readonly pendingRecipes: Array<
    | { readonly id: string; readonly jsx: ts.JsxElement | ts.JsxSelfClosingElement }
    | { readonly id: string; readonly fragment: FunctionModelFragment }
  > = [];

  /**
   * `16b-REF` — the current component's declared ref-handle names.
   *
   * A handle's `current` field is written on attach and cleared on detach; it
   * notifies nothing. A TRACKED slot reading it would therefore be a one-shot
   * snapshot (the exact "silently SSR-only surface" defect the generated lane
   * exists to remove), so a handle may only be READ from a `handler`-mode
   * expression — a `ref` attribute or an authored callback body. This set is
   * the source of that refusal; it is rebuilt per component, like
   * `localRecipeNames`.
   */
  private refHandleNames = new Set<string>();

  /** Register one component-reference children fragment as a recipe (M06b2a). */
  private registerChildrenRecipe(fragment: FunctionModelFragment): string {
    const id = `#children${this.childrenRecipeCounter}`;
    this.childrenRecipeCounter += 1;
    this.pendingRecipes.push({ id, fragment });
    return id;
  }

  // ── expressions ────────────────────────────────────────────────────────

  private expression(node: ts.Node, mode: EvaluationMode): FunctionExpressionRef | null {
    // `props.children` is a recipe projection channel (JSX value model §4.4), not
    // a readable value: only the direct child slot `{props.children}` is
    // admitted (buildSlot -> children-projection). Any expression that reads it
    // stays refused — `String(props.children)`, `title={props.children}` and a
    // `props.children && …` test would otherwise pass the opaque recipe object
    // to a value consumer. JSX subtrees are skipped: they are replaced by recipe
    // references, and their own child slots are built by the node walk.
    if (this.containsPropsChildrenRead(node)) {
      this.fail(
        node,
        CODES.form,
        'props.children is a recipe projection channel: it may only appear as a direct JSX child slot `{props.children}`, never inside an expression value',
      );
      return null;
    }
    // `16b-REF`: `ref(...)` is a DECLARATION form, not a value. An invocation in
    // any other position (`ref={ref(cb)}`, `useThing(ref(cb))`, a return value)
    // would survive into the emitted module as a call to the fail-closed
    // stand-in and then throw at MOUNT — a build defect surfacing as a runtime
    // one. Refuse it at the authored span instead; the legal spelling is
    // `const handle = ref(cb?)` then `ref={handle}`.
    const misplacedRef = this.misplacedRefCall(node);
    if (misplacedRef !== null) {
      this.fail(
        misplacedRef,
        CODES.form,
        'ref(...) is a COMPILED DECLARATION, not a value: write `const handle = ref(cb?)` and ' +
          'pass `<node ref={handle} />`. A ref(...) call in any other position would erase to ' +
          'nothing and throw outside the compiler pipeline',
      );
      return null;
    }
    // `16b-REF`: a ref handle is an ATTACH/DETACH-ONLY value. Its `current` field
    // is written when the node attaches and cleared when it detaches, and it
    // notifies nothing, so reading it in a value position outside a
    // `handler`-mode expression (a `ref` attribute or an authored callback body)
    // would emit a snapshot that never refreshes — the silently-stale surface
    // class this lane exists to remove. Fail closed at the read, with the
    // authored span, instead of compiling a one-shot write.
    if (mode !== 'handler') {
      const handle = this.refHandleReadIn(node);
      if (handle !== null) {
        this.fail(
          node,
          CODES.form,
          `the ref handle '${handle}' is an attach/detach-only value: 'current' is written when ` +
            'the node attaches and cleared when it detaches, and it notifies nothing. Read it ' +
            'inside a ref attribute `ref={(el) => …}` or a callback body (ref(...) notification, ' +
            'onConnect/onDispose/onPropertyChange/onError, event handler), not in a tracked slot',
        );
        return null;
      }
    }
    const { record, diagnostics } = this.registry.lower(node, mode);
    if (record === null) {
      for (const diagnostic of diagnostics) {
        this.diagnostics.push(fromRefusal(this.sourceFile, diagnostic));
      }
      return null;
    }
    return { id: record.id, mode, span: record.authoredSpan };
  }

  /**
   * `16b-REF` — the first `ref(...)` CALL in this expression that is not the
   * initializer of a ref-handle declaration, or `null`.
   *
   * `buildDeclaration` consumes the declaration's own call before any general
   * lowering, so a call reaching {@linkcode expression} is by definition in a
   * value position. Matching is binding provenance (a namespace member or a
   * different module's `ref` is not the intrinsic), and JSX subtrees are
   * skipped: their attribute positions are lowered by the node walk, whose own
   * `ref` attribute handling is the SUPPORTED way to hand a handle to a node.
   */
  private misplacedRefCall(node: ts.Node): ts.Node | null {
    let found: ts.Node | null = null;
    const visit = (current: ts.Node): void => {
      if (found !== null) return;
      if (
        ts.isJsxElement(current) ||
        ts.isJsxSelfClosingElement(current) ||
        ts.isJsxFragment(current)
      ) {
        return;
      }
      if (ts.isCallExpression(current) && this.refIntrinsicImport(current) !== null) {
        found = current;
        return;
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
    return found;
  }

  /**
   * `16b-REF` — the first ref-handle name this expression reads, or `null`.
   *
   * Reads are matched by RESOLVED BINDING, not by spelling: a handle name is in
   * {@linkcode refHandleNames} only for this component, and a local shadow in a
   * nested scope resolves to a different binding. JSX subtrees are skipped for
   * the same reason as {@linkcode containsPropsChildrenRead}: they become
   * recipes, and their own attribute positions are classified separately.
   */
  private refHandleReadIn(node: ts.Node): string | null {
    if (this.refHandleNames.size === 0) return null;
    let found: string | null = null;
    const visit = (current: ts.Node): void => {
      if (found !== null) return;
      if (
        ts.isJsxElement(current) ||
        ts.isJsxSelfClosingElement(current) ||
        ts.isJsxFragment(current)
      ) {
        return;
      }
      if (ts.isIdentifier(current) && this.refHandleNames.has(current.text)) {
        const binding = this.resolved.resolveIdentifier(current);
        if (binding !== undefined && binding.origin.form === 'local') {
          found = current.text;
          return;
        }
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
    return found;
  }

  /**
   * Does this expression read `props.children` outside any replaced JSX subtree?
   * JSX nodes are skipped because the expression lowering replaces them with a
   * recipe reference; their child slots belong to the later node walk.
   */
  private containsPropsChildrenRead(node: ts.Node): boolean {
    const propsParam = this.currentPropsParam;
    if (propsParam === null) return false;
    let found = false;
    const visit = (current: ts.Node): void => {
      if (found) return;
      if (
        ts.isJsxElement(current) ||
        ts.isJsxSelfClosingElement(current) ||
        ts.isJsxFragment(current)
      ) {
        return;
      }
      if (
        ts.isPropertyAccessExpression(current) &&
        ts.isIdentifier(current.expression) &&
        current.expression.text === propsParam &&
        current.name.text === 'children'
      ) {
        found = true;
        return;
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
    return found;
  }

  // ── component / body ───────────────────────────────────────────────────

  buildComponent(candidate: ComponentCandidate): FunctionModelComponent | null {
    this.localRecipeNames = new Map();
    this.refHandleNames = new Set();
    const node = candidate.node;
    const parameters = node.parameters;
    if (parameters.length > 1) {
      this.fail(node, CODES.shape, 'a function component takes at most one props parameter');
      return null;
    }
    let propsParam: string | null = null;
    const parameter = parameters[0];
    if (parameter !== undefined) {
      if (ts.isIdentifier(parameter.name)) {
        propsParam = parameter.name.text;
      } else if (!ts.isObjectBindingPattern(parameter.name)) {
        this.fail(
          parameter,
          CODES.shape,
          'the props parameter must be an identifier or an object pattern',
        );
        return null;
      }
    }

    const resources: FunctionModelResource[] = [];
    const lifecycle: FunctionModelLifecycleHook[] = [];
    const contextProviders: FunctionModelContextProvider[] = [];
    const body = node.body;
    if (body === undefined) {
      this.fail(node, CODES.shape, 'a function component must have a body');
      return null;
    }
    let returnExpression: ts.Expression | null = null;
    if (ts.isBlock(body)) {
      for (const statement of body.statements) {
        if (ts.isExpressionStatement(statement)) {
          // `16b-LC` option 1a: a direct top-level lifecycle intrinsic in the
          // admitted generated-element ROOT setup. Not a model node and not a
          // resource: it is erased into the compiler-owned instance factory.
          const lifecycleHook = this.buildLifecycleHook(statement, candidate.name);
          if (lifecycleHook === 'refused') continue;
          if (lifecycleHook !== null) {
            lifecycle.push(lifecycleHook);
            continue;
          }
          // `16b-CTX`: a direct top-level `provideContext(token, () => value)`.
          // Also a compiler-erased intrinsic with no model node of its own: the
          // generator emits the registration inside the retained setup factory.
          const contextProvider = this.buildContextProvider(statement, candidate.name);
          if (contextProvider === 'refused') continue;
          if (contextProvider !== null) {
            contextProviders.push(contextProvider);
            continue;
          }
        }
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            const resource = this.buildDeclaration(declaration);
            if (resource !== null) resources.push(resource);
          }
          continue;
        }
        if (ts.isReturnStatement(statement)) {
          if (returnExpression !== null) {
            this.fail(statement, CODES.statement, 'a component has exactly one return');
            return null;
          }
          if (statement.expression === undefined) {
            this.fail(statement, CODES.statement, 'the return must produce JSX');
            return null;
          }
          returnExpression = statement.expression;
          continue;
        }
        this.fail(
          statement,
          CODES.statement,
          `statement '${ts.SyntaxKind[statement.kind]}' is outside the admitted component grammar`,
        );
      }
    } else {
      returnExpression = body;
    }
    if (returnExpression === null) {
      this.fail(node, CODES.shape, 'a component needs one JSX return');
      return null;
    }

    const roots = this.buildBranch(returnExpression);
    const recipes: FunctionModelRecipe[] = [];
    while (this.pendingRecipes.length > 0) {
      const entry = this.pendingRecipes.shift()!;
      if ('fragment' in entry) {
        recipes.push({ id: entry.id, target: entry.fragment, span: entry.fragment.span });
        continue;
      }
      const target = this.buildNode(entry.jsx) as
        | FunctionModelElement
        | FunctionModelComponentRef
        | null;
      if (target === null || (target.kind !== 'element' && target.kind !== 'component-ref')) {
        this.fail(
          entry.jsx,
          CODES.form,
          'a recipe target must be an element or a component reference',
        );
        continue;
      }
      recipes.push({ id: entry.id, target, span: spanOf(this.sourceFile, entry.jsx) });
    }
    if (this.hasErrors()) return null;
    return {
      name: candidate.name,
      propsParam,
      resources,
      recipes,
      roots,
      lifecycle,
      contextProviders,
      span: spanOf(this.sourceFile, node),
    };
  }

  /**
   * `16b-LC` option 1a — admit one direct top-level lifecycle intrinsic
   * statement of the generated element ROOT setup.
   *
   * Recognition is binding provenance, exactly like the `element`/`property`
   * decorator intrinsics: the callee must be a value-position identifier whose
   * resolved binding is a named import of '@openelement/element' or
   * '@openelement/element/lifecycle' (aliases followed) whose imported name is
   * `onConnect`/`onDispose`/`onPropertyChange`. The two specifiers name the
   * same intrinsics — the subpath is the tree-shakeable spelling and admits
   * under exactly the same rules. A local shadow, a namespace member, a third
   * subpath or a foreign module's same-named function is NOT an intrinsic and
   * falls through to the pre-existing component-body grammar (its
   * `ExpressionStatement` refusal is the unchanged diagnostic).
   *
   * The callback is lowered as an ordinary authored expression in `handler`
   * mode (no tracked dependencies; type-erased). Its reads are classified by
   * the generator exactly like any other expression: setup locals become
   * closure captures, `props` is the live frozen props record, builtin globals
   * stay direct, and anything else keeps the leaf's existing fail-closed
   * binding gate. The generator emits the lowered text inside the
   * compiler-owned `__oe_rootInstance` factory; this call node itself never
   * reaches generated code.
   *
   * Slice boundary (no new diagnostic codes): placement/root/arity/shape
   * problems inside the admitted root use the existing function-frontend
   * `OEC9042` form code; a hook in any other component keeps the existing
   * `OEC9041` statement refusal because this method returns null there. The
   * callback admits exactly zero parameters (the pre-existing zero-argument
   * form) or ONE `env` parameter — an identifier or an object binding pattern,
   * no rest/optional/default form. The parameter is typed by the public
   * `onConnect`/`onDispose` signature and erased from the emitted module; the
   * generator passes the env argument only for the one-parameter form, so a
   * zero-argument callback keeps its exact bytes.
   */
  /**
   * The compiler-private admission check. Placement (root vs depth-1 retained
   * hostless child vs everywhere else) is NOT decided here: the generator owns
   * that verdict and fails closed with the authored span, because only the
   * emitted reference graph can tell whether a component is a retained body.
   */
  private admitsLifecycle(componentName: string): boolean {
    const admission = this.lifecycleAdmission;
    if (admission === undefined) return false;
    return admission.admission === 'module' || admission.root === componentName;
  }

  private buildLifecycleHook(
    statement: ts.ExpressionStatement,
    componentName: string,
  ): FunctionModelLifecycleHook | 'refused' | null {
    if (!this.admitsLifecycle(componentName)) return null;
    const expression = statement.expression;
    if (!ts.isCallExpression(expression)) return null;
    const callee = unwrap(expression.expression);
    if (!ts.isIdentifier(callee)) return null;
    const binding = this.resolved.resolveIdentifier(callee);
    if (binding === undefined || binding.origin.form !== 'import') return null;
    if (!isLifecycleIntrinsicSpecifier(binding.origin.specifier)) return null;
    const importedName = binding.origin.importedName;
    if (
      importedName !== 'onConnect' &&
      importedName !== 'onDispose' &&
      importedName !== 'onPropertyChange' &&
      importedName !== 'onError'
    ) {
      return null;
    }
    const writtenName = importedName;
    if (expression.typeArguments !== undefined || expression.arguments.length !== 1) {
      this.fail(
        statement,
        CODES.form,
        `${writtenName}(...) takes exactly one inline function-expression callback`,
      );
      return 'refused';
    }
    const callback = unwrap(expression.arguments[0]!);
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
      this.fail(
        statement,
        CODES.form,
        `${writtenName}(...) needs an inline arrow/function-expression callback; an indirect ` +
          'function reference is outside the admitted lifecycle slice',
      );
      return 'refused';
    }
    if (callback.asteriskToken !== undefined) {
      this.fail(statement, CODES.form, `${writtenName}(...) cannot take a generator callback`);
      return 'refused';
    }
    const modifiers = ts.canHaveModifiers(callback) ? ts.getModifiers(callback) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true) {
      this.fail(
        statement,
        CODES.form,
        `the ${writtenName} callback must be synchronous; async callbacks (and async cleanups) ` +
          'are outside the lifecycle slice',
      );
      return 'refused';
    }
    if (callback.parameters.length > 1) {
      this.fail(
        statement,
        CODES.form,
        `the ${writtenName} callback takes at most one 'env' parameter (drop the extra one)`,
      );
      return 'refused';
    }
    const parameter = callback.parameters[0];
    if (parameter !== undefined) {
      if (
        parameter.dotDotDotToken !== undefined ||
        parameter.questionToken !== undefined ||
        parameter.initializer !== undefined
      ) {
        this.fail(
          statement,
          CODES.form,
          `the ${writtenName} 'env' parameter is a plain identifier or object binding pattern; ` +
            'rest, optional and default forms are outside the lifecycle slice',
        );
        return 'refused';
      }
      if (!ts.isIdentifier(parameter.name) && !ts.isObjectBindingPattern(parameter.name)) {
        this.fail(
          statement,
          CODES.form,
          `the ${writtenName} 'env' parameter must be an identifier or an object binding pattern`,
        );
        return 'refused';
      }
    }
    const lowered = this.expression(callback, 'handler');
    if (lowered === null) return 'refused';
    return {
      kind:
        importedName === 'onConnect'
          ? 'connect'
          : importedName === 'onDispose'
            ? 'dispose'
            : importedName === 'onError'
              ? 'error'
              : 'property-change',
      callback: lowered,
      receivesEnv: parameter !== undefined,
      span: spanOf(this.sourceFile, statement),
    };
  }

  /**
   * `16b-CTX` — the imported name when `call` invokes a canonical context
   * intrinsic (a named import of `@openelement/element` or
   * `@openelement/element/lifecycle`), or `null` for anything else.
   *
   * Recognition is BINDING PROVENANCE only: a local shadow, a namespace member
   * and a foreign module's same-named function are NOT the intrinsic and keep
   * every pre-existing refusal.
   */
  private contextIntrinsicImport(call: ts.CallExpression): 'provideContext' | 'useContext' | null {
    const callee = unwrap(call.expression);
    if (!ts.isIdentifier(callee)) return null;
    const binding = this.resolved.resolveIdentifier(callee);
    if (binding === undefined || binding.origin.form !== 'import') return null;
    if (!isLifecycleIntrinsicSpecifier(binding.origin.specifier)) return null;
    const importedName = binding.origin.importedName;
    if (importedName === 'provideContext') return 'provideContext';
    if (importedName === 'useContext') return 'useContext';
    return null;
  }

  /**
   * `16b-CTX` — admit one direct top-level `provideContext(token, () => value)`
   * statement of a generated component setup.
   *
   * The call shape is deliberately as narrow as the other intrinsics: exactly two
   * arguments, no type arguments, the token lowered in `setup` mode (it is read
   * once, and in practice is a static module import), and the value as an INLINE
   * synchronous arrow/function expression taking no parameters — the THUNK whose
   * re-read is the lane's provider-change event. Refusals use the existing
   * `OEC9042` form code; no new diagnostic identity is introduced.
   *
   * Placement is the generator's verdict, like the lifecycle intrinsics: the
   * frontend admits module-wide and the emitter decides whether the component is
   * a retained setup body. Returns `null` when the statement is not this
   * intrinsic at all, so the pre-existing component-body grammar keeps its
   * refusal for a non-intrinsic statement.
   */
  private buildContextProvider(
    statement: ts.ExpressionStatement,
    componentName: string,
  ): FunctionModelContextProvider | 'refused' | null {
    if (!this.admitsLifecycle(componentName)) return null;
    const expression = statement.expression;
    if (!ts.isCallExpression(expression)) return null;
    if (this.contextIntrinsicImport(expression) !== 'provideContext') return null;
    const writtenName = 'provideContext';
    if (expression.typeArguments !== undefined || expression.arguments.length !== 2) {
      this.fail(
        statement,
        CODES.form,
        `${writtenName}(token, () => value) takes exactly a context token and one inline value thunk`,
      );
      return 'refused';
    }
    const token = this.expression(unwrap(expression.arguments[0]!), 'setup');
    if (token === null) return 'refused';
    const thunk = unwrap(expression.arguments[1]!);
    if (!ts.isArrowFunction(thunk) && !ts.isFunctionExpression(thunk)) {
      this.fail(
        statement,
        CODES.form,
        `${writtenName}(...) needs an INLINE arrow/function-expression value thunk; a plain value or ` +
          'an indirect function reference is outside the admitted context slice',
      );
      return 'refused';
    }
    if (thunk.asteriskToken !== undefined) {
      this.fail(statement, CODES.form, `${writtenName}(...) cannot take a generator value thunk`);
      return 'refused';
    }
    const modifiers = ts.canHaveModifiers(thunk) ? ts.getModifiers(thunk) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true) {
      this.fail(
        statement,
        CODES.form,
        `the ${writtenName} value thunk must be synchronous; an async provider value is outside ` +
          'the context slice',
      );
      return 'refused';
    }
    if (thunk.parameters.length !== 0) {
      this.fail(
        statement,
        CODES.form,
        `the ${writtenName} value thunk takes no parameters (it is re-read, not called with a value)`,
      );
      return 'refused';
    }
    const value = this.expression(thunk, 'handler');
    if (value === null) return 'refused';
    return { token, value, span: spanOf(this.sourceFile, statement) };
  }

  /**
   * `16b-CTX` — the imported name when `call` invokes a canonical `useContext`
   * intrinsic, or `null`.
   */
  private useContextIntrinsicImport(call: ts.CallExpression): string | null {
    return this.contextIntrinsicImport(call) === 'useContext' ? 'useContext' : null;
  }

  /**
   * `16b-CTX` — admit one `const value = useContext(token)` declaration as a
   * component-scope CONSUMER.
   *
   * The call takes exactly one argument (the token, lowered in `setup` mode) and
   * no type arguments. The declared name is bound to the compiler-owned
   * consumer-local Signal, so — unlike a `ref` handle — reading `.value` in a
   * tracked slot is the SUPPORTED use and needs no read-position gate.
   *
   * The declaration must be `const`: the retained setup record aliases it and
   * the signal identity is the contract (a reconnect writes into the SAME
   * object), so a reassignable binding would imply something the emitted code
   * cannot honour. Refusals keep `OEC9042`.
   */
  private buildContextConsumer(
    declaration: ts.VariableDeclaration,
    name: string,
    call: ts.CallExpression,
  ): FunctionModelResource | null {
    if (
      call.typeArguments !== undefined ||
      call.arguments.length !== 1 ||
      this.useContextIntrinsicImport(call) === null
    ) {
      this.fail(
        call,
        CODES.form,
        'useContext(token) takes exactly one context token and no type arguments',
      );
      return null;
    }
    const list = declaration.parent;
    if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) {
      this.fail(
        call,
        CODES.form,
        'a useContext consumer must be declared with const: the consumer signal identity is the ' +
          'contract and the emitted alias is not reassignable',
      );
      return null;
    }
    const expression = this.expression(unwrap(call.arguments[0]!), 'setup');
    if (expression === null) return null;
    return {
      name,
      kind: 'context',
      expression,
      recipeId: null,
      span: spanOf(this.sourceFile, declaration),
    };
  }

  private buildDeclaration(declaration: ts.VariableDeclaration): FunctionModelResource | null {
    if (!ts.isIdentifier(declaration.name)) {
      this.fail(declaration, CODES.form, 'only plain identifier declarations are admitted');
      return null;
    }
    const name = declaration.name.text;
    const initializer = declaration.initializer;
    if (initializer === undefined) {
      this.fail(declaration, CODES.form, 'a declaration needs an initializer');
      return null;
    }
    const value = unwrap(initializer);
    if (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value)) {
      // A direct JSX initializer is a reusable JSX value (M06b1a-2): one recipe
      // is created here and every `{name}` slot becomes its insertion site. The
      // recipe id is model metadata; the generator never re-derives the link.
      const recipeId = this.ensureRecipeId(value);
      if (recipeId === undefined) return null;
      this.localRecipeNames.set(name, recipeId);
      return {
        name,
        kind: 'local',
        expression: null,
        recipeId,
        span: spanOf(this.sourceFile, declaration),
      };
    }
    // `16b-CTX`: a `useContext(token)` declaration is a compiler-erased
    // CONSUMER, not a lowered snapshot. It is recognized BEFORE the generic
    // signal/computed branch on purpose: the host classifier reports
    // `useContext` as a factory whose result is a signal (so a tracked slot
    // reading `.value` is an ordinary reactive dependency), and this branch is
    // what turns that classification into the lane's own consumer RESOURCE —
    // one persistent consumer-local signal built by the retained setup factory,
    // so a reconnect writes into the SAME object.
    if (ts.isCallExpression(value) && this.useContextIntrinsicImport(value) !== null) {
      return this.buildContextConsumer(declaration, name, value);
    }
    const binding = this.resolved.resolveIdentifier(declaration.name);
    const kind = binding?.value;
    if (ts.isCallExpression(value) && (kind === 'signal' || kind === 'computed')) {
      const argument = value.arguments[0] ?? value;
      const expression = this.expression(argument, kind === 'computed' ? 'derived' : 'setup');
      return { name, kind, expression, recipeId: null, span: spanOf(this.sourceFile, declaration) };
    }
    // `16b-REF`: a `ref(...)` declaration is a compiler-erased NODE HANDLE, not
    // a lowered snapshot. Admission is binding provenance (a named import from
    // the canonical intrinsic specifiers, aliases followed) plus the call
    // shape; the handle's optional notification callback lowers in `handler`
    // mode, exactly like the plain `ref` attribute it is handed to, so its
    // reads are declared without becoming reactive dependencies.
    if (ts.isCallExpression(value) && this.refIntrinsicImport(value) !== null) {
      return this.buildRefHandle(declaration, name, value);
    }
    // `16b-REF` / `useHost`: a `useHost()` declaration is the OWNING ELEMENT as a
    // value. It needs no runtime channel and no lifetime of its own — the
    // retained setup factory already receives the element on its host record,
    // so the generator lowers this to one field read. Admission is binding
    // provenance (a named import from the canonical intrinsic specifiers) plus
    // the call shape; nothing is inferred from the spelling.
    if (ts.isCallExpression(value) && this.useHostIntrinsicImport(value) !== null) {
      return this.buildHostAccess(declaration, name, value);
    }
    const expression = this.expression(value, 'setup');
    return {
      name,
      kind: 'local',
      expression,
      recipeId: null,
      span: spanOf(this.sourceFile, declaration),
    };
  }

  /**
   * `16b-REF` — the imported name when `call` invokes a canonical `useHost`
   * intrinsic, or `null`.
   *
   * Same binding-provenance rule as `ref`: an identifier whose resolved binding
   * is a named import of one of {@linkcode LIFECYCLE_INTRINSIC_SPECIFIERS} with
   * the imported name `useHost`. A local shadow or a foreign same-named
   * function is not the intrinsic.
   */
  private useHostIntrinsicImport(call: ts.CallExpression): string | null {
    const callee = unwrap(call.expression);
    if (!ts.isIdentifier(callee)) return null;
    const binding = this.resolved.resolveIdentifier(callee);
    if (binding === undefined || binding.origin.form !== 'import') return null;
    if (!isLifecycleIntrinsicSpecifier(binding.origin.specifier)) return null;
    return binding.origin.importedName === 'useHost' ? 'useHost' : null;
  }

  /**
   * `16b-REF` — admit one `const host = useHost()` declaration as this
   * component's OWNING ELEMENT.
   *
   * The call takes no arguments and no type arguments (the element type is not
   * author-chosen: a root's host is the generated element, a depth-1 retained
   * hostless child's is the nearest enclosing generated element). The
   * declaration must be `const` — the element identity never changes for an
   * instance, so a reassignable binding would imply something the lowered read
   * cannot honour.
   *
   * `expression` stays null: there is nothing to lower. The generator emits the
   * host-record field read, which is the same value the lifecycle/change/error
   * callbacks already receive as `env.host`.
   */
  private buildHostAccess(
    declaration: ts.VariableDeclaration,
    name: string,
    call: ts.CallExpression,
  ): FunctionModelResource | null {
    if (call.typeArguments !== undefined || call.arguments.length !== 0) {
      this.fail(call, CODES.form, 'useHost() takes no arguments and no type arguments');
      return null;
    }
    const list = declaration.parent;
    if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) {
      this.fail(
        call,
        CODES.form,
        'a useHost() accessor must be declared with const: the element identity is the contract ' +
          'and the emitted alias is not reassignable',
      );
      return null;
    }
    return {
      name,
      kind: 'host',
      expression: null,
      recipeId: null,
      span: spanOf(this.sourceFile, declaration),
    };
  }

  /**
   * `16b-REF` — the imported name when `call` invokes a canonical `ref`
   * intrinsic, or `null` when it invokes anything else.
   *
   * Recognized by BINDING PROVENANCE only: the callee must be a value-position
   * identifier whose resolved binding is a named import of one of the
   * {@linkcode LIFECYCLE_INTRINSIC_SPECIFIERS} whose imported name is `ref`.
   * A local shadow, a namespace member, a third subpath or a foreign module's
   * same-named factory is NOT the intrinsic and keeps every existing refusal.
   */
  private refIntrinsicImport(call: ts.CallExpression): string | null {
    const callee = unwrap(call.expression);
    if (!ts.isIdentifier(callee)) return null;
    const binding = this.resolved.resolveIdentifier(callee);
    if (binding === undefined || binding.origin.form !== 'import') return null;
    if (!isLifecycleIntrinsicSpecifier(binding.origin.specifier)) return null;
    return binding.origin.importedName === 'ref' ? 'ref' : null;
  }

  /**
   * `16b-REF` — admit one `const handle = ref<T>(callback?)` declaration as a
   * component-scope NODE HANDLE.
   *
   * The call shape is deliberately as narrow as the other intrinsics: no type
   * arguments beyond the erased handle element type, at most one argument, and
   * that argument (when present) is an INLINE synchronous arrow or function
   * expression — the same attach/detach notification the plain `ref` channel
   * admits, so the compiler has exactly one ref contract. A non-inline
   * callback, a second argument, a generator, an `async` form or a rest/
   * optional/default parameter fails closed with the existing `OEC9042` form
   * code; no new diagnostic identity is introduced.
   */
  private buildRefHandle(
    declaration: ts.VariableDeclaration,
    name: string,
    call: ts.CallExpression,
  ): FunctionModelResource | null {
    // The emitted alias is a `const` (the handle identity IS the contract: it
    // survives mount/claim and a reconnect must observe the same object). An
    // authored `let` would imply reassignment the emitted code cannot honor, so
    // it fails closed here instead of diverging silently.
    const list = declaration.parent;
    if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) {
      this.fail(
        call,
        CODES.form,
        'a ref handle must be declared with const: the handle identity is the contract and the ' +
          'emitted alias is not reassignable',
      );
      return null;
    }
    if (call.arguments.length > 1) {
      this.fail(
        call,
        CODES.form,
        'ref(...) takes at most one inline callback (the attach/detach notification)',
      );
      return null;
    }
    const span = spanOf(this.sourceFile, declaration);
    const argument = call.arguments[0];
    if (argument === undefined) {
      this.refHandleNames.add(name);
      return { name, kind: 'ref', expression: null, recipeId: null, span };
    }
    const callback = unwrap(argument);
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
      this.fail(
        call,
        CODES.form,
        'ref(...) needs an INLINE arrow/function-expression callback; an indirect function ' +
          'reference is outside the admitted ref slice',
      );
      return null;
    }
    if (callback.asteriskToken !== undefined) {
      this.fail(call, CODES.form, 'a ref callback cannot be a generator');
      return null;
    }
    const modifiers = ts.canHaveModifiers(callback) ? ts.getModifiers(callback) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true) {
      this.fail(
        call,
        CODES.form,
        'the ref callback must be synchronous; an async callback (and an async cleanup) is ' +
          'outside the ref slice',
      );
      return null;
    }
    if (callback.parameters.length > 1) {
      this.fail(call, CODES.form, "a ref callback takes at most one 'element' parameter");
      return null;
    }
    const parameter = callback.parameters[0];
    if (
      parameter !== undefined &&
      (parameter.dotDotDotToken !== undefined ||
        parameter.questionToken !== undefined ||
        parameter.initializer !== undefined ||
        !ts.isIdentifier(parameter.name))
    ) {
      this.fail(
        call,
        CODES.form,
        'a ref callback parameter is a plain identifier; rest, optional, default and ' +
          'destructuring forms are outside the ref slice',
      );
      return null;
    }
    const lowered = this.expression(callback, 'handler');
    if (lowered === null) return null;
    this.refHandleNames.add(name);
    return { name, kind: 'ref', expression: lowered, recipeId: null, span };
  }

  // ── JSX / node tree ────────────────────────────────────────────────────

  private buildBranch(node: ts.Node): readonly FunctionModelNode[] {
    const value = unwrap(node);
    if (
      value.kind === ts.SyntaxKind.NullKeyword ||
      value.kind === ts.SyntaxKind.FalseKeyword ||
      (ts.isIdentifier(value) && value.text === 'undefined')
    ) {
      return [];
    }
    const built = this.buildNode(value);
    if (built === null) {
      // Fail closed: a branch value that is neither JSX nor nullish must not be
      // silently dropped (the class frontend's OEC9012 branch boundary analogue).
      this.fail(value, CODES.form, 'a conditional branch must be JSX or null');
      return [];
    }
    return [built];
  }

  private buildNode(node: ts.Node): FunctionModelNode | null {
    const value = unwrap(node);
    if (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value)) {
      const opening = ts.isJsxElement(value) ? value.openingElement : value;
      const tag = opening.tagName.getText(this.sourceFile);
      return isComponentTag(tag)
        ? this.buildComponentRef(value, opening, tag)
        : this.buildElement(value, opening, tag);
    }
    if (ts.isJsxFragment(value)) {
      return {
        kind: 'fragment',
        children: this.buildChildren(value.children),
        span: spanOf(this.sourceFile, value),
      };
    }
    return null;
  }

  private buildChildren(children: ts.NodeArray<ts.JsxChild>): readonly FunctionModelNode[] {
    const nodes: FunctionModelNode[] = [];
    for (const child of children) {
      if (ts.isJsxText(child)) {
        const text = child.text.replace(/\s+/g, ' ');
        if (text.trim() === '') continue;
        nodes.push({ kind: 'text', value: text, span: spanOf(this.sourceFile, child) });
        continue;
      }
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
        // Direct nested JSX children are model nodes (not expressions): build
        // them through the same node path so they are never silently dropped.
        const nested = this.buildNode(child);
        if (nested !== null) nodes.push(nested);
        continue;
      }
      if (!ts.isJsxExpression(child) || child.expression === undefined) continue;
      const built = this.buildSlot(child.expression);
      if (built !== null) nodes.push(built);
    }
    return nodes;
  }

  /** One `{...}` child slot: projection, insertion, condition, list or text. */
  private buildSlot(expression: ts.Expression): FunctionModelNode | null {
    const value = unwrap(expression);
    const propsParam = this.currentPropsParam;
    if (
      propsParam !== null &&
      ts.isPropertyAccessExpression(value) &&
      ts.isIdentifier(value.expression) &&
      value.expression.text === propsParam &&
      value.name.text === 'children'
    ) {
      return { kind: 'children-projection', span: spanOf(this.sourceFile, value) };
    }
    if (ts.isIdentifier(value)) {
      // A component-scope local bound to a direct JSX initializer is a reusable
      // JSX value: every `{name}` slot is an insertion site for its recipe
      // (M06b1a-2). An enclosing list-mapper parameter with the same name
      // shadows the component local inside its template.
      const recipeId = this.entryParameters.includes(value.text)
        ? undefined
        : this.localRecipeNames.get(value.text);
      if (recipeId !== undefined) {
        return { kind: 'insertion-site', recipeId, span: spanOf(this.sourceFile, value) };
      }
    }
    const list = this.tryBuildList(value);
    if (list !== null) return list;
    if (ts.isConditionalExpression(value) || isAndExpression(value)) {
      const conditional = value as ts.ConditionalExpression | ts.BinaryExpression;
      const test = ts.isConditionalExpression(conditional)
        ? conditional.condition
        : conditional.left;
      const consequent = ts.isConditionalExpression(conditional)
        ? conditional.whenTrue
        : conditional.right;
      const alternate = ts.isConditionalExpression(conditional) ? conditional.whenFalse : undefined;
      const testRef = this.expression(test, 'inline');
      if (testRef === null) return null;
      return {
        kind: 'condition',
        test: testRef,
        consequent: this.buildBranch(consequent),
        alternate: alternate === undefined ? null : this.buildBranch(alternate),
        span: spanOf(this.sourceFile, conditional),
      };
    }
    const dynamic = this.expression(value, this.currentEntryMode());
    if (dynamic === null) return null;
    return { kind: 'dynamic-text', expression: dynamic, span: spanOf(this.sourceFile, value) };
  }

  private tryBuildList(value: ts.Node): FunctionModelList | null {
    if (!ts.isCallExpression(value)) return null;
    if (!ts.isPropertyAccessExpression(value.expression)) return null;
    if (value.expression.name.text !== 'map') return null;
    const callback = value.arguments[0];
    if (
      callback === undefined ||
      (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
    ) {
      this.fail(value, CODES.form, 'a list mapper must be a single inline function');
      return null;
    }
    const parameter = callback.parameters[0];
    if (parameter === undefined || !ts.isIdentifier(parameter.name)) {
      this.fail(value, CODES.form, 'a list mapper must take one plain identifier parameter');
      return null;
    }
    const items = this.expression(value.expression.expression, 'inline');
    if (items === null) return null;
    const previousMode = this.entryMode;
    this.entryMode = 'per-entry';
    // The mapper parameter shadows any component-scope recipe name while its
    // template is built (M06b1a-2): `items.map((x) => <p>{x}</p>)` reads the
    // entry, never the reusable JSX value `x` from the component scope.
    this.entryParameters.push(parameter.name.text);
    const template = this.buildBranch(callback.body);
    this.entryParameters.pop();
    this.entryMode = previousMode;
    const first = template[0];
    let key: FunctionExpressionRef | null = null;
    if (first !== undefined && (first.kind === 'element' || first.kind === 'component-ref')) {
      const attributes =
        first.kind === 'element'
          ? first.attributes
          : first.kind === 'component-ref'
            ? first.props
            : [];
      const keyAttribute = attributes.find(
        (attribute): attribute is FunctionModelDynamicAttribute =>
          attribute.kind === 'dynamic' && attribute.channel === 'key',
      );
      key = keyAttribute?.expression ?? null;
    }
    return {
      kind: 'list',
      parameter: parameter.name.text,
      items,
      key,
      template,
      span: spanOf(this.sourceFile, value),
    };
  }

  private buildElement(
    node: ts.JsxElement | ts.JsxSelfClosingElement,
    opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    tag: string,
  ): FunctionModelElement | null {
    const tagReason = forbiddenSinkReason('tag', tag);
    if (tagReason !== null) {
      this.fail(opening.tagName, 'OEC9010', `tag <${tag}> is a ${tagReason}`);
      return null;
    }
    // The HTML parser treats a void element as childless. Refuse authored
    // children here, at the source, instead of letting mount append nodes the
    // SSR producer would have to drop.
    const voidChild = ts.isJsxElement(node)
      ? node.children.find(hasMeaningfulVoidChild)
      : undefined;
    if (VOID_TAGS.has(tag) && voidChild !== undefined) {
      this.fail(voidChild, 'OEC9013', `void element <${tag}> may not have children`);
      return null;
    }
    const attributes = this.buildAttributes(opening.attributes, tag, true);
    const children = ts.isJsxElement(node) ? this.buildChildren(node.children) : [];
    return { kind: 'element', tag, attributes, children, span: spanOf(this.sourceFile, node) };
  }

  private buildComponentRef(
    node: ts.JsxElement | ts.JsxSelfClosingElement,
    opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    tag: string,
  ): FunctionModelComponentRef | null {
    const name = tag.split('.')[0] ?? tag;
    const props = this.buildAttributes(opening.attributes, tag, false);
    // JSX children on a component reference are the children recipe passed as
    // `props.children` (JSX value model §4.4): one fragment recipe per ref site,
    // owned by the component that authors the ref. A whitespace-only child list
    // builds no node and therefore passes no recipe (same as no children).
    let childrenRecipeId: string | null = null;
    if (ts.isJsxElement(node) && node.children.length > 0) {
      const children = this.buildChildren(node.children);
      if (children.length > 0) {
        const fragment: FunctionModelFragment = {
          kind: 'fragment',
          children,
          span: spanOf(this.sourceFile, node),
        };
        childrenRecipeId = this.registerChildrenRecipe(fragment);
      }
    }
    return {
      kind: 'component-ref',
      name,
      props,
      childrenRecipeId,
      span: spanOf(this.sourceFile, node),
    };
  }

  private buildAttributes(
    attributes: ts.JsxAttributes,
    tag: string,
    intrinsic: boolean,
  ): readonly FunctionModelAttribute[] {
    const built: FunctionModelAttribute[] = [];
    for (const property of attributes.properties) {
      if (ts.isJsxSpreadAttribute(property)) {
        this.fail(property, CODES.form, 'spread attributes are outside the admitted grammar');
        continue;
      }
      const name = property.name.getText(this.sourceFile);
      const initializer = property.initializer;
      if (initializer === undefined || ts.isStringLiteral(initializer)) {
        const staticName = name;
        if (intrinsic && this.screenStaticAttribute(staticName, tag, property)) continue;
        built.push({
          kind: 'static',
          name,
          value: initializer === undefined ? 'true' : initializer.text,
          span: spanOf(this.sourceFile, property),
        });
        continue;
      }
      if (!ts.isJsxExpression(initializer) || initializer.expression === undefined) continue;
      const expressionNode = initializer.expression;
      const channel = classifyIntrinsicAttribute(name, tag);
      if (intrinsic && this.screenDynamicAttribute(name, tag, channel, property)) continue;
      // Event and ref values are attach-once client channels, not tracked
      // slots: handler mode records their reads (so the generator can declare
      // them) without reactive dependencies, so a replacement cannot be
      // mistaken for a tracked write and a ref handler is evaluated once at
      // attach (element) / detach (null). Every other channel keeps the
      // enclosing entry mode.
      const mode =
        channel === 'event' || channel === 'ref'
          ? 'handler'
          : channel === 'key'
            ? 'key'
            : this.currentEntryMode();
      const expression = this.expression(expressionNode, mode);
      if (expression === null) continue;
      built.push({
        kind: 'dynamic',
        name,
        channel,
        expression,
        span: spanOf(this.sourceFile, property),
      });
    }
    return built;
  }

  /** Shared deny/name predicates for a static attribute; returns true when refused. */
  private screenStaticAttribute(name: string, tag: string, node: ts.Node): boolean {
    if (name === 'innerHTML') {
      this.fail(
        node,
        'OEC9011',
        'attribute name "innerHTML" is unsafe as a static attribute — innerHTML opens only through ' +
          'the trusted-HTML sink: bind an Object-typed trustedHtml(...) property and carry the literal trustedHtml marker',
      );
      return true;
    }
    if (!isSafeAttributeName(name)) {
      this.fail(
        node,
        'OEC9011',
        `attribute name "${name}" is unsafe — names must be valid HTML attribute names, not event handlers (on*) or forbidden sinks; use an admitted attribute name`,
      );
      return true;
    }
    return this.screenForbiddenName(name, node);
  }

  private screenDynamicAttribute(
    name: string,
    tag: string,
    channel: ReturnType<typeof classifyIntrinsicAttribute>,
    property: ts.JsxAttribute,
  ): boolean {
    if (channel === 'html') {
      this.fail(
        property,
        CODES.security,
        'innerHTML sinks are not admitted by the M03 function-component model (the trusted-HTML ' +
          'capability contract is a class-authoring mechanism); fail closed',
      );
      return true;
    }
    if (channel === 'event') return false;
    if (!isSafeAttributeName(name)) {
      this.fail(
        property,
        'OEC9011',
        `attribute name "${name}" is unsafe — names must be valid HTML attribute names, not event handlers (on*) or forbidden sinks; use an admitted attribute name`,
      );
      return true;
    }
    return this.screenForbiddenName(name, property);
  }

  private screenForbiddenName(name: string, node: ts.Node): boolean {
    // The Alpha15 core screens every dynamic/static sink name against the
    // shared deny list before its channel-specific lowering; mirror that order
    // (prop before attr/bool) so the OEC diagnostic is identical.
    let reason: string | null = null;
    for (const sinkKind of ['prop', 'bool', 'attr'] as const) {
      reason = forbiddenSinkReason(sinkKind, name);
      if (reason !== null) break;
    }
    if (reason === null) return false;
    this.fail(
      node,
      'OEC9011',
      `${reason} — the shared deny list screens every boundary; rename the attribute`,
    );
    return true;
  }

  private entryMode: EvaluationMode = 'inline';
  private currentEntryMode(): EvaluationMode {
    return this.entryMode;
  }
  private currentPropsParam: string | null = null;

  diagnosticsView(): readonly CompilerDiagnostic[] {
    return this.diagnostics;
  }

  build(candidates: readonly ComponentCandidate[]): FunctionModelModule | null {
    const components: FunctionModelComponent[] = [];
    for (const candidate of candidates) {
      this.currentPropsParam =
        candidate.node.parameters[0] !== undefined &&
        ts.isIdentifier(candidate.node.parameters[0].name)
          ? candidate.node.parameters[0].name.text
          : null;
      const component = this.buildComponent(candidate);
      if (component !== null) components.push(component);
    }
    if (this.hasErrors()) return null;
    return {
      file: this.sourceFile.fileName,
      components,
      expressions: this.registry,
      imports: this.collectModuleImports(),
    };
  }

  /**
   * The module's static import table. Type-only and side-effect imports carry
   * no readable binding, so they are not part of it; a named alias keeps the
   * authored `imported as local` spelling.
   */
  private collectModuleImports(): FunctionModelImport[] {
    const imports: FunctionModelImport[] = [];
    for (const statement of this.sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      if (clause === undefined || clause.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (clause.name !== undefined) {
        imports.push({ specifier, imported: 'default', local: clause.name.text, form: 'default' });
      }
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        imports.push({
          specifier,
          imported: '*',
          local: bindings.name.text,
          form: 'namespace',
        });
      } else if (bindings !== undefined) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          imports.push({
            specifier,
            imported: (element.propertyName ?? element.name).text,
            local: element.name.text,
            form: 'named',
          });
        }
      }
    }
    return imports;
  }
}

const RECIPE_REFERENCE_CALLEE = '__oe_recipe_ref';

function isAndExpression(node: ts.Node): boolean {
  return (
    ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  );
}

/**
 * Compile one authored module with the function-component frontend.
 *
 * Parallel entry, compiler-private: returns the component model plus the
 * expression sidecar, or the source-located OEC diagnostics that failed the
 * compile closed. It never calls the class frontend and emits no Part Program.
 */
export function compileFunctionModule(
  source: string,
  fileName: string,
  options: FunctionFrontendOptions = {},
): FunctionFrontendResult {
  const parsed = typescriptParser.parseModule(source, fileName);
  const sourceFile = parsed.sourceFile;
  if (parsed.syntaxDiagnostics.length > 0) {
    return {
      module: null,
      diagnostics: parsed.syntaxDiagnostics.map((diagnostic) => {
        const start = diagnostic.start ?? 0;
        const end = start + (diagnostic.length ?? 0);
        const position = sourceFile.getLineAndCharacterOfPosition(start);
        return {
          code: 'OEC9000',
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
          file: fileName,
          line: position.line + 1,
          character: position.character + 1,
          start,
          end,
        };
      }),
    };
  }

  const candidates = discoverComponents(sourceFile);
  const components = candidates.filter(isComponentShape);
  if (components.length === 0) {
    return {
      module: null,
      diagnostics: [
        diagnosticAt(
          sourceFile,
          sourceFile,
          CODES.shape,
          'no function component found (a top-level function or arrow returning JSX is required)',
        ),
      ],
    };
  }

  const resolved = resolveModule(sourceFile, {
    components: components.map((candidate) => candidate.node),
    ...(options.importClassifier === undefined
      ? {}
      : { importClassifier: options.importClassifier }),
  });
  const diagnostics: CompilerDiagnostic[] = resolved.diagnostics.map((diagnostic) =>
    fromRefusal(sourceFile, diagnostic),
  );
  if (diagnostics.length > 0) return { module: null, diagnostics };

  const builder = new FunctionFrontendBuilder(sourceFile, resolved, options.lifecycleAdmission);
  const module = builder.build(components);
  return module === null
    ? { module: null, diagnostics: builder.diagnosticsView() }
    : { module, diagnostics: [] };
}
