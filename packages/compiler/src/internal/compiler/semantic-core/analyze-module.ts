/** Shared expression checks and the field facts read by server lowering. */

import ts from 'typescript';
import { type CompilerFail } from './compiler-diagnostics.ts';
import { type PropertyValueType, type SerializableValue } from '@openelement/protocol/part-program';
import { isSafeAttributeName as canonicalIsSafeAttributeName } from '@openelement/protocol/forbidden-sinks';

/** The property inventory a caller hands the lowering walk. */
export interface CompiledField {
  name: string;
  type: PropertyValueType;
}

/** The compiler face of the one canonical attribute-name predicate. */
export function isSafeAttributeName(value: string): boolean {
  return canonicalIsSafeAttributeName(value);
}

export function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Return a JSON-safe literal, or undefined when the expression is not literal. */
export function literalValue(
  expr: ts.Expression,
  sf: ts.SourceFile,
): SerializableValue | undefined {
  const value = unwrapExpression(expr);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isNumericLiteral(value)) {
    const number = Number(value.text);
    return Number.isFinite(number) ? number : undefined;
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken) {
    if (!ts.isNumericLiteral(value.operand)) return undefined;
    const number = -Number(value.operand.text);
    return Number.isFinite(number) ? number : undefined;
  }
  if (ts.isArrayLiteralExpression(value)) {
    const entries: SerializableValue[] = [];
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) return undefined;
      const entry = literalValue(element, sf);
      if (entry === undefined) return undefined;
      entries.push(entry);
    }
    return entries;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const object: { [key: string]: SerializableValue } = {};
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined;
      const name = property.name;
      const key =
        ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
          ? name.text
          : undefined;
      if (key === undefined || key === '__proto__') return undefined;
      const entry = literalValue(property.initializer, sf);
      if (entry === undefined) return undefined;
      object[key] = entry;
    }
    return object;
  }
  return undefined;
}

export function primitiveText(value: SerializableValue): string | null {
  if (value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

/** Validate the condition's props reads and report whether it reads any. */
export function conditionalClassReadsProp(
  body: ts.Expression,
  declaredFields: ReadonlySet<string>,
  parameter: string,
  fail: CompilerFail,
): boolean {
  let readsProp = false;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      fail(
        node,
        'OEC9024',
        'conditional class conditions may not nest non-arrow functions — hoist the function to module scope and import it',
      );
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === parameter
    ) {
      const name = node.name.text;
      if (!declaredFields.has(name)) {
        fail(
          node,
          'OEC9024',
          `conditional class conditions may only read ${parameter}.<declared property> (found ${parameter}.${name})`,
        );
      }
      readsProp = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return readsProp;
}
