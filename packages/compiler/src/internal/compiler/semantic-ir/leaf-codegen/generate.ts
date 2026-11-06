/**
 * Compiler-private leaf-codegen prototype — NOT G1 evidence.
 *
 * Status: pre-M05 prototype. G1 is NOT claimed; M03 (expression erasure /
 * identity / source maps) and M04 (ownership / recipes / insertion sites) are
 * absent. Host-supplied `values` stand in for the missing expression frontend;
 * see `docs/architecture/m05-g1-leaf-prototype.md` for the full claim boundary.
 *
 * This module takes an M02 `IrComponent` and emits concrete DOM instructions —
 * not a serialized program for a generic interpreter: no `__partProgram`, no
 * JSON, no node-kind walker in the artifact.
 *
 * Supported shapes: intrinsic elements, fragments, static text, dynamic text,
 * static attributes, plain `attribute` / `boolean` / `property` channel
 * bindings, and one level of condition with a branch-local refresh closure
 * (nested conditions are refused). Deliberately out of scope (each refusal is a
 * coded diagnostic): component refs, lists, recipes/insertion sites, children
 * projection, `event`/`ref`/`key` bindings, dynamic `class`/`style`/`innerHTML`,
 * ownership/region identity, claim/SSR and source maps.
 *
 * Fail-closed policy (defense in depth — this generator re-checks its input and
 * never assumes a builder or validator already did):
 *
 * - security sinks come from the ONE canonical protocol policy
 *   (`@openelement/protocol/forbidden-sinks` and
 *   `@openelement/protocol/stream-frame-policy`): event-handler names,
 *   `innerHTML`/`srcdoc`, raw/stream-frame-forbidden tags, URL-carrying
 *   attributes, and prototype-pollution property names are refused before any
 *   emission. There is no value-level runtime screening in this prototype:
 *   URL-carrying values are screened only when they are static.
 * - authored expressions are parsed with the repository `typescript` package
 *   before being embedded verbatim: TypeScript/JSX-only syntax, assignments,
 *   updates, `await`/`yield` and unparsable sources are coded diagnostics.
 * - generated internal identifiers are `__oe_`-prefixed, and authored binding
 *   names that collide with that namespace (or are invalid strict-mode binding
 *   names) are refused.
 * - the assembled artifact is syntax-checked with `new Function(body)`; a
 *   failure becomes `OEIR_LEAF_INVALID_ARTIFACT` instead of flowing downstream.
 *
 * Compiler-private: nothing here is exported from a package entry point, and
 * `semantic-ir/` is excluded from the published compiler surface. No production
 * build path consumes it.
 */

import ts from 'typescript';
import { forbiddenSinkReason, isSafeAttributeName } from '@openelement/protocol/forbidden-sinks';
import {
  STREAM_FRAME_FORBIDDEN_TAGS,
  STREAM_FRAME_URL_ATTRIBUTES,
  unsafeStreamFrameAttribute,
} from '@openelement/protocol/stream-frame-policy';
import type {
  IrAttribute,
  IrComponent,
  IrCondition,
  IrDiagnostic,
  IrElement,
  IrNode,
  IrSpan,
  IrStaticAttribute,
  IrText,
} from '../types.ts';

/**
 * The generated artifact. `body` is executable in a `new Function` scope.
 *
 * `requiredValues` is the host contract for this prototype: resources are not
 * evaluated here (M03 is absent), so the host must supply every top-level
 * binding the artifact reads. `mount` and `update` validate the object and throw
 * `OEIR_LEAF_MISSING_VALUE` / `OEIR_LEAF_INVALID_VALUES` errors at runtime when
 * the contract is broken.
 */
export interface LeafRecipe {
  /** Function declarations without `export`, safe to evaluate directly. */
  readonly body: string;
  /** The same declarations as an ESM module. */
  readonly module: string;
  /** IR ids of dynamic text nodes refreshed by `update`. */
  readonly trackedTextIds: readonly string[];
  /**
   * IR ids of dynamic text nodes evaluated once where they are created: at
   * mount for top-level nodes, at branch build time for nodes inside a
   * condition branch (a rebuilt branch evaluates its snapshots again).
   */
  readonly snapshotTextIds: readonly string[];
  /** Top-level host-value binding names every `mount`/`update` must provide. */
  readonly requiredValues: readonly string[];
}

export interface LeafCodegenResult {
  readonly recipe: LeafRecipe | null;
  readonly diagnostics: readonly IrDiagnostic[];
}

interface EmitState {
  readonly mountLines: string[];
  readonly renderLines: string[];
  readonly disposeLines: string[];
  /** Multi-line inner function declarations, already indented for mount scope. */
  readonly helpers: string[];
  readonly topLevelVars: string[];
  readonly mountBindings: Set<string>;
  readonly renderBindings: Set<string>;
  /** Every top-level binding name the artifact reads (the host contract). */
  readonly requiredValues: Set<string>;
  readonly trackedTextIds: string[];
  readonly snapshotTextIds: string[];
  readonly diagnostics: IrDiagnostic[];
  /** Shared across branch sub-states so generated variable names stay unique. */
  readonly counter: { value: number };
  /** When set, top-level nodes are collected into this array instead of appended. */
  readonly topLevelSink: string | null;
  /** Branch builders cannot host another condition's selector. */
  readonly allowCondition: boolean;
}

/** The `__oe_` namespace is generated-code-owned; authored names may not enter it. */
const INTERNAL_IDENTIFIER_PREFIX = '__oe_';
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;
const ATTRIBUTE_PATTERN = /^[A-Za-z_:][A-Za-z0-9_:.-]*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** Names valid as a `let` binding in strict mode but not in an ESM module. */
const MODULE_RESERVED_BINDINGS: ReadonlySet<string> = new Set(['await']);
const URL_ATTRIBUTES: ReadonlySet<string> = new Set(STREAM_FRAME_URL_ATTRIBUTES);
const FORBIDDEN_TAGS: ReadonlySet<string> = new Set(STREAM_FRAME_FORBIDDEN_TAGS);

const BINDING_PROBE_CACHE = new Map<string, boolean>();

function error(code: string, message: string, span: IrSpan): IrDiagnostic {
  return { severity: 'error', code, message, span, origin: 'ir-object' };
}

function nextVar(state: EmitState, prefix: string): string {
  return `${prefix}${state.counter.value++}`;
}

/** Top-level nodes are appended to their parent, or collected by a branch builder. */
function appendStmt(
  state: EmitState,
  parentVar: string,
  variable: string,
  topLevel: boolean,
): string {
  return topLevel && state.topLevelSink !== null
    ? `${state.topLevelSink}.push(${variable});`
    : `${parentVar}.appendChild(${variable});`;
}

/** Whether `name` can be a `let` binding in strict-mode JavaScript. */
function isStrictBindingName(name: string): boolean {
  const cached = BINDING_PROBE_CACHE.get(name);
  if (cached !== undefined) return cached;
  let valid = true;
  try {
    // Compilation only: `new Function` parses the body and never runs it.
    new Function(`"use strict"; let ${name} = 1;`);
  } catch {
    valid = false;
  }
  BINDING_PROBE_CACHE.set(name, valid);
  return valid;
}

/**
 * Check one host-value binding name. Authored names are destructured verbatim
 * (this prototype has no expression rewriting), so a name must be a valid
 * strict-mode binding that cannot collide with the generated `__oe_` namespace.
 */
function collectBindings(
  reads: readonly { readonly name: string }[],
  target: Set<string>,
  span: IrSpan,
  state: EmitState,
): void {
  for (const read of reads) {
    const name = read.name;
    if (name.startsWith(INTERNAL_IDENTIFIER_PREFIX)) {
      state.diagnostics.push(
        error(
          'OEIR_LEAF_RESERVED_BINDING',
          `expression reads '${name}', which collides with the generated artifact's reserved ` +
            `'${INTERNAL_IDENTIFIER_PREFIX}' identifier namespace; rename the binding`,
          span,
        ),
      );
      continue;
    }
    if (!IDENTIFIER_PATTERN.test(name) || MODULE_RESERVED_BINDINGS.has(name)) {
      state.diagnostics.push(
        error(
          'OEIR_LEAF_INVALID_BINDING',
          `expression reads '${name}', which is not a valid JavaScript binding name for the ` +
            'generated artifact; rename the binding',
          span,
        ),
      );
      continue;
    }
    if (!isStrictBindingName(name)) {
      state.diagnostics.push(
        error(
          'OEIR_LEAF_INVALID_BINDING',
          `expression reads '${name}', which is not a valid strict-mode JavaScript binding name ` +
            '(reserved word or restricted identifier); rename the binding',
          span,
        ),
      );
      continue;
    }
    target.add(name);
    state.requiredValues.add(name);
  }
}

/** TS/JSX-only syntax that cannot be emitted as plain JavaScript. */
function tsOnlySyntaxReason(node: ts.Node): string | null {
  if (ts.isAsExpression(node)) return "'as' type assertions";
  if (ts.isSatisfiesExpression(node)) return "'satisfies' expressions";
  if (ts.isNonNullExpression(node)) return "non-null '!' assertions";
  if (ts.isTypeAssertionExpression(node)) return 'angle-bracket type assertions';
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
    return 'JSX';
  }
  const typed = node as ts.Node & {
    readonly typeArguments?: ts.NodeArray<ts.Node>;
    readonly typeParameters?: ts.NodeArray<ts.Node>;
  };
  if (typed.typeArguments !== undefined && typed.typeArguments.length > 0) return 'type arguments';
  if (typed.typeParameters !== undefined && typed.typeParameters.length > 0) {
    return 'type parameters';
  }
  if (ts.isParameter(node) && node.type !== undefined) return 'parameter type annotations';
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.type !== undefined) {
    return 'return type annotations';
  }
  return null;
}

/** Statement-level / side-effecting syntax this prototype refuses. */
function unsafeExpressionReason(node: ts.Node): string | null {
  // The public TS 6 declarations expose the assignment token range rather than
  // the `isAssignmentExpression` helper; the range covers `=` and every compound
  // assignment.
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return 'assignments';
  }
  if (ts.isPostfixUnaryExpression(node)) return "'++'/'--' updates";
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return "'++'/'--' updates";
  }
  if (ts.isAwaitExpression(node)) return "'await'";
  if (ts.isYieldExpression(node)) return "'yield'";
  return null;
}

function parseDiagnostics(source: ts.SourceFile): readonly ts.Diagnostic[] {
  return (source as unknown as { readonly parseDiagnostics: readonly ts.Diagnostic[] })
    .parseDiagnostics;
}

/**
 * The one expression node of `const __oe_check = (\n<source>\n);`, or null when
 * the wrapped source is not exactly one parenthesized initializer. The newlines
 * around the source are deliberate: an authored trailing line comment still
 * parses here, and the artifact self-check refuses it later instead of this
 * parse producing a misleading "invalid expression" for a comment.
 */
function wrappedExpressionNode(source: ts.SourceFile): ts.Expression | null {
  if (source.statements.length !== 1) return null;
  const statement = source.statements[0]!;
  if (!ts.isVariableStatement(statement)) return null;
  const declarations = statement.declarationList.declarations;
  if (declarations.length !== 1) return null;
  const declaration = declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.name.text !== '__oe_check') return null;
  const initializer = declaration.initializer;
  if (initializer === undefined || !ts.isParenthesizedExpression(initializer)) return null;
  return initializer.expression;
}

function createExpressionSource(source: string, scriptKind: ts.ScriptKind): ts.SourceFile {
  return ts.createSourceFile(
    scriptKind === ts.ScriptKind.TSX ? '__oe_leaf_expression.tsx' : '__oe_leaf_expression.ts',
    `const __oe_check = (\n${source}\n);`,
    ts.ScriptTarget.ES2022,
    true,
    scriptKind,
  );
}

/**
 * Parse and screen one authored expression before it is embedded verbatim.
 *
 * `typescript` parsing replaces the old `;`/newline character blacklist: multi
 * line expressions, template literals and regular expressions containing `;`
 * are legal, while statement injection (`;`, a second declarator), TypeScript
 * syntax and assignments/updates/await/yield become coded diagnostics.
 */
function checkExpression(source: string, span: IrSpan, state: EmitState): string {
  if (source.length === 0) {
    state.diagnostics.push(
      error('OEIR_LEAF_UNSAFE_EXPRESSION', 'expression is empty and cannot be emitted', span),
    );
    return source;
  }

  let parsed = createExpressionSource(source, ts.ScriptKind.TSX);
  let parsedAsTypeScript = false;
  if (parseDiagnostics(parsed).length > 0) {
    // A TSX parse failure plus a clean .ts parse means TS-only syntax (e.g.
    // angle-bracket assertions or a generic arrow). Neither parse succeeding
    // means the source is not a JavaScript expression at all.
    const asTypeScript = createExpressionSource(source, ts.ScriptKind.TS);
    if (parseDiagnostics(asTypeScript).length > 0) {
      const first = parseDiagnostics(parsed)[0]?.messageText;
      state.diagnostics.push(
        error(
          'OEIR_LEAF_INVALID_EXPRESSION',
          `expression '${source}' does not parse as a single JavaScript expression` +
            (first === undefined ? '' : ` (${String(first)})`),
          span,
        ),
      );
      return source;
    }
    parsed = asTypeScript;
    parsedAsTypeScript = true;
  }

  const expression = wrappedExpressionNode(parsed);
  if (expression === null) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_INVALID_EXPRESSION',
        `expression '${source}' is not a single JavaScript expression (statement injection is ` +
          'refused)',
        span,
      ),
    );
    return source;
  }

  if (parsedAsTypeScript) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_TS_SYNTAX',
        `expression '${source}' contains TypeScript-only syntax that cannot be emitted as ` +
          'plain JavaScript; the M03 expression frontend that lowers it is absent',
        span,
      ),
    );
    return source;
  }

  let tsSyntax: string | null = null;
  let unsafe: string | null = null;
  const visit = (node: ts.Node): void => {
    if (tsSyntax === null) tsSyntax = tsOnlySyntaxReason(node);
    if (unsafe === null) unsafe = unsafeExpressionReason(node);
    if (tsSyntax !== null && unsafe !== null) return;
    ts.forEachChild(node, visit);
  };
  visit(expression);

  if (tsSyntax !== null) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_TS_SYNTAX',
        `expression '${source}' contains ${tsSyntax}, which TypeScript erasure would have to ` +
          'remove; the M03 expression frontend is absent',
        span,
      ),
    );
    return source;
  }
  if (unsafe !== null) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_UNSAFE_EXPRESSION',
        `expression '${source}' contains ${unsafe}; this prototype only embeds pure value ` +
          'expressions',
        span,
      ),
    );
    return source;
  }
  return source;
}

function emitStaticAttribute(
  attribute: IrStaticAttribute,
  elementVar: string,
  state: EmitState,
): void {
  const name = attribute.name;
  if (!ATTRIBUTE_PATTERN.test(name)) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_INVALID_ATTRIBUTE',
        `attribute name '${name}' is not a plain attribute name`,
        attribute.span,
      ),
    );
    return;
  }
  // Static names go through the SAME canonical safe-attribute predicate every
  // production boundary uses: on*, innerHTML and srcdoc never reach an element.
  if (!isSafeAttributeName(name)) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_UNSAFE_ATTRIBUTE',
        `static attribute name '${name}' is a canonical forbidden sink (event handler, ` +
          'innerHTML or srcdoc); it is refused instead of emitted',
        attribute.span,
      ),
    );
    return;
  }
  const lowerName = name.toLowerCase();
  // Static URL values are the one place this prototype can value-screen: use
  // the canonical stream-frame policy (entity/control-char decoding included).
  if (URL_ATTRIBUTES.has(lowerName) && unsafeStreamFrameAttribute(name, attribute.value)) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_UNSAFE_ATTRIBUTE',
        `static URL attribute ${JSON.stringify(name)} carries a script-bearing scheme in ` +
          `${JSON.stringify(attribute.value)}; it is refused instead of emitted`,
        attribute.span,
      ),
    );
    return;
  }
  state.mountLines.push(
    `    ${elementVar}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(attribute.value)});`,
  );
}

function emitDynamicAttribute(
  attribute: Extract<IrAttribute, { kind: 'dynamic-attribute' }>,
  elementVar: string,
  state: EmitState,
): void {
  const name = attribute.name;
  const channel = attribute.channel;

  // Binding channels (event/ref/key) are not DOM value channels in this slice.
  if (channel === 'event' || channel === 'ref' || channel === 'key') {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `dynamic attribute '${name}' via the '${channel}' channel is not generated by this ` +
          'slice (event/ref/key bindings need M04/M07 machinery)',
        attribute.span,
      ),
    );
    return;
  }
  if (!ATTRIBUTE_PATTERN.test(name)) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_INVALID_ATTRIBUTE',
        `attribute name '${name}' is not a plain attribute name`,
        attribute.span,
      ),
    );
    return;
  }
  // Names first: innerHTML/srcdoc/on* are canonical forbidden sinks regardless
  // of how the IR classified their channel (forged IR included).
  if (!isSafeAttributeName(name)) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_UNSAFE_ATTRIBUTE',
        `dynamic attribute name '${name}' is a canonical forbidden sink (event handler, ` +
          'innerHTML or srcdoc); it is refused instead of emitted',
        attribute.span,
      ),
    );
    return;
  }
  const lowerName = name.toLowerCase();
  // A dynamic URL-carrying value cannot be screened at compile time, and this
  // prototype has no runtime guard, so the whole channel fails closed.
  if (URL_ATTRIBUTES.has(lowerName)) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_URL_SINK_UNSUPPORTED',
        `dynamic URL-carrying attribute ${JSON.stringify(name)} is refused: the value cannot be ` +
          'screened at compile time and this slice has no runtime URL guard',
        attribute.span,
      ),
    );
    return;
  }
  // The class/style/html value shapes need the production coercions
  // (classValueOf/styleValueOf/trustedHtmlValue) this slice does not ship.
  if (channel === 'class' || channel === 'style' || channel === 'html') {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_UNSUPPORTED_VALUE_SHAPE',
        `dynamic attribute '${name}' uses the '${channel}' value shape, which this slice does ` +
          'not support; only static class/style values are emitted',
        attribute.span,
      ),
    );
    return;
  }
  if (channel !== 'property' && channel !== 'boolean' && channel !== 'attribute') {
    // Runtime-only forged channel after the typed checks above.
    state.diagnostics.push(
      error(
        'OEIR_LEAF_INVALID_ATTRIBUTE',
        `dynamic attribute '${name}' has an unknown channel '${String(channel)}'`,
        attribute.span,
      ),
    );
    return;
  }

  // Channel-specific canonical deny list (defense in depth for forged IR: the
  // builder's classifier never returns a forbidden name for these channels).
  const sinkKind = channel === 'property' ? 'prop' : channel === 'boolean' ? 'bool' : 'attr';
  const sinkReason = forbiddenSinkReason(sinkKind, name);
  if (sinkReason !== null) {
    state.diagnostics.push(
      error(
        channel === 'property' ? 'OEIR_LEAF_UNSAFE_PROPERTY' : 'OEIR_LEAF_UNSAFE_ATTRIBUTE',
        `dynamic ${sinkKind} binding '${name}' is refused: ${sinkReason}`,
        attribute.span,
      ),
    );
    return;
  }

  const expression = checkExpression(attribute.expression.source, attribute.span, state);
  collectBindings(
    attribute.expression.reads,
    attribute.tracked ? state.renderBindings : state.mountBindings,
    attribute.span,
    state,
  );

  // Every embedded expression is parenthesized so a top-level comma operator
  // keeps its authored meaning inside the generated call/assignment.
  const value = `(${expression})`;
  let statement: string;
  if (channel === 'property') {
    statement = `${elementVar}[${JSON.stringify(name)}] = ${value};`;
  } else if (channel === 'boolean') {
    statement = `__oe_setBoolean(${elementVar}, ${JSON.stringify(name)}, ${value});`;
  } else {
    statement = `__oe_setAttribute(${elementVar}, ${JSON.stringify(name)}, ${value});`;
  }
  if (attribute.tracked) state.renderLines.push(statement);
  else state.mountLines.push(statement);
}

function emitAttributes(
  attributes: readonly IrAttribute[],
  elementVar: string,
  state: EmitState,
): void {
  const seen = new Set<string>();
  for (const attribute of attributes) {
    // HTML attribute names are case-insensitive: `data-x` and `DATA-X` are one
    // binding, and emitting both would silently pick a parser winner.
    const lowerName = attribute.name.toLowerCase();
    if (seen.has(lowerName)) {
      state.diagnostics.push(
        error(
          'OEIR_LEAF_DUPLICATE_ATTRIBUTE',
          `attribute '${attribute.name}' is bound more than once on the same element ` +
            '(attribute names are case-insensitive)',
          attribute.span,
        ),
      );
      continue;
    }
    seen.add(lowerName);
    if (attribute.kind === 'static-attribute') emitStaticAttribute(attribute, elementVar, state);
    else emitDynamicAttribute(attribute, elementVar, state);
  }
}

function emitElement(
  element: IrElement,
  parentVar: string,
  state: EmitState,
  topLevel: boolean,
): void {
  if (!TAG_PATTERN.test(element.tag)) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_INVALID_TAG',
        `tag '${element.tag}' is not an intrinsic element name`,
        element.span,
      ),
    );
    return;
  }
  // Raw-text and stream-frame-forbidden tags are rejected from the ONE canonical
  // stream-frame policy; `script`/`style` would otherwise execute/apply raw
  // authored text, and iframe/object/embed/base/meta/link are navigation sinks.
  if (FORBIDDEN_TAGS.has(element.tag.toLowerCase())) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_UNSAFE_TAG',
        `<${element.tag}> is a canonical forbidden/raw-text tag; it is refused instead of ` +
          'emitted into the artifact',
        element.span,
      ),
    );
    return;
  }
  const variable = nextVar(state, '__oe_e');
  state.mountLines.push(
    `    const ${variable} = __oe_getDocument().createElement(${JSON.stringify(element.tag)});`,
  );
  emitAttributes(element.attributes, variable, state);
  state.mountLines.push(`    ${appendStmt(state, parentVar, variable, topLevel)}`);
  if (topLevel) state.topLevelVars.push(variable);
  for (const child of element.children) emitNode(child, variable, state, false);
}

function emitText(text: IrText, parentVar: string, state: EmitState, topLevel: boolean): void {
  const variable = nextVar(state, '__oe_t');
  state.mountLines.push(
    `    const ${variable} = __oe_getDocument().createTextNode(${JSON.stringify(text.value)});`,
  );
  state.mountLines.push(`    ${appendStmt(state, parentVar, variable, topLevel)}`);
  if (topLevel) state.topLevelVars.push(variable);
}

function emitDynamicText(
  node: Extract<IrNode, { kind: 'dynamic-text' }>,
  parentVar: string,
  state: EmitState,
  topLevel: boolean,
): void {
  const expression = checkExpression(node.expression.source, node.span, state);
  const bindings = node.tracked ? state.renderBindings : state.mountBindings;
  collectBindings(node.expression.reads, bindings, node.span, state);

  const variable = nextVar(state, '__oe_t');
  state.mountLines.push(`    const ${variable} = __oe_getDocument().createTextNode("");`);
  state.mountLines.push(`    ${appendStmt(state, parentVar, variable, topLevel)}`);
  if (topLevel) state.topLevelVars.push(variable);

  // `__oe_display` mirrors the production `displayValue`: null/undefined render
  // as the empty string instead of the literal "undefined".
  const assignment = `${variable}.nodeValue = __oe_display((${expression}));`;
  if (node.tracked) {
    state.renderLines.push(assignment);
    state.trackedTextIds.push(node.id);
  } else {
    state.mountLines.push(`    ${assignment}`);
    state.snapshotTextIds.push(node.id);
  }
}

function branchState(parent: EmitState): EmitState {
  return {
    mountLines: [],
    renderLines: [],
    disposeLines: [],
    helpers: parent.helpers,
    topLevelVars: [],
    mountBindings: new Set(),
    renderBindings: new Set(),
    requiredValues: parent.requiredValues,
    // Branch text ids belong to the same recipe.
    trackedTextIds: parent.trackedTextIds,
    snapshotTextIds: parent.snapshotTextIds,
    diagnostics: parent.diagnostics,
    counter: parent.counter,
    topLevelSink: '__oe_nodes',
    allowCondition: false,
  };
}

function indentLines(lines: readonly string[], indent: string): string[] {
  return lines.map((line) => `${indent}${line.trimStart()}`);
}

function emitCondition(node: IrCondition, parentVar: string, state: EmitState): void {
  const test = checkExpression(node.test.source, node.test.span, state);
  // Snapshot conditions are ambiguous with host-driven updates (the audit's
  // P2-05): a local is "evaluated once where it appears", so it cannot drive a
  // branch that this slice re-selects on every update. Fail closed instead.
  if (node.test.kind === 'local') {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_SNAPSHOT_CONDITION',
        `condition test '${node.test.source}' is a local snapshot expression; this slice only ` +
          'selects branches from tracked/computed/literal tests',
        node.test.span,
      ),
    );
    return;
  }
  const testBindings = new Set<string>();
  collectBindings(node.test.reads, testBindings, node.test.span, state);

  const prefix = nextVar(state, '__oe_c');
  const anchor = `${prefix}_anchor`;
  const branchVar = `${prefix}_branch`;
  const nodesVar = `${prefix}_nodes`;
  const refreshVar = `${prefix}_refresh`;
  const buildFn = `${prefix}_build`;
  const selectFn = `${prefix}_select`;

  const consequent = branchState(state);
  for (const child of node.consequent) emitNode(child, parentVar, consequent, true);
  const alternate = branchState(state);
  if (node.alternate !== null) {
    for (const child of node.alternate) emitNode(child, parentVar, alternate, true);
  }

  state.mountLines.push(`    const ${anchor} = __oe_getDocument().createTextNode("");`);
  state.mountLines.push(`    ${parentVar}.appendChild(${anchor});`);
  state.mountLines.push(`    let ${branchVar} = null;`);
  state.mountLines.push(`    let ${nodesVar} = [];`);
  state.mountLines.push(`    let ${refreshVar} = function () {};`);

  // Each branch builder returns both its DOM nodes and a refresh closure over
  // its own tracked values. `__oe_current` is a mount-scope `let`, so both
  // closures see the newest values after `update`.
  const branchLines = (branch: EmitState): string[] => [
    ...indentLines(destructuring(branch.mountBindings), '      '),
    ...indentLines(branch.mountLines, '      '),
    '      __oe_refresh = function () {',
    ...indentLines(destructuring(branch.renderBindings), '        '),
    ...indentLines(branch.renderLines, '        '),
    '      };',
  ];

  const build = [
    `  function ${buildFn}(__oe_name) {`,
    '    const __oe_nodes = [];',
    '    let __oe_refresh = function () {};',
    '    if (__oe_name === "c") {',
    ...branchLines(consequent),
    '    } else {',
    ...branchLines(alternate),
    '    }',
    '    return { nodes: __oe_nodes, refresh: __oe_refresh };',
    '  }',
  ].join('\n');
  const select = [
    `  function ${selectFn}() {`,
    ...destructuring(testBindings).map((line) => `    ${line}`),
    `    const __oe_wanted = (${test}) ? "c" : "a";`,
    `    if (__oe_wanted !== ${branchVar}) {`,
    `      for (const __oe_node of ${nodesVar}) ${parentVar}.removeChild(__oe_node);`,
    `      const __oe_built = ${buildFn}(__oe_wanted);`,
    `      ${nodesVar} = __oe_built.nodes;`,
    `      ${refreshVar} = __oe_built.refresh;`,
    `      for (const __oe_node of ${nodesVar}) ${parentVar}.insertBefore(__oe_node, ${anchor});`,
    `      ${branchVar} = __oe_wanted;`,
    '    }',
    '  }',
  ].join('\n');
  state.helpers.push(build, select);

  // Select first (it may swap the active branch), then refresh whatever branch
  // is active now. Both run inside renderDynamic for every update.
  state.renderLines.push(`${selectFn}();`, `${refreshVar}();`);
  state.disposeLines.push(
    `for (const __oe_node of ${nodesVar}) ${parentVar}.removeChild(__oe_node);`,
    `${parentVar}.removeChild(${anchor});`,
  );
}

function emitNode(node: IrNode, parentVar: string, state: EmitState, topLevel: boolean): void {
  switch (node.kind) {
    case 'element':
      emitElement(node, parentVar, state, topLevel);
      return;
    case 'fragment':
      for (const child of node.children) emitNode(child, parentVar, state, topLevel);
      return;
    case 'text':
      emitText(node, parentVar, state, topLevel);
      return;
    case 'dynamic-text':
      emitDynamicText(node, parentVar, state, topLevel);
      return;
    case 'condition':
      if (!state.allowCondition) {
        state.diagnostics.push(
          error(
            'OEIR_LEAF_NESTED_CONDITION',
            'a nested condition inside a condition branch is not generated by this slice',
            node.span,
          ),
        );
        return;
      }
      emitCondition(node, parentVar, state);
      return;
    default:
      state.diagnostics.push(
        error(
          'OEIR_LEAF_UNSUPPORTED_NODE',
          `node kind '${node.kind}' is not generated by this slice`,
          node.span,
        ),
      );
  }
}

function destructuring(bindings: ReadonlySet<string>): string[] {
  if (bindings.size === 0) return [];
  return [`const { ${[...bindings].sort().join(', ')} } = __oe_current;`];
}

/** Top-level helpers shared by every generated mount. Kept tiny on purpose. */
const ARTIFACT_HELPERS = [
  // The document reference lives in this top-level helper on purpose: an
  // authored host binding named `document` is destructured inside mount scope,
  // and any free `document` use there would be shadowed (or hit its TDZ).
  'function __oe_getDocument() {',
  '  return document;',
  '}',
  'function __oe_display(__oe_value) {',
  '  return __oe_value === null || __oe_value === undefined ? "" : String(__oe_value);',
  '}',
  'function __oe_setAttribute(__oe_element, __oe_name, __oe_value) {',
  '  if (__oe_value === null || __oe_value === undefined) {',
  '    __oe_element.removeAttribute(__oe_name);',
  '    return;',
  '  }',
  '  __oe_element.setAttribute(__oe_name, String(__oe_value));',
  '}',
  'function __oe_setBoolean(__oe_element, __oe_name, __oe_value) {',
  '  if (__oe_value) __oe_element.setAttribute(__oe_name, "");',
  '  else __oe_element.removeAttribute(__oe_name);',
  '}',
  'function __oe_requireValues(__oe_values, __oe_required) {',
  '  if (__oe_values === null || typeof __oe_values !== "object") {',
  '    throw new Error("OEIR_LEAF_INVALID_VALUES: the mount/update argument must be a non-null object");',
  '  }',
  '  for (const __oe_name of __oe_required) {',
  '    if (!(__oe_name in __oe_values)) {',
  '      throw new Error("OEIR_LEAF_MISSING_VALUE: " + __oe_name);',
  '    }',
  '  }',
  '}',
].join('\n');

/** Emit a leaf recipe for one M02 component. */
export function generateLeafRecipe(component: IrComponent): LeafCodegenResult {
  const state: EmitState = {
    mountLines: [],
    renderLines: [],
    disposeLines: [],
    helpers: [],
    topLevelVars: [],
    mountBindings: new Set(),
    renderBindings: new Set(),
    requiredValues: new Set(),
    trackedTextIds: [],
    snapshotTextIds: [],
    diagnostics: [],
    counter: { value: 0 },
    topLevelSink: null,
    allowCondition: true,
  };

  if (component.roots.length === 0) {
    return {
      recipe: null,
      diagnostics: [
        error('OEIR_LEAF_EMPTY_OUTPUT', 'component has no roots to mount', component.span),
      ],
    };
  }
  for (const root of component.roots) emitNode(root, '__oe_host', state, true);

  if (state.diagnostics.length > 0) {
    return { recipe: null, diagnostics: state.diagnostics };
  }

  const requiredValues = [...state.requiredValues].sort();
  const lines = [
    ARTIFACT_HELPERS,
    '',
    'function mount(__oe_host, __oe_values) {',
    `  const __oe_required = ${JSON.stringify(requiredValues)};`,
    '  __oe_requireValues(__oe_values, __oe_required);',
    '  let __oe_current = __oe_values;',
    '  let __oe_disposed = false;',
    ...destructuring(state.mountBindings).map((line) => `  ${line}`),
    ...state.mountLines.map((line) => `  ${line.trimStart()}`),
    ...state.helpers,
    '  function __oe_renderDynamic() {',
    ...destructuring(state.renderBindings).map((line) => `    ${line}`),
    ...state.renderLines.map((line) => `    ${line.trimStart()}`),
    '  }',
    '  __oe_renderDynamic();',
    '  function __oe_update(__oe_values) {',
    '    if (__oe_disposed) return;',
    '    __oe_requireValues(__oe_values, __oe_required);',
    '    __oe_current = __oe_values;',
    '    __oe_renderDynamic();',
    '  }',
    '  function __oe_dispose() {',
    '    if (__oe_disposed) return;',
    '    __oe_disposed = true;',
    ...state.disposeLines.map((line) => `    ${line.trimStart()}`),
    ...state.topLevelVars.map((variable) => `    __oe_host.removeChild(${variable});`),
    '  }',
    '  return { update: __oe_update, dispose: __oe_dispose };',
    '}',
  ];
  const body = lines.join('\n');
  const header = '// <generated by openElement semantic-ir leaf-codegen; do not edit>\n';

  // Artifact self-check: a generator bug becomes a coded diagnostic here instead
  // of a host-language SyntaxError in the browser/consumer. `new Function` only
  // compiles — nothing is executed.
  try {
    new Function(body);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return {
      recipe: null,
      diagnostics: [
        error(
          'OEIR_LEAF_INVALID_ARTIFACT',
          `generated artifact failed its syntax self-check: ${detail}`,
          component.span,
        ),
      ],
    };
  }

  return {
    recipe: {
      body,
      module: `${header}${body.replace(/^function mount\(/m, 'export function mount(')}`,
      trackedTextIds: state.trackedTextIds,
      snapshotTextIds: state.snapshotTextIds,
      requiredValues,
    },
    diagnostics: [],
  };
}
