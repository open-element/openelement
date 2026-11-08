/**
 * M03-I-1 — lexical scope resolution (Alpha16a, compiler-private).
 *
 * Design authority: `docs/architecture/m03-scope-resolution.md` (M03-A). This
 * module is **not** exported from `packages/compiler/src/compiler.ts` or any
 * package subpath, and it is not wired into the production compile path: A1 is
 * the resolver + its contract + its tests. A4 owns the production frontend.
 *
 * What it implements, mapped to the design sections:
 *
 * - §3 binding identity split from classification: `ScopeId`, `BindingId`,
 *   `DeclarationKind`, `ValueKind`, `BindingOrigin`, `DeclarationRecord`,
 *   `ResolvedBinding`; declaration merging and redeclaration diagnostics.
 * - §4 lexical scope semantics: `var` hoisting, block scoping, catch, `for`
 *   per-iteration bindings, switch sharing one scope, class outer/inner
 *   bindings, named function/class expression self-name binding, parameter
 *   ordering, and the coded fail-closed diagnostics for constructs outside the
 *   model.
 * - §4.1 TDZ is a **runtime state**: a read always binds lexically; a static
 *   TDZ diagnostic is emitted only inside the provable bound documented below.
 * - §5 four independent axes: `reads` (which bindings an expression reads),
 *   `captures` (a read that crosses a function boundary), `dependencies` (the
 *   reads a tracked slot must subscribe to, selected by mode AND value kind),
 *   and `mode`.
 * - §6/§6.1 host `ImportClassifier`: syntax is authoritative for the module's
 *   own declarations; a host-supplied classifier answers module-symbol
 *   questions (`classifySymbol` → `classifyCall` / `classifyMember`); no
 *   `ts.Program` and no type checker is used as the mechanism.
 *
 * Design-bound decisions (recorded here so review can check them):
 *
 * 1. **Span/diagnostic types are declared in this module**, with the same
 *    field shape as `semantic-ir/types.ts`'s `IrSpan`/`IrDiagnostic`. Reusing
 *    the spike's types would make `semantic-core` depend on a module excluded
 *    from the published package; the adapter that feeds the IR passes these
 *    records through field-for-field.
 * 2. **TDZ provable bound** (the only source of `OEIR_TDZ_READ`): the read is
 *    in the same statement-list scope as the `let`/`const`/`class` declaration
 *    (no nested block, no nested function), the read is not inside a
 *    control-flow construct or a nested class (`if`/loop/`switch`/`try`/
 *    conditional/logical short-circuit/label/class), and the read's
 *    (statement, declarator) slot is at or before the declaring
 *    (statement, declarator) slot. Everything else — closures created before
 *    initialization, calls whose ordering cannot be proven, reads in nested
 *    scopes — stays non-diagnostic (§4.1).
 * 3. **Capture rule**: a read is a capture when it sits inside more function
 *    boundaries than the declaration (§5 "does the read cross a function
 *    boundary"). Builtin globals are never captures. Module-scope reads from
 *    inside a component closure therefore count as captures; a consumer that
 *    only wants component-local captures filters on `origin.form`.
 * 4. **Builtin globals** are a small, documented ECMAScript allowlist. A name
 *    outside it is unresolved (`OEIR_UNRESOLVED_BINDING`) instead of being
 *    silently treated as a local (§4). Hosts extend the list through
 *    `ResolveModuleOptions.globals`; the resolver itself never guesses from a
 *    spelling and never lets ambient state in.
 * 5. **Provisional diagnostic codes** the design names behaviour for but does
 *    not spell: `OEIR_TDZ_READ` (provable TDZ), `OEIR_TYPE_ONLY_VALUE_READ`,
 *    `OEIR_UNCLASSIFIED_BINDING` (tracked slot whose binding kind the host did
 *    not classify), `OEIR_UNSUPPORTED_DECLARATION` (namespace/enum/import=),
 *    `OEIR_UNSUPPORTED_LABEL`.
 * 6. **Value-kind defaults for local declarations**: a local binding is
 *    `plain` by syntax unless the §6.1 factory chain classifies its
 *    initializer, or its initializer is a plain identifier alias of an already
 *    classified binding (kind and import provenance are copied). A call whose
 *    callee is a local/global value stays `plain` — the resolver never guesses
 *    a factory from a spelling; a call whose callee is a module symbol the host
 *    could not classify is `unknown`/`unresolved` and fails closed only where a
 *    kind is required. This is a syntax resolver, not a checker: a local helper
 *    that returns a signal is invisible to it by construction.
 * 7. **`ResolvedBinding.role`** carries the §6 `SymbolRole` next to `value`
 *    (`ValueKind`) so a factory import is known to be a factory while it is
 *    *not* the reactive value the factory produces. §3's field list does not
 *    name the role, but §6 makes it an observable classification result.
 * 8. **Builtin globals are not part of `bindings`**: they are synthesized on
 *    first read (`origin: 'builtin'`, no declaration records, zero span) and
 *    `bindings` lists authored declarations only. The §3 invariant "a binding
 *    has at least one declaration record" therefore applies to authored
 *    bindings.
 * 9. **Two diagnostic surfaces, one per pass**: `resolveModule(...).diagnostics`
 *    carries declaration/import/unsupported-construct findings (nothing that
 *    requires deciding whether a read resolves); `resolveExpression(...)`
 *    returns the per-expression diagnostics (unresolved reads, provable TDZ,
 *    type-only value reads, unclassified tracked slots). The production
 *    frontend resolves exactly the expressions it lowers, so it sees every
 *    diagnostic that applies to authored code it accepts, and no consumer is
 *    required to walk the whole module to get them.
 */

import ts from 'typescript';

// ─── §3 binding identity, split from classification ─────────────────────────

/** A half-open authored source range (UTF-16 code units, TS position unit). */
export interface SourceSpan {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  /** 1-based line of `start`. */
  readonly line: number;
  /** 1-based column of `start`. */
  readonly column: number;
}

/** Stable within one compilation; not serialized. */
export interface ScopeId {
  readonly moduleId: string;
  /** Scope-chain path: `"0.2.1"` = module → second child → first child. */
  readonly path: string;
}

/** Binding identity. Never contains a `ValueKind` (§3 rule). */
export interface BindingId {
  readonly scope: ScopeId;
  readonly name: string;
  /**
   * Ordinal among declarations of this name in the scope. `0` for every legal
   * merge (declaration merging keeps one identity); raised only when an illegal
   * duplicate has to be recovered as a second identity.
   */
  readonly declarationOrder: number;
}

/** Syntactic form of one declaration. Immutable once built. */
export type DeclarationKind =
  | 'var'
  | 'let'
  | 'const'
  | 'function'
  | 'class'
  | 'class-name'
  | 'param'
  | 'import'
  | 'catch';

/** Classification; mutable (a host may learn or refine it later). */
export type ValueKind = 'signal' | 'computed' | 'prop' | 'plain' | 'unknown';

/** What an imported symbol *is* — a role, not a value category (§6). */
export type SymbolRole = 'factory' | 'value' | 'type' | 'namespace' | 'unknown';

/** Where the binding came from (§3). */
export type BindingOrigin =
  | { readonly form: 'local' }
  /**
   * ONLY the component's original props object parameter. Every name produced
   * by destructuring it is `local` (a snapshot) and must not reuse this form.
   */
  | { readonly form: 'prop-param' }
  | {
      readonly form: 'import';
      readonly specifier: string;
      /** `null` means a default import (or a namespace import, §6). */
      readonly importedName: string | null;
    }
  | { readonly form: 'builtin'; readonly name: string };

/** One syntactic declaration contributing to a binding. */
export interface DeclarationRecord {
  readonly kind: DeclarationKind;
  /** Points at the authored binding name (the diagnostic location). */
  readonly span: SourceSpan;
  /** True when this record is the one that carries the initializer/value. */
  readonly initializing: boolean;
}

/** Classification provenance: syntax-derived or host-supplied (§3). */
export type ClassificationSource = 'syntax' | 'host-classifier' | 'unresolved';

/** One resolved binding: every declaration that merged into it. */
export interface ResolvedBinding {
  readonly id: BindingId;
  readonly declarations: readonly DeclarationRecord[];
  readonly value: ValueKind;
  readonly origin: BindingOrigin;
  /** Authored declaration sites; the first record's span is canonical. */
  readonly declarationSpan: SourceSpan;
  readonly classifiedBy: ClassificationSource;
  /**
   * §6 symbol role (factory/value/type/namespace/unknown) when known. Kept
   * next to—not inside—`ValueKind` so a factory symbol is never mistaken for
   * the value it produces.
   */
  readonly role: SymbolRole | null;
}

// ─── §6 host import-classifier contract ─────────────────────────────────────

/** What calling a factory produces, when the host knows it. */
export interface FactoryResult {
  readonly call: 'signal' | 'computed' | 'unknown';
}

/**
 * The host-supplied classifier for module symbols (§6). The resolver never
 * infers a role from a name; every cross-module question goes through this
 * interface. A host may omit `classifyMember`; namespace member reads then stay
 * `unknown` (§6.1) and fail closed only where a kind is required.
 */
export interface ImportClassifier {
  /** Role of the imported symbol (alias already resolved). */
  classifySymbol(moduleSpecifier: string, importedName: string | null): SymbolRole | undefined;
  /** Value kind of the binding, when the host knows it directly. */
  classifyValue(moduleSpecifier: string, importedName: string | null): ValueKind | undefined;
  /** Result kind of a factory call, when the host knows it. */
  classifyCall(moduleSpecifier: string, importedName: string | null): FactoryResult | undefined;
  /** Optional: classify a namespace member (`ns.x`). */
  classifyMember?(moduleSpecifier: string, memberName: string): SymbolRole | undefined;
}

// ─── §5 four axes ───────────────────────────────────────────────────────────

/** When the expression runs. Dependency selection depends on it (§5). */
export type EvaluationMode = 'setup' | 'inline' | 'handler' | 'derived' | 'per-entry' | 'key';

/** One identifier an expression reads, resolved to a binding. */
export interface ResolvedRead {
  readonly name: string;
  readonly binding: BindingId;
  readonly value: ValueKind;
  readonly span: SourceSpan;
  /** True when the read crosses a function boundary (§5), builtins excepted. */
  readonly capture: boolean;
}

/** An identifier an expression reads that resolves to nothing (a diagnostic). */
export interface UnresolvedRead {
  readonly name: string;
  readonly span: SourceSpan;
}

/** §5's four axes for one expression, plus the diagnostics and failures. */
export interface ExpressionResolution {
  readonly mode: EvaluationMode;
  readonly reads: readonly ResolvedRead[];
  /** Subset of `reads`: lexical captures. */
  readonly captures: readonly BindingId[];
  /** Subset of `reads`: reactive reads in a tracked mode. */
  readonly dependencies: readonly BindingId[];
  readonly unresolvedReads: readonly UnresolvedRead[];
  readonly diagnostics: readonly ScopeDiagnostic[];
}

// ─── Diagnostics ────────────────────────────────────────────────────────────

/**
 * Where a diagnostic can be located. The resolver reports authored sites, so
 * its findings are `source`; `module` is reserved for a future module-wide
 * finding that has no authored node.
 */
export type ScopeDiagnosticOrigin = 'source' | 'module';

/** A coded, source-located resolver diagnostic. */
export interface ScopeDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly span: SourceSpan;
  readonly origin: ScopeDiagnosticOrigin;
}

// ─── Scope tree (inspection surface) ────────────────────────────────────────

export type ScopeKind =
  | 'module'
  | 'function'
  | 'block'
  | 'catch'
  | 'for'
  | 'switch'
  | 'class'
  /** Synthetic parent of the module scope holding builtin globals. */
  | 'global';

/** One lexical scope. Scope paths are internal numbering, not a contract. */
export interface ScopeRecord {
  readonly id: ScopeId;
  readonly kind: ScopeKind;
  readonly parent: ScopeId | null;
  readonly span: SourceSpan;
  /** Function/arrow/method/static-block scopes are function boundaries. */
  readonly functionBoundary: boolean;
  /** Nesting depth, module = 0 (global = -1). */
  readonly depth: number;
  /** Number of function boundaries on the chain, module = 0. */
  readonly functionDepth: number;
}

// ─── Module resolution ──────────────────────────────────────────────────────

/** The function-shaped component roots the resolver is asked about. */
export type ComponentFunction = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

/** Options for `resolveModule`. */
export interface ResolveModuleOptions {
  /**
   * The function components in this module. Their first parameter is the props
   * parameter (§3 `prop-param` origin) and their subtree is checked for the
   * context-sensitive constructs of §4 (`this`, `arguments`, `super`,
   * `new.target`). Omitted: the module is resolved without component
   * provenance, and those diagnostics are not produced.
   */
  readonly components?: readonly ComponentFunction[];
  /** Host classifier for imported symbols (§6). */
  readonly importClassifier?: ImportClassifier;
  /** Additionally-resolvable global names (the default list is ECMAScript-only). */
  readonly globals?: readonly string[];
}

/** A resolved module: bindings, scopes, diagnostics, and the resolution API. */
export interface ResolvedModule {
  readonly moduleId: string;
  readonly file: string;
  readonly sourceFile: ts.SourceFile;
  /** Declaration/import/unsupported-construct findings. */
  readonly diagnostics: readonly ScopeDiagnostic[];
  /** The scope tree, global scope first. */
  readonly scopes: readonly ScopeRecord[];
  /** Authored bindings only; builtin globals are synthesized on read. */
  readonly bindings: readonly ResolvedBinding[];
  /**
   * Resolve one authored expression on the §5 four axes. `node` must belong to
   * this module's `sourceFile`; the call is pure (returns fresh diagnostics)
   * and reads the final binding classifications built by `resolveModule`.
   */
  resolveExpression(node: ts.Node, mode: EvaluationMode): ExpressionResolution;
  /**
   * Lexical resolution of one value-position identifier occurrence (no
   * diagnostics). A declaration/property-name occurrence has no meaning here;
   * callers pass expression identifiers.
   */
  resolveIdentifier(node: ts.Identifier): ResolvedBinding | undefined;
}

/** Stable key for a `BindingId` (identity is never serialized, lookups need one). */
export function bindingKey(id: BindingId): string {
  return `${id.scope.moduleId}#${id.scope.path}#${id.name}#${id.declarationOrder}`;
}

/** The default ECMAScript global allowlist (hosts extend it via `globals`). */
const BUILTIN_GLOBALS: ReadonlySet<string> = new Set([
  'undefined',
  'NaN',
  'Infinity',
  'globalThis',
  'Object',
  'Function',
  'Boolean',
  'Symbol',
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Number',
  'BigInt',
  'Math',
  'Date',
  'String',
  'RegExp',
  'Array',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'WeakRef',
  'FinalizationRegistry',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'DataView',
  'Atomics',
  'JSON',
  'Promise',
  'Reflect',
  'Proxy',
  'Intl',
  'WebAssembly',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'unescape',
]);

/** Statement-slot of a straight-line declaration; used by the TDZ bound. */
interface DeclarationSlot {
  readonly statementIndex: number;
  readonly declaratorIndex: number;
}

interface ImportInfo {
  readonly specifier: string;
  readonly importedName: string | null;
  readonly form: 'named' | 'default' | 'namespace';
  readonly typeOnly: boolean;
}

/** Mutable during the building pass; exposed only as frozen `ResolvedBinding`. */
interface MutableBinding {
  id: BindingId;
  declarations: DeclarationRecord[];
  value: ValueKind;
  origin: BindingOrigin;
  declarationSpan: SourceSpan;
  classifiedBy: ClassificationSource;
  role: SymbolRole | null;
  readonly scope: ScopeNode;
  declarationSlot: DeclarationSlot | null;
  hasImplementation: boolean;
  importInfo: ImportInfo | null;
}

interface ScopeNode {
  readonly record: ScopeRecord;
  readonly parent: ScopeNode | null;
  readonly children: ScopeNode[];
  /** Canonical (latest) identity per name in this scope. */
  readonly byName: Map<string, BindingId>;
  readonly byId: Map<string, MutableBinding>;
  /**
   * The statement list this scope owns for the TDZ bound (module source file,
   * function body block, block, static block). `null` = no straight-line bound.
   */
  statements: readonly ts.Statement[] | null;
  statementIndex: Map<ts.Statement, number>;
  /** Ranges where a descendant position must NOT resolve into this scope. */
  readonly exclude: { start: number; end: number }[];
  nextChildOrdinal: number;
  /** The node whose statements are `statements` (TDZ bound); null if none. */
  bodyOwner: ts.Node | null;
}

/** Resolved call-result answer for one initializer (§6.1 chain). */
type CallKindAnswer =
  /** The callee chain is a host-classified factory; `call` is its result. */
  | { readonly kind: 'classified'; readonly call: 'signal' | 'computed' | 'unknown' }
  /** The callee chain is module-bound but the host could not answer (§6.1). */
  | { readonly kind: 'unanswered' }
  /** Not a host-classified factory call (a local/global call, plain JS). */
  | { readonly kind: 'unclassified' };

const SCOPE_FUNCTION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

type ScopeFunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function isScopeFunctionNode(node: ts.Node): node is ScopeFunctionNode {
  return SCOPE_FUNCTION_KINDS.has(node.kind);
}

const LEXICAL_KINDS: ReadonlySet<DeclarationKind> = new Set<DeclarationKind>([
  'let',
  'const',
  'class',
]);

const REACTIVE_KINDS: ReadonlySet<ValueKind> = new Set<ValueKind>(['signal', 'computed', 'prop']);

/** The tracked-slot modes of §5: the binding kind is required there (§6.1). */
const TRACKED_MODES: ReadonlySet<EvaluationMode> = new Set<EvaluationMode>([
  'inline',
  'derived',
  'per-entry',
]);

function emptySpan(file: string): SourceSpan {
  return { file, start: 0, end: 0, line: 1, column: 1 };
}

function unwrapExpression(node: ts.Node): ts.Node {
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

function isVarDeclarationList(list: ts.VariableDeclarationList): boolean {
  return (list.flags & ts.NodeFlags.BlockScoped) === 0;
}

function lexicalKindOf(list: ts.VariableDeclarationList): 'let' | 'const' {
  return (list.flags & ts.NodeFlags.Const) !== 0 ? 'const' : 'let';
}

function isNewTarget(node: ts.Node): boolean {
  return (
    ts.isMetaProperty(node) &&
    node.keywordToken === ts.SyntaxKind.NewKeyword &&
    node.name.text === 'target'
  );
}

// ─── The resolver ───────────────────────────────────────────────────────────

class ScopeResolver {
  private readonly sf: ts.SourceFile;
  private readonly file: string;
  private readonly options: ResolveModuleOptions;
  private readonly diagnostics: ScopeDiagnostic[] = [];
  private readonly scopes: ScopeRecord[] = [];
  private readonly authoredBindings: MutableBinding[] = [];
  private readonly bindingViews = new Map<MutableBinding, ResolvedBinding>();
  private readonly builtins = new Map<string, MutableBinding>();
  private readonly declarationBinding = new Map<ts.Node, MutableBinding>();
  private readonly propsParameters = new Set<ts.ParameterDeclaration>();
  private readonly declaredGlobals: ReadonlySet<string>;
  private readonly globalScope: ScopeNode;
  private readonly moduleScope: ScopeNode;

  constructor(sf: ts.SourceFile, options: ResolveModuleOptions) {
    this.sf = sf;
    this.file = sf.fileName;
    this.options = options;
    this.declaredGlobals = new Set([...BUILTIN_GLOBALS, ...(options.globals ?? [])]);
    for (const component of options.components ?? []) {
      const props = component.parameters[0];
      if (props !== undefined && ts.isIdentifier(props.name)) this.propsParameters.add(props);
    }
    this.globalScope = this.createScope('global', emptySpan(this.file), null, null, false);
    this.moduleScope = this.createScope('module', this.spanOfNode(sf), sf, this.globalScope, false);
  }

  // ── Entry ────────────────────────────────────────────────────────────────

  run(): ResolvedModule {
    this.setStatementList(this.moduleScope, this.sf, this.sf.statements);
    this.declareImports();
    this.hoistVars(this.sf, this.moduleScope);
    this.predeclareStatementList(this.moduleScope, this.sf.statements);
    for (const statement of this.sf.statements) {
      this.walkStatement(statement, this.moduleScope);
    }
    this.scanDynamicScope();
    for (const component of this.options.components ?? []) this.scanComponent(component);
    return this.facade();
  }

  // ── Diagnostics / spans ──────────────────────────────────────────────────

  private spanOfRange(start: number, end: number): SourceSpan {
    const position = this.sf.getLineAndCharacterOfPosition(start);
    return {
      file: this.file,
      start,
      end,
      line: position.line + 1,
      column: position.character + 1,
    };
  }

  private spanOfNode(node: ts.Node): SourceSpan {
    return this.spanOfRange(node.getStart(this.sf), node.getEnd());
  }

  private report(code: string, message: string, node: ts.Node): void {
    this.diagnostics.push({
      severity: 'error',
      code,
      message,
      span: this.spanOfNode(node),
      origin: 'source',
    });
  }

  // ── Scope construction ───────────────────────────────────────────────────

  private createScope(
    kind: ScopeKind,
    span: SourceSpan,
    bodyOwner: ts.Node | null,
    parent: ScopeNode | null,
    functionBoundary: boolean,
  ): ScopeNode {
    const parentRecord = parent?.record ?? null;
    const depth = parentRecord === null ? (kind === 'global' ? -1 : 0) : parentRecord.depth + 1;
    const functionDepth =
      parentRecord === null ? 0 : parentRecord.functionDepth + (functionBoundary ? 1 : 0);
    // The module scope is "0"; the synthetic global scope is "global" so the
    // module's path stays the design's "0" (M03-A §3 scope-chain path).
    const path =
      kind === 'global'
        ? 'global'
        : kind === 'module'
          ? '0'
          : parent === null
            ? '0'
            : `${parent.record.id.path}.${parent.nextChildOrdinal++}`;
    const record: ScopeRecord = {
      id: { moduleId: this.file, path },
      kind,
      parent: parentRecord?.id ?? null,
      span,
      functionBoundary,
      depth,
      functionDepth,
    };
    this.scopes.push(record);
    const node: ScopeNode = {
      record,
      parent,
      children: [],
      byName: new Map(),
      byId: new Map(),
      statements: null,
      statementIndex: new Map(),
      exclude: [],
      nextChildOrdinal: 0,
      bodyOwner,
    };
    parent?.children.push(node);
    return node;
  }

  private setStatementList(scope: ScopeNode, owner: ts.Node, statements: readonly ts.Statement[]) {
    scope.statements = statements;
    scope.bodyOwner = owner;
    statements.forEach((statement, index) => scope.statementIndex.set(statement, index));
  }

  /** Innermost scope containing a source position (exclusions respected). */
  private scopeAt(position: number): ScopeNode {
    let scope = this.moduleScope;
    for (;;) {
      const next = scope.children.find(
        (child) =>
          child.record.span.start <= position &&
          position < child.record.span.end &&
          !child.exclude.some((range) => range.start <= position && position < range.end),
      );
      if (next === undefined) return scope;
      scope = next;
    }
  }

  // ── Binding declaration + merge table (§3) ───────────────────────────────

  private newBinding(
    scope: ScopeNode,
    name: string,
    declarationOrder: number,
    kind: DeclarationKind,
    nameNode: ts.Node,
    initializing: boolean,
    slot: DeclarationSlot | null,
    importInfo: ImportInfo | null,
  ): MutableBinding {
    const span = this.spanOfNode(nameNode);
    const id: BindingId = { scope: scope.record.id, name, declarationOrder };
    const origin: BindingOrigin = { form: 'local' };
    const value: ValueKind = 'plain';
    const classifiedBy: ClassificationSource = 'syntax';
    const binding: MutableBinding = {
      id,
      declarations: [{ kind, span, initializing }],
      value,
      origin,
      declarationSpan: span,
      classifiedBy,
      role: null,
      scope,
      declarationSlot: slot,
      hasImplementation: kind === 'function' && initializing,
      importInfo,
    };
    scope.byName.set(name, id);
    scope.byId.set(bindingKey(id), binding);
    this.authoredBindings.push(binding);
    this.recordDeclarationBinding(nameNode, binding);
    return binding;
  }

  private recordDeclarationBinding(nameNode: ts.Node, binding: MutableBinding): void {
    if (ts.isIdentifier(nameNode)) this.declarationBinding.set(nameNode, binding);
  }

  private addDeclaration(
    binding: MutableBinding,
    kind: DeclarationKind,
    nameNode: ts.Node,
    initializing: boolean,
  ): void {
    binding.declarations.push({ kind, span: this.spanOfNode(nameNode), initializing });
    if (kind === 'function' && initializing) binding.hasImplementation = true;
    this.recordDeclarationBinding(nameNode, binding);
  }

  /**
   * Declare one name, applying §3's merge table. Returns the binding identity
   * this declaration contributes to (a recovered duplicate is a new identity).
   */
  private declareBinding(
    scope: ScopeNode,
    name: string,
    kind: DeclarationKind,
    nameNode: ts.Node,
    initializing: boolean,
    slot: DeclarationSlot | null,
    importInfo: ImportInfo | null,
  ): MutableBinding {
    const existingId = scope.byName.get(name);
    const existing = existingId === undefined ? undefined : scope.byId.get(bindingKey(existingId));
    if (existing === undefined) {
      return this.newBinding(scope, name, 0, kind, nameNode, initializing, slot, importInfo);
    }

    const kinds = new Set(existing.declarations.map((declaration) => declaration.kind));
    const existingImport = kinds.has('import');
    const existingLexical = [...kinds].some((declarationKind) =>
      LEXICAL_KINDS.has(declarationKind),
    );
    const lexicalNew = LEXICAL_KINDS.has(kind);
    const importNew = kind === 'import';
    let recovery: 'duplicate' | 'conflict' | 'import-conflict' | null = null;
    if (existingImport && !importNew) {
      recovery = 'import-conflict';
    } else if (importNew) {
      recovery = 'import-conflict';
    } else if (lexicalNew && existingLexical) {
      recovery = 'duplicate';
    } else if (lexicalNew && !existingLexical) {
      recovery = 'conflict';
    } else if (!lexicalNew && existingLexical) {
      recovery = 'conflict';
    } else if (kind === 'param' && kinds.has('param')) {
      recovery = 'duplicate';
    } else if (kind === 'function' && initializing && existing.hasImplementation) {
      recovery = 'conflict';
    }

    if (recovery === null || recovery === 'conflict') {
      this.addDeclaration(existing, kind, nameNode, initializing);
      if (recovery === 'conflict') {
        this.report(
          'OEIR_DECLARATION_CONFLICT',
          `declaration of '${name}' conflicts with an existing ${[...kinds].join('+')} declaration in the same scope`,
          nameNode,
        );
      }
      return existing;
    }

    // Illegal duplicates are recovered as a second identity so one bad
    // declaration never rewrites the identity of the legal one.
    const duplicate = this.newBinding(
      scope,
      name,
      existing.id.declarationOrder + 1,
      kind,
      nameNode,
      initializing,
      slot,
      importInfo,
    );
    // Preserve the caller-facing record kind (newBinding already added one).
    this.report(
      recovery === 'duplicate' ? 'OEIR_DUPLICATE_DECLARATION' : 'OEIR_IMPORT_CONFLICT',
      recovery === 'duplicate'
        ? `duplicate ${kind} declaration of '${name}' in the same scope`
        : `module-scope import '${name}' conflicts with a local declaration`,
      nameNode,
    );
    return duplicate;
  }

  /** Declare every name a binding pattern introduces (destructuring, §4). */
  private declarePattern(
    scope: ScopeNode,
    name: ts.BindingName,
    kind: DeclarationKind,
    initializing: boolean,
    slot: DeclarationSlot | null,
    propParam = false,
  ): void {
    if (ts.isIdentifier(name)) {
      const binding = this.declareBinding(scope, name.text, kind, name, initializing, slot, null);
      if (propParam) {
        binding.origin = { form: 'prop-param' };
        binding.value = 'prop';
        binding.classifiedBy = 'syntax';
      }
      return;
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        this.declarePattern(scope, element.name, kind, true, slot);
      }
      return;
    }
    if (ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isOmittedExpression(element)) continue;
        this.declarePattern(scope, element.name, kind, true, slot);
      }
    }
  }

  // ── Imports (§6) ─────────────────────────────────────────────────────────

  private declareImports(): void {
    for (const statement of this.sf.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause === undefined) continue;
      const clauseTypeOnly = clause.isTypeOnly ?? false;
      if (clause.name !== undefined) {
        this.declareImportName(clause.name, specifier, null, 'default', clauseTypeOnly);
      }
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          this.declareImportName(
            element.name,
            specifier,
            element.propertyName?.text ?? element.name.text,
            'named',
            clauseTypeOnly || (element.isTypeOnly ?? false),
          );
        }
      } else if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        this.declareImportName(bindings.name, specifier, null, 'namespace', clauseTypeOnly);
      }
    }
  }

  private declareImportName(
    local: ts.Identifier,
    specifier: string,
    importedName: string | null,
    form: ImportInfo['form'],
    typeOnly: boolean,
  ): void {
    const importInfo: ImportInfo = { specifier, importedName, form, typeOnly };
    const binding = this.declareBinding(
      this.moduleScope,
      local.text,
      'import',
      local,
      true,
      null,
      importInfo,
    );
    binding.origin = { form: 'import', specifier, importedName };
    binding.importInfo = importInfo;

    const classifier = this.options.importClassifier;
    const role: SymbolRole | undefined = typeOnly
      ? 'type'
      : classifier?.classifySymbol(specifier, importedName);
    const hostValue = typeOnly ? undefined : classifier?.classifyValue(specifier, importedName);
    if (typeOnly) {
      binding.value = 'unknown';
      binding.classifiedBy = 'syntax';
      binding.role = 'type';
      return;
    }
    if (hostValue !== undefined) {
      binding.value = hostValue;
      binding.classifiedBy = 'host-classifier';
    } else if (role === 'factory' || role === 'namespace') {
      // A factory or a namespace is an ordinary callable/object value; it is
      // NOT the reactive value the factory produces (§6 table row 1).
      binding.value = 'plain';
      binding.classifiedBy = 'host-classifier';
    } else if (role === 'type') {
      binding.value = 'unknown';
      binding.classifiedBy = 'host-classifier';
    } else {
      binding.value = 'unknown';
      binding.classifiedBy = role === undefined ? 'unresolved' : 'host-classifier';
    }
    binding.role = role ?? (hostValue !== undefined ? 'value' : null);
  }

  // ── var hoisting / statement pre-declaration ─────────────────────────────

  /** Declare every `var` declaration of a function/module body in its var scope. */
  private hoistVars(root: ts.Node, target: ScopeNode): void {
    const visit = (node: ts.Node): void => {
      if (isScopeFunctionNode(node) || ts.isClassLike(node)) return;
      if (ts.isVariableDeclarationList(node)) {
        if (isVarDeclarationList(node)) {
          for (const declaration of node.declarations) {
            this.declarePattern(target, declaration.name, 'var', false, null);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
  }

  private predeclareStatementList(scope: ScopeNode, statements: readonly ts.Statement[]): void {
    statements.forEach((statement, index) => {
      this.predeclareStatement(scope, statement, { statementIndex: index, declaratorIndex: 0 });
    });
  }

  private predeclareStatement(
    scope: ScopeNode,
    statement: ts.Statement,
    slot: DeclarationSlot,
  ): void {
    if (ts.isFunctionDeclaration(statement)) {
      if (statement.name !== undefined) {
        this.declareBinding(
          scope,
          statement.name.text,
          'function',
          statement.name,
          statement.body !== undefined,
          slot,
          null,
        );
      }
      return;
    }
    if (ts.isClassDeclaration(statement)) {
      if (statement.name !== undefined) {
        this.declareBinding(scope, statement.name.text, 'class', statement.name, true, slot, null);
      }
      return;
    }
    if (ts.isVariableStatement(statement)) {
      const list = statement.declarationList;
      if (isVarDeclarationList(list)) return; // hoisted by hoistVars
      const kind = lexicalKindOf(list);
      list.declarations.forEach((declaration, index) => {
        this.declarePattern(scope, declaration.name, kind, declaration.initializer !== undefined, {
          statementIndex: slot.statementIndex,
          declaratorIndex: index,
        });
      });
      return;
    }
    if (ts.isEnumDeclaration(statement)) {
      this.report(
        'OEIR_UNSUPPORTED_DECLARATION',
        'namespace/enum merging is outside the function-component model; fail closed',
        statement,
      );
      return;
    }
    if (ts.isModuleDeclaration(statement)) {
      this.report(
        'OEIR_UNSUPPORTED_DECLARATION',
        'namespace/enum merging is outside the function-component model; fail closed',
        statement,
      );
      return;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      this.report(
        'OEIR_UNSUPPORTED_DECLARATION',
        'import-equals is outside the function-component model; fail closed',
        statement,
      );
      return;
    }
    if (ts.isExportAssignment(statement) && statement.isExportEquals) {
      this.report(
        'OEIR_UNSUPPORTED_DECLARATION',
        'export-equals is outside the function-component model; fail closed',
        statement,
      );
    }
  }

  // ── Statement walking: build all scopes of the module ────────────────────

  private walkStatement(statement: ts.Statement, scope: ScopeNode): void {
    if (ts.isVariableStatement(statement)) {
      const list = statement.declarationList;
      for (const declaration of list.declarations) {
        const binding = this.declarationBinding.get(declaration.name);
        if (binding !== undefined) this.classifyInitializer(binding, declaration.initializer);
        this.walkExpression(scope, declaration.initializer);
        this.walkBindingNameExpressions(scope, declaration.name);
      }
      return;
    }
    if (ts.isFunctionDeclaration(statement)) {
      this.buildFunctionScope(statement, scope);
      return;
    }
    if (ts.isClassDeclaration(statement)) {
      this.buildClassScope(statement, scope);
      return;
    }
    if (ts.isBlock(statement)) {
      this.buildBlock(statement, scope);
      return;
    }
    if (ts.isExpressionStatement(statement)) {
      this.walkExpression(scope, statement.expression);
      return;
    }
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
      this.walkExpression(scope, statement.expression);
      return;
    }
    if (ts.isIfStatement(statement)) {
      this.walkExpression(scope, statement.expression);
      this.walkEmbeddedStatement(statement.thenStatement, scope);
      if (statement.elseStatement !== undefined) {
        this.walkEmbeddedStatement(statement.elseStatement, scope);
      }
      return;
    }
    if (ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
      this.walkExpression(scope, statement.expression);
      this.walkEmbeddedStatement(statement.statement, scope);
      return;
    }
    if (ts.isForStatement(statement)) {
      this.buildForScope(statement, scope);
      return;
    }
    if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
      this.buildForScope(statement, scope);
      return;
    }
    if (ts.isSwitchStatement(statement)) {
      this.buildSwitchScope(statement, scope);
      return;
    }
    if (ts.isTryStatement(statement)) {
      this.buildBlock(statement.tryBlock, scope);
      if (statement.catchClause !== undefined) this.buildCatchScope(statement.catchClause, scope);
      if (statement.finallyBlock !== undefined) this.buildBlock(statement.finallyBlock, scope);
      return;
    }
    if (ts.isLabeledStatement(statement)) {
      this.report(
        'OEIR_UNSUPPORTED_LABEL',
        'labels are outside the function-component model; fail closed',
        statement.label,
      );
      this.walkEmbeddedStatement(statement.statement, scope);
      return;
    }
    if (ts.isWithStatement(statement)) {
      this.report(
        'OEIR_DYNAMIC_SCOPE',
        'with introduces dynamic scope; forbidden by the static resolution model',
        statement,
      );
      this.walkExpression(scope, statement.expression);
      this.walkEmbeddedStatement(statement.statement, scope);
      return;
    }
    if (ts.isExportAssignment(statement)) {
      if (!statement.isExportEquals) this.walkExpression(scope, statement.expression);
      return;
    }
    // ImportDeclaration, ExportDeclaration, enums/namespaces/import-equals
    // (diagnosed by predeclare), break/continue/empty/debugger: no scoped
    // content beyond what has already been built.
  }

  private walkEmbeddedStatement(statement: ts.Statement, scope: ScopeNode): void {
    if (ts.isBlock(statement)) {
      this.buildBlock(statement, scope);
      return;
    }
    this.walkStatement(statement, scope);
  }

  private buildBlock(block: ts.Block, parent: ScopeNode): void {
    const scope = this.createScope('block', this.spanOfNode(block), block, parent, false);
    this.setStatementList(scope, block, block.statements);
    this.predeclareStatementList(scope, block.statements);
    for (const statement of block.statements) this.walkStatement(statement, scope);
  }

  /** Start of a function scope: after decorators (evaluated outside the body). */
  private functionScopeStart(node: ScopeFunctionNode): number {
    if (ts.canHaveDecorators(node)) {
      const decorators = ts.getDecorators(node);
      const last = decorators?.[decorators.length - 1];
      if (last !== undefined) return last.getEnd();
    }
    return node.getStart(this.sf);
  }

  private buildFunctionScope(node: ScopeFunctionNode, parent: ScopeNode): void {
    const scope = this.createScope(
      'function',
      this.spanOfRange(this.functionScopeStart(node), node.getEnd()),
      node,
      parent,
      true,
    );
    // A named function expression binds its own name only inside its scope
    // (§4); a function declaration's name is the enclosing scope's binding.
    if (ts.isFunctionExpression(node) && node.name !== undefined) {
      this.declareBinding(scope, node.name.text, 'function', node.name, true, null, null);
    }
    for (const parameter of node.parameters) {
      const propParam = ts.isIdentifier(parameter.name) && this.propsParameters.has(parameter);
      if (ts.isIdentifier(parameter.name) && parameter.name.text === 'this') continue;
      this.declarePattern(scope, parameter.name, 'param', true, null, propParam);
      this.walkBindingNameExpressions(scope, parameter.name);
      this.walkExpression(scope, parameter.initializer);
    }
    const body = node.body;
    if (body === undefined) return; // overload signature: no body scope content
    if (ts.isBlock(body)) {
      this.setStatementList(scope, body, body.statements);
      this.hoistVars(body, scope);
      this.predeclareStatementList(scope, body.statements);
      for (const statement of body.statements) this.walkStatement(statement, scope);
      return;
    }
    this.walkExpression(scope, body);
  }

  private buildStaticBlockScope(node: ts.ClassStaticBlockDeclaration, parent: ScopeNode): void {
    const scope = this.createScope('function', this.spanOfNode(node), node, parent, true);
    this.setStatementList(scope, node.body, node.body.statements);
    this.hoistVars(node.body, scope);
    this.predeclareStatementList(scope, node.body.statements);
    for (const statement of node.body.statements) this.walkStatement(statement, scope);
  }

  private buildForScope(
    node: ts.ForStatement | ts.ForOfStatement | ts.ForInStatement,
    parent: ScopeNode,
  ): void {
    const scope = this.createScope('for', this.spanOfNode(node), node, parent, false);
    const initializer = node.initializer;
    if (initializer !== undefined && ts.isVariableDeclarationList(initializer)) {
      if (!isVarDeclarationList(initializer)) {
        const kind = lexicalKindOf(initializer);
        for (const declaration of initializer.declarations) {
          this.declarePattern(scope, declaration.name, kind, true, null);
        }
      }
      for (const declaration of initializer.declarations) {
        this.walkExpression(scope, declaration.initializer);
        this.walkBindingNameExpressions(scope, declaration.name);
      }
    } else if (initializer !== undefined) {
      this.walkExpression(scope, initializer);
    }
    if (ts.isForStatement(node)) {
      this.walkExpression(scope, node.condition);
      this.walkExpression(scope, node.incrementor);
      this.walkEmbeddedStatement(node.statement, scope);
      return;
    }
    // For-of / for-in: the RHS is evaluated in the ENCLOSING scope, before the
    // per-iteration environment exists. Exclude it so `scopeAt` stays correct.
    const right = node.expression;
    scope.exclude.push({ start: right.getStart(this.sf), end: right.getEnd() });
    this.walkExpression(parent, right);
    this.walkEmbeddedStatement(node.statement, scope);
  }

  private buildSwitchScope(node: ts.SwitchStatement, parent: ScopeNode): void {
    const caseBlock = node.caseBlock;
    const start = caseBlock.getStart(this.sf);
    const scope = this.createScope(
      'switch',
      this.spanOfRange(start, node.getEnd()),
      node,
      parent,
      false,
    );
    // The discriminant runs in the enclosing scope; the scope starts at `{`.
    this.walkExpression(parent, node.expression);
    for (const clause of caseBlock.clauses) {
      if (ts.isCaseClause(clause)) this.walkExpression(scope, clause.expression);
      clause.statements.forEach((statement, index) => {
        this.predeclareStatement(scope, statement, { statementIndex: index, declaratorIndex: 0 });
      });
    }
    for (const clause of caseBlock.clauses) {
      for (const statement of clause.statements) this.walkStatement(statement, scope);
    }
  }

  private buildCatchScope(node: ts.CatchClause, parent: ScopeNode): void {
    const scope = this.createScope('catch', this.spanOfNode(node), node, parent, false);
    if (node.variableDeclaration !== undefined) {
      this.declarePattern(scope, node.variableDeclaration.name, 'catch', true, null);
      this.walkBindingNameExpressions(scope, node.variableDeclaration.name);
    }
    this.buildBlock(node.block, scope);
  }

  private buildClassScope(node: ts.ClassDeclaration | ts.ClassExpression, parent: ScopeNode): void {
    // `extends` and decorators are evaluated in the ENCLOSING scope; the inner
    // class-name binding is not in scope for them (§4).
    for (const decorator of ts.getDecorators(node) ?? []) {
      this.walkExpression(parent, decorator.expression);
    }
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types) this.walkExpression(parent, type.expression);
    }
    // The class scope starts at the `{` so the heritage stays outside it.
    const start = node.members.pos;
    const scope = this.createScope(
      'class',
      this.spanOfRange(start, node.getEnd()),
      node,
      parent,
      false,
    );
    if (node.name !== undefined) {
      this.declareBinding(scope, node.name.text, 'class-name', node.name, true, null, null);
    }
    for (const member of node.members) {
      if (ts.isPropertyDeclaration(member)) {
        for (const decorator of ts.getDecorators(member) ?? []) {
          this.walkExpression(scope, decorator.expression);
        }
        this.walkExpression(scope, member.initializer);
        continue;
      }
      if (ts.isClassStaticBlockDeclaration(member)) {
        this.buildStaticBlockScope(member, scope);
        continue;
      }
      if (
        ts.isMethodDeclaration(member) ||
        ts.isConstructorDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)
      ) {
        this.buildFunctionScope(member, scope);
      }
      // Index signatures and `;` class elements carry no runtime scope content.
    }
  }

  /** Build scopes for function/class expressions nested anywhere in an expression. */
  private walkExpression(scope: ScopeNode, node: ts.Node | undefined): void {
    if (node === undefined) return;
    if (isScopeFunctionNode(node)) {
      this.buildFunctionScope(node, scope);
      return;
    }
    if (ts.isClassExpression(node)) {
      this.buildClassScope(node, scope);
      return;
    }
    ts.forEachChild(node, (child) => {
      if (!ts.isPartOfTypeNode(child)) this.walkExpression(scope, child);
    });
  }

  /** Build scopes for expressions embedded in binding patterns (defaults). */
  private walkBindingNameExpressions(scope: ScopeNode, name: ts.BindingName): void {
    if (ts.isIdentifier(name)) return;
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (element.propertyName !== undefined && ts.isComputedPropertyName(element.propertyName)) {
          this.walkExpression(scope, element.propertyName.expression);
        }
        this.walkBindingNameExpressions(scope, element.name);
        this.walkExpression(scope, element.initializer);
      }
      return;
    }
    if (ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isOmittedExpression(element)) continue;
        this.walkBindingNameExpressions(scope, element.name);
        this.walkExpression(scope, element.initializer);
      }
    }
  }

  // ── Local value classification (§6.1 chain) ──────────────────────────────

  private classifyInitializer(
    binding: MutableBinding,
    initializer: ts.Expression | undefined,
  ): void {
    if (initializer === undefined) return;
    if (binding.origin.form !== 'local') return; // imports and prop-param are fixed
    const value = unwrapExpression(initializer);
    if (ts.isCallExpression(value)) {
      const answer = this.classifyFactoryCall(value);
      if (answer.kind === 'classified') {
        binding.value = answer.call;
        binding.classifiedBy = 'host-classifier';
        return;
      }
      if (answer.kind === 'unanswered') {
        binding.value = 'unknown';
        binding.classifiedBy = 'unresolved';
        return;
      }
    }
    if (ts.isIdentifier(value)) {
      const target = this.lookupAuthored(this.scopeAt(value.getStart(this.sf)), value.text);
      if (target !== undefined) {
        binding.value = target.value;
        binding.classifiedBy = target.classifiedBy;
        // `const s = signal` keeps the import provenance so `s(0)` can still
        // be classified; the alias itself is still an ordinary local value.
        if (target.importInfo !== null) binding.importInfo = target.importInfo;
        if (target.role !== null) binding.role = target.role;
      }
    }
  }

  /**
   * §6.1: `classifySymbol` → `classifyCall` for a direct import;
   * `classifyMember` → `classifyCall` for a namespace member. Nothing is ever
   * inferred from an identifier spelling.
   */
  private classifyFactoryCall(call: ts.CallExpression): CallKindAnswer {
    const classifier = this.options.importClassifier;
    const callee = unwrapExpression(call.expression);
    if (ts.isIdentifier(callee)) {
      const target = this.lookupAuthored(this.scopeAt(callee.getStart(this.sf)), callee.text);
      if (target === undefined || target.importInfo === null) {
        return { kind: 'unclassified' };
      }
      if (target.role !== 'factory') return { kind: 'unanswered' };
      const result = classifier?.classifyCall(
        target.importInfo.specifier,
        target.importInfo.importedName,
      );
      if (result === undefined) return { kind: 'unanswered' };
      return { kind: 'classified', call: result.call };
    }
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const object = callee.expression;
      const target = this.lookupAuthored(this.scopeAt(object.getStart(this.sf)), object.text);
      if (target === undefined || target.importInfo === null) {
        return { kind: 'unclassified' };
      }
      if (target.importInfo.form !== 'namespace') return { kind: 'unanswered' };
      const member = callee.name.text;
      const memberRole = classifier?.classifyMember?.(target.importInfo.specifier, member);
      if (memberRole !== 'factory') return { kind: 'unanswered' };
      const result = classifier?.classifyCall(target.importInfo.specifier, member);
      if (result === undefined) return { kind: 'unanswered' };
      return { kind: 'classified', call: result.call };
    }
    return { kind: 'unclassified' };
  }

  // ── Scope lookup ─────────────────────────────────────────────────────────

  private lookupAuthored(scope: ScopeNode, name: string): MutableBinding | undefined {
    let current: ScopeNode | null = scope;
    while (current !== null) {
      const id = current.byName.get(name);
      if (id !== undefined) return current.byId.get(bindingKey(id));
      current = current.parent;
    }
    return undefined;
  }

  private lookup(scope: ScopeNode, name: string): MutableBinding | undefined {
    return this.lookupAuthored(scope, name) ?? this.builtinBinding(name);
  }

  private builtinBinding(name: string): MutableBinding | undefined {
    if (!this.declaredGlobals.has(name)) return undefined;
    const existing = this.builtins.get(name);
    if (existing !== undefined) return existing;
    const span = emptySpan(this.file);
    const binding: MutableBinding = {
      id: { scope: this.globalScope.record.id, name, declarationOrder: 0 },
      declarations: [],
      value: 'plain',
      origin: { form: 'builtin', name },
      declarationSpan: span,
      classifiedBy: 'syntax',
      role: null,
      scope: this.globalScope,
      declarationSlot: null,
      hasImplementation: false,
      importInfo: null,
    };
    this.builtins.set(name, binding);
    return binding;
  }

  // ── Context-sensitive fail-closed scans (§4) ─────────────────────────────

  /** `eval` anywhere in the module is dynamic scope; `with` is caught per statement. */
  private scanDynamicScope(): void {
    const visit = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        node.text === 'eval' &&
        this.isValueReference(node) &&
        this.lookupAuthored(this.scopeAt(node.getStart(this.sf)), 'eval') === undefined
      ) {
        this.report(
          'OEIR_DYNAMIC_SCOPE',
          'eval introduces dynamic scope; forbidden by the static resolution model',
          node,
        );
      }
      ts.forEachChild(node, (child) => {
        if (!ts.isPartOfTypeNode(child)) visit(child);
      });
    };
    visit(this.sf);
  }

  /**
   * A function component has no `this`/`arguments`/`super`/`new.target`; their
   * presence is diagnostic (§4). Class subtrees are skipped: a class member's
   * `this`/`arguments`/`super` are legal JavaScript, and class authoring is
   * outside this frontend rather than scope-resolved here.
   */
  private scanComponent(component: ComponentFunction): void {
    const visit = (node: ts.Node): void => {
      if (ts.isClassLike(node)) return;
      if (node.kind === ts.SyntaxKind.ThisKeyword) {
        this.report(
          'OEIR_UNSUPPORTED_THIS',
          'a function component has no `this`; use the props parameter',
          node,
        );
        return;
      }
      if (node.kind === ts.SyntaxKind.SuperKeyword) {
        this.report(
          'OEIR_UNSUPPORTED_SUPER',
          '`super` is not part of the function-component model',
          node,
        );
        return;
      }
      if (isNewTarget(node)) {
        this.report(
          'OEIR_UNSUPPORTED_NEW_TARGET',
          '`new.target` is not part of the function-component model',
          node,
        );
        return;
      }
      if (ts.isIdentifier(node) && node.text === 'arguments' && this.isValueReference(node)) {
        this.report(
          'OEIR_UNSUPPORTED_ARGUMENTS',
          '`arguments` is not part of the function-component model',
          node,
        );
        return;
      }
      ts.forEachChild(node, (child) => {
        if (!ts.isPartOfTypeNode(child)) visit(child);
      });
    };
    visit(component);
  }

  // ── Identifier reads, captures, dependencies (§5) ────────────────────────

  /**
   * True when an identifier occurrence in an expression is a *value read*
   * (not a property name, declaration name, label, JSX attribute name, ...).
   * JSX component tags (`<Row/>`) are reads; intrinsic tags (`<div>`) are not.
   */
  private isValueReference(identifier: ts.Identifier): boolean {
    const parent = identifier.parent as ts.Node | undefined;
    if (parent === undefined) return false;
    if (ts.isPropertyAccessExpression(parent)) return parent.expression === identifier;
    if (ts.isQualifiedName(parent)) return false;
    if (ts.isPropertyAssignment(parent)) return parent.name !== identifier;
    if (ts.isShorthandPropertyAssignment(parent)) return parent.name === identifier;
    if (ts.isBindingElement(parent)) return false;
    if (ts.isVariableDeclaration(parent)) return parent.name !== identifier;
    if (ts.isParameter(parent)) return parent.name !== identifier;
    if (
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)
    ) {
      return false;
    }
    if (
      ts.isImportClause(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isImportEqualsDeclaration(parent) ||
      ts.isExportSpecifier(parent) ||
      ts.isNamespaceExport(parent)
    ) {
      return false;
    }
    if (ts.isLabeledStatement(parent)) return false;
    if (ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) return false;
    if (ts.isJsxAttribute(parent)) return false;
    if (ts.isJsxNamespacedName(parent)) return false;
    if (ts.isMetaProperty(parent)) return false;
    if (
      ts.isJsxOpeningElement(parent) ||
      ts.isJsxSelfClosingElement(parent) ||
      ts.isJsxClosingElement(parent)
    ) {
      if (parent.tagName !== identifier) return false;
      // `<Row/>` references a binding; `<div>`/`<my-el>` are intrinsic tags.
      return /^[A-Z]/.test(identifier.text);
    }
    return true;
  }

  /** §5 captures: the read sits inside more function boundaries than the binding. */
  private isCapture(readScope: ScopeNode, binding: MutableBinding): boolean {
    if (binding.origin.form === 'builtin') return false;
    return readScope.record.functionDepth > binding.scope.record.functionDepth;
  }

  // ── TDZ: the provable bound (§4.1) ───────────────────────────────────────

  /** Control flow / nested execution that makes the straight-line bound unprovable. */
  private isTdzBarrier(node: ts.Node): boolean {
    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isCaseClause(node) ||
      ts.isDefaultClause(node) ||
      ts.isTryStatement(node) ||
      ts.isCatchClause(node) ||
      ts.isLabeledStatement(node) ||
      ts.isWithStatement(node) ||
      isScopeFunctionNode(node)
    ) {
      return true;
    }
    if (ts.isConditionalExpression(node)) return true;
    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind;
      return (
        kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.QuestionQuestionToken
      );
    }
    return false;
  }

  /**
   * A static TDZ diagnostic is emitted ONLY inside this provable bound: a
   * same-scope straight-line read at or before the declaring (statement,
   * declarator) slot. Everything uncertain stays non-diagnostic (§4.1).
   */
  private tdzDiagnostic(
    identifier: ts.Identifier,
    binding: MutableBinding,
  ): ScopeDiagnostic | null {
    const slot = binding.declarationSlot;
    if (slot === null) return null;
    const scope = binding.scope;
    if (scope.statements === null) return null;
    const kinds = binding.declarations.map((declaration) => declaration.kind);
    if (!kinds.every((kind) => kind === 'let' || kind === 'const' || kind === 'class')) {
      return null;
    }
    if (this.scopeAt(identifier.getStart(this.sf)) !== scope) return null;
    const owner = scope.bodyOwner;
    if (owner === null) return null;

    let current: ts.Node = identifier;
    let declarator: ts.VariableDeclaration | null = null;
    for (;;) {
      const parent = current.parent as ts.Node | undefined;
      if (parent === undefined) return null;
      if (parent === owner) break;
      if (this.isTdzBarrier(parent)) return null;
      if (ts.isVariableDeclaration(parent)) declarator = parent;
      current = parent;
    }
    if (!ts.isStatement(current)) return null;
    const statementIndex = scope.statementIndex.get(current);
    if (statementIndex === undefined) return null;

    let readDeclaratorIndex = 0;
    let readStatementIndex = statementIndex;
    if (declarator !== null) {
      const list = declarator.parent;
      if (ts.isVariableDeclarationList(list) && ts.isVariableStatement(list.parent)) {
        const statement = list.parent;
        const index = scope.statementIndex.get(statement);
        if (index === undefined) return null;
        readStatementIndex = index;
        readDeclaratorIndex = list.declarations.indexOf(declarator);
      }
    }
    const provable =
      readStatementIndex < slot.statementIndex ||
      (readStatementIndex === slot.statementIndex && readDeclaratorIndex <= slot.declaratorIndex);
    if (!provable) return null;
    return {
      severity: 'error',
      code: 'OEIR_TDZ_READ',
      message:
        `block-scoped '${binding.id.name}' is read before its declaration initializes it ` +
        '(provable same-block straight-line read; TDZ otherwise stays a runtime state)',
      span: this.spanOfNode(identifier),
      origin: 'source',
    };
  }

  // ── §5 expression resolution ─────────────────────────────────────────────

  resolveExpression(node: ts.Node, mode: EvaluationMode): ExpressionResolution {
    const reads: ResolvedRead[] = [];
    const seen = new Set<string>();
    const diagnostics: ScopeDiagnostic[] = [];
    const unresolvedReads: UnresolvedRead[] = [];
    const dependencies: BindingId[] = [];
    const captures: BindingId[] = [];
    const resolvedByKey = new Map<string, MutableBinding>();

    const visit = (current: ts.Node): void => {
      if (ts.isIdentifier(current) && this.isValueReference(current)) {
        const start = current.getStart(this.sf);
        const readScope = this.scopeAt(start);
        const binding = this.lookup(readScope, current.text);
        if (binding === undefined) {
          const span = this.spanOfNode(current);
          unresolvedReads.push({ name: current.text, span });
          diagnostics.push({
            severity: 'error',
            code: 'OEIR_UNRESOLVED_BINDING',
            message: `unresolved identifier '${current.text}'`,
            span,
            origin: 'source',
          });
          return;
        }
        if (binding.importInfo?.typeOnly === true || binding.role === 'type') {
          diagnostics.push({
            severity: 'error',
            code: 'OEIR_TYPE_ONLY_VALUE_READ',
            message: `type-only binding '${current.text}' is read in a value position`,
            span: this.spanOfNode(current),
            origin: 'source',
          });
        }
        const tdz = this.tdzDiagnostic(current, binding);
        if (tdz !== null) diagnostics.push(tdz);
        const key = bindingKey(binding.id);
        if (!seen.has(key)) {
          seen.add(key);
          resolvedByKey.set(key, binding);
          reads.push({
            name: current.text,
            binding: binding.id,
            value: binding.value,
            span: this.spanOfNode(current),
            capture: this.isCapture(readScope, binding),
          });
        }
        return;
      }
      ts.forEachChild(current, (child) => {
        if (!ts.isPartOfTypeNode(child)) visit(child);
      });
    };
    visit(node);

    if (TRACKED_MODES.has(mode)) {
      for (const read of reads) {
        const binding = resolvedByKey.get(bindingKey(read.binding));
        if (binding === undefined) continue;
        if (REACTIVE_KINDS.has(binding.value)) {
          dependencies.push(binding.id);
          continue;
        }
        if (binding.value === 'unknown') {
          diagnostics.push({
            severity: 'error',
            code: 'OEIR_UNCLASSIFIED_BINDING',
            message:
              `binding '${binding.id.name}' has an unknown value kind in a tracked slot; ` +
              `${describeOrigin(binding.origin)}`,
            span: read.span,
            origin: 'source',
          });
        }
      }
    }
    for (const read of reads) {
      if (read.capture) captures.push(read.binding);
    }
    return {
      mode,
      reads,
      captures,
      dependencies,
      unresolvedReads,
      diagnostics,
    };
  }

  resolveIdentifier(node: ts.Identifier): ResolvedBinding | undefined {
    const scope = this.scopeAt(node.getStart(this.sf));
    const binding =
      this.lookupAuthored(scope, node.text) ?? this.builtinBinding(node.text) ?? undefined;
    return binding === undefined ? undefined : this.viewOf(binding);
  }

  // ── Facade ───────────────────────────────────────────────────────────────

  private viewOf(binding: MutableBinding): ResolvedBinding {
    const existing = this.bindingViews.get(binding);
    if (existing !== undefined) return existing;
    const declarations = [...binding.declarations].sort(
      (left, right) => left.span.start - right.span.start,
    );
    const view: ResolvedBinding = Object.freeze({
      id: binding.id,
      declarations: Object.freeze(declarations),
      value: binding.value,
      origin: binding.origin,
      declarationSpan: declarations[0]?.span ?? binding.declarationSpan,
      classifiedBy: binding.classifiedBy,
      role: binding.role,
    });
    this.bindingViews.set(binding, view);
    return view;
  }

  private facade(): ResolvedModule {
    // Materialise the frozen views after the build so value kinds are final.
    const bindings = this.authoredBindings.map((binding) => this.viewOf(binding));
    return {
      moduleId: this.file,
      file: this.file,
      sourceFile: this.sf,
      diagnostics: Object.freeze([...this.diagnostics]),
      scopes: Object.freeze([...this.scopes]),
      bindings: Object.freeze(bindings),
      resolveExpression: (node, mode) => this.resolveExpression(node, mode),
      resolveIdentifier: (node) => this.resolveIdentifier(node),
    };
  }
}

function describeOrigin(origin: BindingOrigin): string {
  if (origin.form === 'import') {
    const imported = origin.importedName === null ? 'default' : origin.importedName;
    return `import '${imported}' from '${origin.specifier}' was not classified by the host`;
  }
  if (origin.form === 'builtin') return `builtin global '${origin.name}' has no reactive kind`;
  if (origin.form === 'prop-param') return 'the props parameter';
  return 'the binding has no host classification';
}

/**
 * Resolve the lexical scopes, declarations, reads, captures and dependencies of
 * one module. Pure: the caller hands the parsed source file and the host
 * classifier; the resolver never touches a `ts.Program`, the filesystem or
 * ambient state.
 */
export function resolveModule(
  sourceFile: ts.SourceFile,
  options: ResolveModuleOptions = {},
): ResolvedModule {
  return new ScopeResolver(sourceFile, options).run();
}
