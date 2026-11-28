import ts from 'typescript';
import { analyzeModuleSemantics } from '@openelement/compiler';

const EXECUTABLE_ELEMENTS = new Set(['script', 'iframe', 'object', 'embed', 'svg', 'math']);
const SCRIPT_URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'data',
  'xlink:href',
]);

function literal(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  );
}

/**
 * A closed certificate for one small subset of already compiler-admitted
 * functions: literal JSX plus local primitive signal state. All other code
 * keeps the opaque fallback. This never decides compilation or admission.
 */
export function closedIslandSource(source: string, file: string): readonly string[] | undefined {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let signal: string | undefined;
  let islandPolicy: string | undefined;
  let component: ts.FunctionDeclaration | undefined;
  let defaultComponent: string | undefined;

  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) return undefined;
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const bindings = clause?.namedBindings;
      if (clause?.name || !bindings || !ts.isNamedImports(bindings)) return undefined;
      for (const binding of bindings.elements) {
        if (binding.isTypeOnly) continue;
        const imported = (binding.propertyName ?? binding.name).text;
        const specifier = statement.moduleSpecifier.text;
        if (specifier === '@openelement/element' && imported === 'signal' && !signal) {
          signal = binding.name.text;
        } else if (
          specifier === '@openelement/router' &&
          imported === 'defineIslandConfig' &&
          !islandPolicy
        ) {
          islandPolicy = binding.name.text;
        } else {
          return undefined;
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && !component) {
      component = statement;
      if (statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword)) {
        defaultComponent = statement.name?.text;
      }
      continue;
    }
    if (
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression) &&
      !defaultComponent
    ) {
      defaultComponent = statement.expression.text;
      continue;
    }
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
      const declaration = statement.declarationList.declarations[0]!;
      const policy = declaration.initializer;
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'openElement' &&
        policy &&
        ts.isCallExpression(policy) &&
        ts.isIdentifier(policy.expression) &&
        policy.expression.text === islandPolicy &&
        policy.arguments.length === 1 &&
        ts.isObjectLiteralExpression(policy.arguments[0]!) &&
        policy.arguments[0]!.properties.every(
          (property) =>
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
            (literal(property.initializer) ||
              (ts.isArrayLiteralExpression(property.initializer) &&
                property.initializer.elements.every(literal))),
        )
      )
        continue;
    }
    return undefined;
  }

  if (
    !component?.body ||
    !defaultComponent ||
    component.name?.text !== defaultComponent ||
    component.parameters.length !== 0 ||
    component.asteriskToken ||
    component.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.AsyncKeyword)
  )
    return undefined;

  const locals = new Set<string>();
  const statements = component.body.statements;
  const render = statements.at(-1);
  if (!render || !ts.isReturnStatement(render) || !render.expression) return undefined;
  for (const statement of statements.slice(0, -1)) {
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    ) {
      return undefined;
    }
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (
        !ts.isIdentifier(declaration.name) ||
        locals.has(declaration.name.text) ||
        declaration.name.text === signal ||
        declaration.name.text === islandPolicy ||
        !init ||
        !ts.isCallExpression(init) ||
        !ts.isIdentifier(init.expression) ||
        init.expression.text !== signal ||
        init.arguments.length !== 1 ||
        !literal(init.arguments[0]!)
      )
        return undefined;
      locals.add(declaration.name.text);
    }
  }

  function isSignalValue(node: ts.Expression): boolean {
    return (
      ts.isPropertyAccessExpression(node) &&
      !node.questionDotToken &&
      ts.isIdentifier(node.expression) &&
      locals.has(node.expression.text) &&
      node.name.text === 'value'
    );
  }

  function safeMutation(node: ts.Expression): boolean {
    if (ts.isParenthesizedExpression(node)) return safeMutation(node.expression);
    if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
      return (
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        isSignalValue(node.operand)
      );
    }
    return (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isSignalValue(node.left) &&
      literal(node.right)
    );
  }

  function safeMarkup(node: ts.Node): boolean {
    if (ts.isJsxText(node) || literal(node)) return true;
    if (ts.isParenthesizedExpression(node)) return safeMarkup(node.expression);
    if (ts.isJsxExpression(node)) return !node.expression || safeMarkup(node.expression);
    if (ts.isJsxFragment(node) || ts.isJsxElement(node)) {
      return (
        (ts.isJsxFragment(node) || safeMarkup(node.openingElement)) &&
        node.children.every(safeMarkup)
      );
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      return (
        ts.isIdentifier(node.tagName) &&
        /^[a-z][a-z0-9._-]*$/.test(node.tagName.text) &&
        !EXECUTABLE_ELEMENTS.has(node.tagName.text) &&
        node.attributes.properties.every((attribute) => {
          if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) return false;
          const name = attribute.name.text;
          const lower = name.toLowerCase();
          const value = attribute.initializer;
          if (lower === 'srcdoc' || lower === 'dangerouslysetinnerhtml' || lower === 'is')
            return false;
          if (lower.startsWith('on')) {
            if (!/^on[A-Z]/.test(name) || !value || !ts.isJsxExpression(value)) return false;
            const handler = value.expression;
            return (
              handler &&
              ts.isArrowFunction(handler) &&
              handler.parameters.length === 0 &&
              !handler.modifiers &&
              !ts.isBlock(handler.body) &&
              safeMutation(handler.body)
            );
          }
          if (SCRIPT_URL_ATTRIBUTES.has(lower)) {
            return value && ts.isStringLiteral(value) && !/[&:\t\n\r]/.test(value.text);
          }
          return (
            !value ||
            ts.isStringLiteral(value) ||
            (ts.isJsxExpression(value) && value.expression && literal(value.expression))
          );
        })
      );
    }
    if (ts.isConditionalExpression(node)) {
      return (
        isSignalValue(node.condition) && safeMarkup(node.whenTrue) && safeMarkup(node.whenFalse)
      );
    }
    return ts.isPropertyAccessExpression(node) && isSignalValue(node);
  }

  if (!safeMarkup(render.expression)) return undefined;
  const facts = analyzeModuleSemantics(source, file);
  return facts.enhancedForm ? undefined : facts.referencedCustomElementTags;
}
