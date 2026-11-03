/**
 * TSX → Semantic IR, spike scope (Alpha16a M02).
 *
 * This builder reads the TypeScript AST **only to walk the authored shape**. It
 * does not lower, transform, evaluate or re-emit anything, and it produces no
 * runtime artifact. Expressions leave this module as authored source slices
 * with a span and a resolved read list (see `types.ts`).
 *
 * The admitted grammar is intentionally tiny — exactly enough for the five
 * approved worked examples. Anything else fails with a coded diagnostic instead
 * of being silently ignored: a feasibility spike is only meaningful if its
 * negative cases are explicit.
 */

import ts from 'typescript';
import { typescriptParser } from '../semantic-core/parse-module.ts';
import type {
  IrAttribute,
  IrBindingKind,
  IrBuildResult,
  IrChildrenProjection,
  IrComponent,
  IrComponentRef,
  IrCondition,
  IrDiagnostic,
  IrDiagnosticOrigin,
  IrDynamicAttribute,
  IrDynamicText,
  IrElement,
  IrExpression,
  IrExpressionKind,
  IrFragment,
  IrInsertionSite,
  IrList,
  IrNode,
  IrOwner,
  IrRead,
  IrRecipe,
  IrResource,
  IrResourceKind,
  IrSpan,
  IrText,
} from './types.ts';

/** Signals the spike understands as reactive sources. */
const REACTIVE_BINDINGS: ReadonlySet<IrBindingKind> = new Set(['signal', 'computed', 'prop']);

interface Scope {
  readonly bindings: Map<string, IrBindingKind>;
}

interface BuildState {
  readonly file: string;
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly diagnostics: IrDiagnostic[];
  readonly scope: Scope;
  readonly componentId: string;
  propsParam: string | null;
  readonly recipes: IrRecipe[];
  readonly owners: IrOwner[];
  recipeNames: Map<string, string>;
  nodeCounter: number;
  ownerCounter: number;
}

function spanOf(sf: ts.SourceFile, file: string, node: ts.Node): IrSpan {
  const start = node.getStart(sf);
  const end = node.getEnd();
  const lc = sf.getLineAndCharacterOfPosition(start);
  return { file, start, end, line: lc.line + 1, column: lc.character + 1 };
}

function fallbackSpan(file: string): IrSpan {
  return { file, start: 0, end: 0, line: 1, column: 1 };
}

function error(
  state: BuildState,
  code: string,
  message: string,
  node: ts.Node,
  origin: IrDiagnosticOrigin = 'source',
): void {
  state.diagnostics.push({
    severity: 'error',
    code,
    message,
    span: spanOf(state.sourceFile, state.file, node),
    origin,
  });
}

function warning(state: BuildState, code: string, message: string, node: ts.Node): void {
  state.diagnostics.push({
    severity: 'warning',
    code,
    message,
    span: spanOf(state.sourceFile, state.file, node),
    origin: 'source',
  });
}

function nextOwner(state: BuildState, parent: string | null, reason: IrOwner['reason']): IrOwner {
  state.ownerCounter += 1;
  const owner: IrOwner = {
    id: `${state.componentId}#owner${state.ownerCounter}`,
    parent,
    reason,
  };
  state.owners.push(owner);
  return owner;
}

/** Unwrap parentheses and `as` casts without touching the authored source. */
function unwrap(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Literal-only expressions carry no reactive meaning. */
function isLiteralExpression(node: ts.Node): boolean {
  const value = unwrap(node);
  return (
    ts.isStringLiteral(value) ||
    ts.isNumericLiteral(value) ||
    ts.isNoSubstitutionTemplateLiteral(value) ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword ||
    ts.isRegularExpressionLiteral(value)
  );
}

/** Collect identifiers the expression reads, resolved against the component scope. */
function collectReads(state: BuildState, node: ts.Node): IrRead[] {
  const reads = new Map<string, IrBindingKind>();
  const localDeclarations = new Set<string>();

  const visit = (current: ts.Node): void => {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      for (const parameter of current.parameters) {
        if (ts.isIdentifier(parameter.name)) localDeclarations.add(parameter.name.text);
      }
    }
    if (ts.isIdentifier(current)) {
      const parent = current.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === current) ||
        (ts.isPropertyAssignment(parent) && parent.name === current) ||
        (ts.isJsxAttribute(parent) && parent.name === current);
      if (!isPropertyName) {
        const name = current.text;
        if (!localDeclarations.has(name)) {
          const binding = state.scope.bindings.get(name);
          if (binding !== undefined) reads.set(name, binding);
          else if (state.propsParam === name) reads.set(name, 'prop');
        }
      }
    }
    ts.forEachChild(current, visit);
  };

  visit(unwrap(node));
  return [...reads.entries()].map(([name, binding]) => ({ name, binding }));
}

function buildExpression(state: BuildState, node: ts.Node, kind: IrExpressionKind): IrExpression {
  const authored = unwrap(node);
  return {
    kind,
    source: state.source.slice(authored.getStart(state.sourceFile), authored.getEnd()),
    span: spanOf(state.sourceFile, state.file, authored),
    reads: collectReads(state, authored),
  };
}

/** Classify a dynamic JSX expression by what it actually reads. */
function classifyDynamic(state: BuildState, node: ts.Node): IrExpressionKind {
  if (isLiteralExpression(node)) return 'literal';
  const reads = collectReads(state, node);
  if (reads.some((read) => REACTIVE_BINDINGS.has(read.binding))) return 'tracked';
  return 'local';
}

/** Attribute channel for an intrinsic element. */
function attributeChannel(name: string): IrDynamicAttribute['channel'] {
  if (name === 'key') return 'key';
  if (name === 'ref') return 'ref';
  if (/^on[A-Z]/.test(name)) return 'event';
  return 'property';
}

function buildAttributes(state: BuildState, node: ts.JsxAttributes): IrAttribute[] {
  const attributes: IrAttribute[] = [];
  for (const property of node.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      error(
        state,
        'OEIR_SPREAD_UNSUPPORTED',
        'spread attributes are outside the M02 spike grammar',
        property,
      );
      continue;
    }
    const name = property.name.getText(state.sourceFile);
    const initializer = property.initializer;
    if (initializer === undefined) {
      attributes.push({
        kind: 'static-attribute',
        name,
        value: 'true',
        span: spanOf(state.sourceFile, state.file, property),
      });
      continue;
    }
    if (ts.isStringLiteral(initializer)) {
      attributes.push({
        kind: 'static-attribute',
        name,
        value: initializer.text,
        span: spanOf(state.sourceFile, state.file, property),
      });
      continue;
    }
    if (!ts.isJsxExpression(initializer) || initializer.expression === undefined) {
      continue;
    }
    const expressionNode = initializer.expression;
    const channel = attributeChannel(name);
    const expressionKind: IrExpressionKind =
      channel === 'event'
        ? 'handler'
        : channel === 'key'
          ? 'key'
          : classifyDynamic(state, expressionNode);
    attributes.push({
      kind: 'dynamic-attribute',
      name,
      channel,
      expression: buildExpression(state, expressionNode, expressionKind),
      // Only a genuinely tracked read is tracked: a literal or a plain local is
      // not, which is what keeps `value={1}` legal and unclaimed.
      tracked: expressionKind === 'tracked',
      span: spanOf(state.sourceFile, state.file, property),
    });
  }
  return attributes;
}

function isComponentTag(tag: string): boolean {
  return /^[A-Z]/.test(tag);
}

function buildComponentRef(
  state: BuildState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  path: string,
): IrComponentRef {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const tag = opening.tagName.getText(state.sourceFile);
  const name = tag.split('.')[0] ?? tag;
  if (!state.scope.bindings.has(name) && name !== state.propsParam) {
    state.scope.bindings.set(name, 'unknown');
  }
  const childNodes = ts.isJsxElement(node) ? node.children : undefined;
  if (
    childNodes !== undefined &&
    childNodes.some((child) => !ts.isJsxText(child) || child.text.trim() !== '')
  ) {
    error(
      state,
      'OEIR_COMPONENT_CHILDREN_UNSUPPORTED',
      'children on a component reference are outside the M02 spike grammar',
      node,
    );
  }
  return {
    kind: 'component-ref',
    id: path,
    name,
    props: buildAttributes(state, opening.attributes),
    span: spanOf(state.sourceFile, state.file, node),
  };
}

function buildChildren(
  state: BuildState,
  children: ts.NodeArray<ts.JsxChild>,
  path: string,
): IrNode[] {
  const out: IrNode[] = [];
  let index = 0;
  for (const child of children) {
    if (ts.isJsxText(child)) {
      const text = child.text.replace(/\s+/g, ' ');
      if (text.trim() === '') continue;
      const node: IrText = {
        kind: 'text',
        id: `${path}.${index}`,
        value: text,
        span: spanOf(state.sourceFile, state.file, child),
      };
      out.push(node);
      index += 1;
      continue;
    }
    const built = buildChild(state, child, `${path}.${index}`);
    if (built !== null) {
      out.push(built);
      index += 1;
    }
  }
  return out;
}

function buildChild(state: BuildState, child: ts.Node, path: string): IrNode | null {
  if (ts.isJsxText(child)) return null;

  // A component/element child.
  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
    const opening = ts.isJsxElement(child) ? child.openingElement : child;
    const tag = opening.tagName.getText(state.sourceFile);
    if (isComponentTag(tag)) return buildComponentRef(state, child, path);
    const children = ts.isJsxElement(child) ? buildChildren(state, child.children, path) : [];
    const node: IrElement = {
      kind: 'element',
      id: path,
      tag,
      attributes: buildAttributes(state, opening.attributes),
      children,
      span: spanOf(state.sourceFile, state.file, child),
    };
    return node;
  }

  if (ts.isJsxFragment(child)) {
    const node: IrFragment = {
      kind: 'fragment',
      id: path,
      children: buildChildren(state, child.children, path),
      span: spanOf(state.sourceFile, state.file, child),
    };
    return node;
  }

  if (!ts.isJsxExpression(child) || child.expression === undefined) return null;

  const expression = unwrap(child.expression);

  // `{props.children}` — a projectable recipe.
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === state.propsParam &&
    expression.name.text === 'children'
  ) {
    const owner = nextOwner(state, `${state.componentId}#owner1`, 'insertion');
    const projection: IrChildrenProjection = {
      kind: 'children-projection',
      id: path,
      ownerId: owner.id,
      span: spanOf(state.sourceFile, state.file, expression),
    };
    return projection;
  }

  // `{recipe}` — an insertion site for a previously declared recipe.
  if (ts.isIdentifier(expression)) {
    const recipeId = state.recipeNames.get(expression.text);
    if (recipeId !== undefined) {
      const owner = nextOwner(state, `${state.componentId}#owner1`, 'insertion');
      const site: IrInsertionSite = {
        kind: 'insertion-site',
        id: path,
        recipeId,
        ownerId: owner.id,
        span: spanOf(state.sourceFile, state.file, expression),
      };
      return site;
    }
  }

  // `{cond ? a : b}` / `{cond && a}`
  if (ts.isConditionalExpression(expression) || ts.isBinaryExpression(expression)) {
    const binary = ts.isBinaryExpression(expression) ? expression : null;
    const isAnd =
      binary !== null && binary.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
    if (ts.isConditionalExpression(expression) || (isAnd && binary !== null)) {
      const testNode = ts.isConditionalExpression(expression) ? expression.condition : binary!.left;
      const consequentNode = ts.isConditionalExpression(expression)
        ? expression.whenTrue
        : binary!.right;
      const alternateNode = ts.isConditionalExpression(expression)
        ? expression.whenFalse
        : undefined;
      const node: IrCondition = {
        kind: 'condition',
        id: path,
        test: buildExpression(state, testNode, classifyDynamic(state, testNode)),
        consequent: branchNodes(state, consequentNode, `${path}.t`),
        alternate:
          alternateNode === undefined ? null : branchNodes(state, alternateNode, `${path}.f`),
        span: spanOf(state.sourceFile, state.file, expression),
      };
      return node;
    }
  }

  // `{items.map(item => <Row .../>)}`
  const list = tryBuildList(state, expression, path);
  if (list !== null) return list;

  // Anything else is a dynamic text slot.
  const kind = classifyDynamic(state, expression);
  const dynamic: IrDynamicText = {
    kind: 'dynamic-text',
    id: path,
    expression: buildExpression(state, expression, kind),
    tracked: kind === 'tracked',
    span: spanOf(state.sourceFile, state.file, expression),
  };
  return dynamic;
}

/** A branch of a condition: JSX element, fragment, or `null`. */
function branchNodes(state: BuildState, node: ts.Node, path: string): IrNode[] {
  const unwrapped = unwrap(node);
  if (
    unwrapped.kind === ts.SyntaxKind.NullKeyword ||
    unwrapped.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(unwrapped) && unwrapped.text === 'undefined')
  ) {
    return [];
  }
  if (
    ts.isJsxElement(unwrapped) ||
    ts.isJsxSelfClosingElement(unwrapped) ||
    ts.isJsxFragment(unwrapped)
  ) {
    const built = buildChild(state, unwrapped, path);
    return built === null ? [] : [built];
  }
  error(
    state,
    'OEIR_CONDITION_BRANCH_UNSUPPORTED',
    'a conditional branch must be JSX or null in the M02 spike',
    unwrapped,
  );
  return [];
}

/** The `key` binding on an element or component reference, when authored. */
function findKeyAttribute(attributes: readonly IrAttribute[]): IrDynamicAttribute | undefined {
  return attributes.find(
    (attribute): attribute is IrDynamicAttribute =>
      attribute.kind === 'dynamic-attribute' && attribute.channel === 'key',
  );
}

/** `{items.map(item => <Row key={item.id} .../>)}` */
function tryBuildList(state: BuildState, node: ts.Node, path: string): IrList | null {
  if (!ts.isCallExpression(node)) return null;
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  if (node.expression.name.text !== 'map') return null;
  const itemsNode = node.expression.expression;
  const callback = node.arguments[0];
  if (
    callback === undefined ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  ) {
    error(
      state,
      'OEIR_LIST_MAPPER_UNSUPPORTED',
      'a list mapper must be a single inline function',
      node,
    );
    return null;
  }
  const parameter = callback.parameters[0];
  if (parameter === undefined || !ts.isIdentifier(parameter.name)) {
    error(
      state,
      'OEIR_LIST_MAPPER_UNSUPPORTED',
      'a list mapper must take one plain identifier parameter',
      node,
    );
    return null;
  }
  const itemName = parameter.name.text;
  const previous = state.scope.bindings.get(itemName);
  // The item name is not a reactive source; it is a per-entry value.
  state.scope.bindings.set(itemName, 'local');
  const template = branchNodes(state, callback.body, `${path}.item`);
  state.scope.bindings.set(itemName, previous ?? 'local');

  const element = template[0];
  let keyAttribute: IrDynamicAttribute | undefined;
  if (element !== undefined && element.kind === 'element') {
    keyAttribute = findKeyAttribute(element.attributes);
  } else if (element !== undefined && element.kind === 'component-ref') {
    keyAttribute = findKeyAttribute(element.props);
  }

  if (keyAttribute === undefined) {
    warning(
      state,
      'OEIR_UNKEYED_LIST',
      'unkeyed list: positional identity only; add `key` for item identity',
      node,
    );
  }

  const regionOwner = nextOwner(state, `${state.componentId}#owner1`, 'list-item');
  return {
    kind: 'list',
    id: path,
    ownerId: regionOwner.id,
    itemOwner: 'per-entry',
    // The data source keeps its own evaluation semantics: a reactive read stays
    // reactive, an ordinary local stays a snapshot. Forcing this to `local`
    // misrepresented `props.items`.
    items: buildExpression(state, itemsNode, classifyDynamic(state, itemsNode)),
    key: keyAttribute?.expression ?? null,
    template,
    span: spanOf(state.sourceFile, state.file, node),
  };
}

/** Resolve the component to build: a function declaration or an arrow binding. */
function findComponent(state: BuildState): {
  body: ts.ConciseBody;
  parameters: ts.NodeArray<ts.ParameterDeclaration>;
  name: string;
  node: ts.Node;
} | null {
  for (const statement of state.sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      return {
        body: statement.body,
        parameters: statement.parameters,
        name: statement.name.text,
        node: statement,
      };
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        const initializer = unwrap(declaration.initializer);
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
          return {
            body: initializer.body,
            parameters: initializer.parameters,
            name: declaration.name.text,
            node: statement,
          };
        }
      }
    }
  }
  return null;
}

/** Build IR for one authored module containing exactly one component. */
export function buildSemanticIr(source: string, file: string): IrBuildResult {
  const parsed = typescriptParser.parseModule(source, file);
  const sf = parsed.sourceFile;
  const diagnostics: IrDiagnostic[] = [];

  if (parsed.syntaxDiagnostics.length > 0) {
    return {
      component: null,
      diagnostics: parsed.syntaxDiagnostics.map((diagnostic) => ({
        severity: 'error' as const,
        code: 'OEIR_SYNTAX',
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        span: fallbackSpan(file),
        origin: 'module',
      })),
    };
  }

  const componentId = `${file}#component`;
  const state: BuildState = {
    file,
    source,
    sourceFile: sf,
    diagnostics,
    scope: { bindings: new Map() },
    componentId,
    propsParam: null,
    recipes: [],
    owners: [],
    recipeNames: new Map(),
    nodeCounter: 0,
    ownerCounter: 0,
  };

  const found = findComponent(state);
  if (found === null) {
    diagnostics.push({
      severity: 'error',
      code: 'OEIR_COMPONENT_MISSING',
      message: 'no function component found (expected a function declaration or arrow binding)',
      span: fallbackSpan(file),
      origin: 'module',
    });
    return { component: null, diagnostics };
  }

  const propsParameter = found.parameters[0];
  if (found.parameters.length > 1) {
    error(state, 'OEIR_PROPS_ARITY', 'a component takes at most one props parameter', found.node);
  }
  if (propsParameter !== undefined) {
    if (!ts.isIdentifier(propsParameter.name)) {
      error(
        state,
        'OEIR_PROPS_PATTERN',
        'the props parameter must be a plain identifier',
        propsParameter,
      );
    } else {
      state.propsParam = propsParameter.name.text;
      state.scope.bindings.set(propsParameter.name.text, 'prop');
    }
  }

  const componentOwner = nextOwner(state, null, 'component');
  const resources: IrResource[] = [];
  let returnExpression: ts.Expression | null = null;

  if (ts.isBlock(found.body)) {
    for (const statement of found.body.statements) {
      if (ts.isReturnStatement(statement)) {
        if (returnExpression !== null) {
          error(
            state,
            'OEIR_MULTIPLE_RETURNS',
            'a component has exactly one return in the M02 spike',
            statement,
          );
        }
        returnExpression = statement.expression ?? null;
        if (returnExpression === null) {
          error(state, 'OEIR_EMPTY_RETURN', 'the return must produce JSX', statement);
        }
        continue;
      }
      if (!ts.isVariableStatement(statement)) {
        error(
          state,
          'OEIR_STATEMENT_UNSUPPORTED',
          `statement kind '${ts.SyntaxKind[statement.kind]}' is outside the M02 spike grammar`,
          statement,
        );
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        const resource = buildResource(state, declaration);
        if (resource !== null) resources.push(resource);
      }
    }
  } else {
    returnExpression = found.body;
  }

  const roots =
    returnExpression === null ? [] : branchNodes(state, returnExpression, `${componentId}/root`);

  const rendersNothing =
    roots.length === 0 ||
    roots.every((root) => root.kind === 'fragment' && root.children.length === 0);
  if (rendersNothing) {
    diagnostics.push({
      severity: 'warning',
      code: 'OEIR_EMPTY_OUTPUT',
      message: 'the component produces no output (empty root)',
      span: fallbackSpan(file),
      origin: 'module',
    });
  }

  const component: IrComponent = {
    kind: 'component',
    id: componentId,
    name: found.name,
    file,
    propsParam: state.propsParam,
    resources,
    recipes: state.recipes,
    owners: state.owners,
    roots,
    owner: componentOwner,
    span: spanOf(sf, file, found.node),
  };

  return { component, diagnostics };
}

/** Classify one `const` declaration into a resource or a recipe. */
function buildResource(state: BuildState, declaration: ts.VariableDeclaration): IrResource | null {
  if (!ts.isIdentifier(declaration.name)) {
    error(
      state,
      'OEIR_DECLARATION_PATTERN',
      'only plain identifier declarations are admitted',
      declaration,
    );
    return null;
  }
  const name = declaration.name.text;
  const initializer = declaration.initializer;
  if (initializer === undefined) {
    error(
      state,
      'OEIR_DECLARATION_NO_INITIALIZER',
      'a declaration needs an initializer',
      declaration,
    );
    return null;
  }
  const value = unwrap(initializer);

  // `signal(...)` / `computed(...)` are ordinary calls whose callee name matters.
  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
    const callee = value.expression.text;
    if (callee === 'signal' || callee === 'computed') {
      const kind: IrResourceKind = callee;
      state.scope.bindings.set(name, kind);
      return {
        name,
        kind,
        expression: buildExpression(
          state,
          value.arguments[0] ?? value,
          kind === 'computed' ? 'computed' : 'local',
        ),
        span: spanOf(state.sourceFile, state.file, declaration),
      };
    }
  }

  // `const c = <Counter />` in value position → a reusable insertion recipe.
  if (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value) || ts.isJsxFragment(value)) {
    const built = buildChild(state, value, `${state.componentId}/recipe:${name}`);
    if (built === null) return null;
    if (built.kind !== 'element' && built.kind !== 'component-ref') {
      error(
        state,
        'OEIR_RECIPE_TARGET_UNSUPPORTED',
        'a JSX value in value position must be an element or a component reference',
        declaration,
      );
      return null;
    }
    const recipe: IrRecipe = {
      kind: 'recipe',
      id: `${state.componentId}/recipe:${name}`,
      target: built,
      span: spanOf(state.sourceFile, state.file, declaration),
    };
    state.recipes.push(recipe);
    state.recipeNames.set(name, recipe.id);
    state.scope.bindings.set(name, 'local');
    return null;
  }

  // Everything else is an ordinary local: a snapshot evaluated where it appears.
  state.scope.bindings.set(name, 'local');
  return {
    name,
    kind: 'local',
    expression: buildExpression(state, value, 'local'),
    span: spanOf(state.sourceFile, state.file, declaration),
  };
}
