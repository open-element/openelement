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
  readonly kind: 'signal' | 'computed' | 'local';
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

/** One function component of the module. */
export interface FunctionModelComponent {
  readonly name: string;
  /** Authored props parameter name; `null` for a destructured props parameter. */
  readonly propsParam: string | null;
  readonly resources: readonly FunctionModelResource[];
  readonly recipes: readonly FunctionModelRecipe[];
  readonly roots: readonly FunctionModelNode[];
  readonly span: SourceSpan;
}

/** The lowered module: components plus the per-compilation expression sidecar. */
export interface FunctionModelModule {
  readonly file: string;
  readonly components: readonly FunctionModelComponent[];
  /** A2 sidecar: lowered text, captures/dependencies, anchors, segments. */
  readonly expressions: ExpressionRegistry;
}

export interface FunctionFrontendOptions {
  /** Host classifier for imported symbols (A1 §6); omitted = nothing known. */
  readonly importClassifier?: ImportClassifier;
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

  constructor(sourceFile: ts.SourceFile, resolved: ResolvedModule) {
    this.sourceFile = sourceFile;
    this.resolved = resolved;
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
    const body = node.body;
    if (body === undefined) {
      this.fail(node, CODES.shape, 'a function component must have a body');
      return null;
    }
    let returnExpression: ts.Expression | null = null;
    if (ts.isBlock(body)) {
      for (const statement of body.statements) {
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
      span: spanOf(this.sourceFile, node),
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
    const binding = this.resolved.resolveIdentifier(declaration.name);
    const kind = binding?.value;
    if (ts.isCallExpression(value) && (kind === 'signal' || kind === 'computed')) {
      const argument = value.arguments[0] ?? value;
      const expression = this.expression(argument, kind === 'computed' ? 'derived' : 'setup');
      return { name, kind, expression, recipeId: null, span: spanOf(this.sourceFile, declaration) };
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
      const mode =
        channel === 'event' ? 'handler' : channel === 'key' ? 'key' : this.currentEntryMode();
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
    };
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

  const builder = new FunctionFrontendBuilder(sourceFile, resolved);
  const module = builder.build(components);
  return module === null
    ? { module: null, diagnostics: builder.diagnosticsView() }
    : { module, diagnostics: [] };
}
