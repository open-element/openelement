/**
 * M03-I-3 — TypeScript-only syntax erasure for lowered expression text.
 *
 * Design authority: `docs/architecture/m03-expression-identity.md` (M03-B) §3
 * Route 3 step 2a and §8 rule 2. The erasure visitor is the one place where
 * this design takes on work TypeScript's own emitter would otherwise do, which
 * is exactly why §10 keeps a differential `ts.transpileModule` oracle: the
 * oracle checks this visitor, it is never the mechanism.
 *
 * Scope (the admitted erasure set):
 * - wrappers: `as`, `satisfies`, non-null `!`, angle-bracket type assertions and
 *   instantiation expressions (`f<string>` as a value) are replaced by their
 *   inner expression;
 * - type arguments on `call`/`new` sites are dropped;
 * - annotations on function-like nodes are dropped (type parameters, return
 *   types, parameter types and their optional `?`); a `this` parameter is
 *   removed; this covers arrows/function expressions, object-literal methods
 *   and accessors, and nested function declarations;
 * - property declarations only need their type/`?`/`!` erased, but they occur
 *   inside class expressions, which this model refuses (see below).
 *
 * Outside the admitted erasure set this module fails closed: class declarations
 * and class expressions are outside the function-component expression model
 * (class authoring retires; M03-B §6), so they are refused with
 * `OEIR_ERASURE_UNSUPPORTED` rather than half-lowered. Context-sensitive
 * constructs (`this`/`arguments`/`super`/`new.target`/`await`/`yield`/`eval`)
 * stay refused by the caller's context matrix.
 *
 * The visitor preserves authored positions on every rebuilt node
 * (`ts.setTextRange`), so the A2 marker/anchor pipeline keeps reporting node
 * starts for the surviving nodes: erasure changes the printed text, never the
 * provenance arithmetic.
 */

import ts from 'typescript';
import type { ScopeDiagnostic } from './scope-resolution.ts';

/** Continues the full lowering traversal for a node this visitor does not erase. */
export type ChildVisitor = (node: ts.Node) => ts.Node;

function withAuthoredRange<T extends ts.Node>(updated: T, original: ts.Node): T {
  return ts.setTextRange(updated, original);
}

/** Type-assert a visited child back to the factory's expected child type. */
function visitAs<T extends ts.Node>(visit: ChildVisitor, node: T): T {
  return visit(node) as T;
}

function isThisParameter(parameter: ts.ParameterDeclaration): boolean {
  return ts.isIdentifier(parameter.name) && parameter.name.text === 'this';
}

function parameterNeedsErasure(parameter: ts.ParameterDeclaration): boolean {
  return parameter.type !== undefined || parameter.questionToken !== undefined;
}

/** Erase parameter annotations, optional markers and `this` parameters. */
function eraseParameters(
  parameters: readonly ts.ParameterDeclaration[],
  visit: ChildVisitor,
): ts.ParameterDeclaration[] {
  const erased: ts.ParameterDeclaration[] = [];
  for (const parameter of parameters) {
    if (isThisParameter(parameter)) continue;
    const initializer =
      parameter.initializer === undefined ? undefined : visitAs(visit, parameter.initializer);
    if (!parameterNeedsErasure(parameter) && initializer === parameter.initializer) {
      erased.push(parameter);
      continue;
    }
    erased.push(
      withAuthoredRange(
        ts.factory.updateParameterDeclaration(
          parameter,
          parameter.modifiers,
          parameter.dotDotDotToken,
          parameter.name,
          undefined,
          undefined,
          initializer,
        ),
        parameter,
      ),
    );
  }
  return erased;
}

function eraseArrow(node: ts.ArrowFunction, visit: ChildVisitor): ts.ArrowFunction {
  return withAuthoredRange(
    ts.factory.updateArrowFunction(
      node,
      node.modifiers,
      undefined,
      eraseParameters(node.parameters, visit),
      undefined,
      node.equalsGreaterThanToken,
      visitAs(visit, node.body),
    ),
    node,
  );
}

function eraseFunctionExpression(
  node: ts.FunctionExpression,
  visit: ChildVisitor,
): ts.FunctionExpression {
  return withAuthoredRange(
    ts.factory.updateFunctionExpression(
      node,
      node.modifiers,
      node.asteriskToken,
      node.name,
      undefined,
      eraseParameters(node.parameters, visit),
      undefined,
      visitAs(visit, node.body),
    ),
    node,
  );
}

function eraseFunctionDeclaration(
  node: ts.FunctionDeclaration,
  visit: ChildVisitor,
): ts.FunctionDeclaration {
  return withAuthoredRange(
    ts.factory.updateFunctionDeclaration(
      node,
      node.modifiers,
      node.asteriskToken,
      node.name,
      undefined,
      eraseParameters(node.parameters, visit),
      undefined,
      node.body === undefined ? undefined : visitAs(visit, node.body),
    ),
    node,
  );
}

function eraseMethodDeclaration(
  node: ts.MethodDeclaration,
  visit: ChildVisitor,
): ts.MethodDeclaration {
  return withAuthoredRange(
    ts.factory.updateMethodDeclaration(
      node,
      node.modifiers,
      node.asteriskToken,
      node.name,
      node.questionToken,
      undefined,
      eraseParameters(node.parameters, visit),
      undefined,
      node.body === undefined ? undefined : visitAs(visit, node.body),
    ),
    node,
  );
}

function eraseGetAccessor(
  node: ts.GetAccessorDeclaration,
  visit: ChildVisitor,
): ts.GetAccessorDeclaration {
  return withAuthoredRange(
    ts.factory.updateGetAccessorDeclaration(
      node,
      node.modifiers,
      node.name,
      eraseParameters(node.parameters, visit),
      undefined,
      node.body === undefined ? undefined : visitAs(visit, node.body),
    ),
    node,
  );
}

function eraseSetAccessor(
  node: ts.SetAccessorDeclaration,
  visit: ChildVisitor,
): ts.SetAccessorDeclaration {
  return withAuthoredRange(
    ts.factory.updateSetAccessorDeclaration(
      node,
      node.modifiers,
      node.name,
      eraseParameters(node.parameters, visit),
      node.body === undefined ? undefined : visitAs(visit, node.body),
    ),
    node,
  );
}

/**
 * Erase TypeScript-only syntax at this node. Returns the replacement, or
 * `undefined` when this node is not erased here and the caller should continue
 * with its normal child traversal (`ts.visitEachChild`).
 */
export function eraseTypeScriptSyntax(node: ts.Node, visit: ChildVisitor): ts.Node | undefined {
  // Wrappers: the value is the inner expression.
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return visit(node.expression);
  }
  // `f<string>` in a value position parses as ExpressionWithTypeArguments.
  if (ts.isExpressionWithTypeArguments(node)) return visitAs(visit, node.expression);
  if (ts.isCallExpression(node)) {
    if (node.typeArguments === undefined || node.typeArguments.length === 0) return undefined;
    return withAuthoredRange(
      ts.factory.updateCallExpression(
        node,
        visitAs(visit, node.expression),
        undefined,
        node.arguments.map((argument) => visitAs(visit, argument)),
      ),
      node,
    );
  }
  if (ts.isNewExpression(node)) {
    if (node.typeArguments === undefined || node.typeArguments.length === 0) return undefined;
    return withAuthoredRange(
      ts.factory.updateNewExpression(
        node,
        visitAs(visit, node.expression),
        undefined,
        node.arguments === undefined
          ? undefined
          : node.arguments.map((argument) => visitAs(visit, argument)),
      ),
      node,
    );
  }
  if (ts.isVariableDeclaration(node)) {
    if (node.type === undefined && node.exclamationToken === undefined) return undefined;
    return withAuthoredRange(
      ts.factory.updateVariableDeclaration(
        node,
        node.name,
        undefined,
        undefined,
        node.initializer === undefined ? undefined : visitAs(visit, node.initializer),
      ),
      node,
    );
  }
  if (ts.isArrowFunction(node)) return eraseArrow(node, visit);
  if (ts.isFunctionExpression(node)) return eraseFunctionExpression(node, visit);
  if (ts.isFunctionDeclaration(node)) return eraseFunctionDeclaration(node, visit);
  if (ts.isMethodDeclaration(node)) return eraseMethodDeclaration(node, visit);
  if (ts.isGetAccessorDeclaration(node)) return eraseGetAccessor(node, visit);
  if (ts.isSetAccessorDeclaration(node)) return eraseSetAccessor(node, visit);
  return undefined;
}

/** A source-located erasure refusal. */
function refusal(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  code: string,
  message: string,
): ScopeDiagnostic {
  const start = node.getStart(sourceFile);
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    severity: 'error',
    code,
    message,
    span: {
      file: sourceFile.fileName,
      start,
      end: node.getEnd(),
      line: position.line + 1,
      column: position.character + 1,
    },
    origin: 'source',
  };
}

/**
 * Fail closed on TypeScript syntax outside the admitted erasure set. Class
 * authoring retires (M03-B §6), so a class declaration/expression inside the
 * lowered expression is refused instead of half-lowered. JSX subtrees are
 * recipe interiors and are not inspected.
 */
export function collectErasureBoundaryRefusals(
  sourceFile: ts.SourceFile,
  root: ts.Node,
  diagnostics: ScopeDiagnostic[],
): void {
  const visit = (node: ts.Node): void => {
    if (node !== root && ts.isJsxElement(node)) return;
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return;
    if (ts.isClassExpression(node) || ts.isClassDeclaration(node)) {
      diagnostics.push(
        refusal(
          sourceFile,
          node,
          'OEIR_ERASURE_UNSUPPORTED',
          'class authoring is outside the function-component expression model; fail closed ' +
            'rather than print a half-erased class',
        ),
      );
      return;
    }
    if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node)
    ) {
      diagnostics.push(
        refusal(
          sourceFile,
          node,
          'OEIR_ERASURE_UNSUPPORTED',
          'type-only declarations inside a lowered expression are outside the erasure set; ' +
            'fail closed rather than print TypeScript-only declarations as JavaScript',
        ),
      );
      return;
    }
    if (ts.canHaveModifiers(node)) {
      const declare = ts
        .getModifiers(node)
        ?.find((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword);
      if (declare !== undefined) {
        diagnostics.push(
          refusal(
            sourceFile,
            declare,
            'OEIR_ERASURE_UNSUPPORTED',
            '`declare` is outside the admitted erasure set; fail closed',
          ),
        );
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
}
