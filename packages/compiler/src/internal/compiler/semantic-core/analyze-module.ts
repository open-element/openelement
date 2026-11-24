/**
 * The expression-and-field primitives the two surviving lanes share with the
 * lowering walk (#1473 split).
 *
 * This module once also carried the `@element` class-shape analysis
 * (decorator options, canonical heritage, the `@property` inventory). That
 * lane is retired: with no parser feeding it, keeping the analysis here would
 * leave a second, unreachable reading of the same module grammar that could
 * drift from the grammar the generated lane actually admits.
 */

import ts from 'typescript';
import { type CompilerFail } from './compiler-diagnostics.ts';
import { type PropertyValueType, type SerializableValue } from '@openelement/protocol/part-program';
import { isSafeAttributeName as canonicalIsSafeAttributeName } from '@openelement/protocol/forbidden-sinks';

/** The property inventory a caller hands the lowering walk. */
export interface CompiledField {
  name: string;
  reflect: boolean;
  attribute: string | null;
  type: PropertyValueType;
  converter: PropertyValueType;
  typeConstructor: 'String' | 'Number' | 'Boolean' | 'Array' | 'Object';
  accessibility: 'public' | 'protected' | 'private' | '';
  typeText: string;
  initializerText: string;
  defaultValue: SerializableValue;
  node: ts.PropertyDeclaration;
  /**
   * Computed field (alpha.8): the source initializer is
   * `computed(() => <expr>)` (optionally behind a type assertion). The
   * compiled accessor returns the derived value. The compiler records the
   * source-signal dependencies and emits a `__computedFields` factory over the
   * instance's signal record; no field initializer runs on the generated class.
   */
  computed?: { deps: string[]; factoryText: string; body: ts.Expression };
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

/**
 * Message actors for computed-body diagnostics. One validation walk serves
 * both computed-field initializers and the inline conditional class (#1556);
 * the subjects keep each caller's diagnostic prose precise while the shared
 * defaults reproduce the computed-field messages byte-identically.
 */
export interface ComputedBodySubjects {
  /** Actor for shape violations ("X may not nest non-arrow functions"). */
  readonly actor: string;
  /** Actor for computed-field reads ("X may not read computed field ..."). */
  readonly single: string;
  /** Actor for undeclared reads ("X may only read this.<declared property>"). */
  readonly plural: string;
}

const COMPUTED_FIELD_SUBJECTS: ComputedBodySubjects = {
  actor: 'computed field arrows',
  single: 'computed field',
  plural: 'computed fields',
};

/**
 * Validate one computed-body expression and derive its factory text (#1556
 * split of parseComputedInitializer). The body may read `this.<field>` of any
 * NON-computed declared field (rewritten to the signal-record read) and use
 * any module-scope values; `this` in any other position, reads of computed
 * fields, and nested non-arrow functions fail closed (OEC9024). Returns the
 * source-signal dependency list (declaration order) and the body text with
 * every `this.<field>` read rewritten to `__s.<field>.value`.
 *
 * `binding` (alpha15 server lane) switches the read accessor from
 * `this.<field>` to `<parameter>.<field>` (a server function component's
 * props parameter): the same declared-field table and the same messages —
 * only the accessor spelling differs, and no signal-record rewrite applies
 * (the generated constructor reads the props object directly). The default
 * keeps the class path's behavior and messages byte-identical.
 */
export function validateComputedExpressionBody(
  body: ts.Expression,
  sf: ts.SourceFile,
  plainFieldNames: ReadonlySet<string>,
  computedFieldNames: ReadonlySet<string>,
  fail: CompilerFail,
  subjects: ComputedBodySubjects = COMPUTED_FIELD_SUBJECTS,
  binding?: { readonly parameter: string },
): { deps: string[]; bodyText: string } {
  const deps: string[] = [];
  const replacements: Array<{ start: number; end: number; name: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      fail(
        node,
        'OEC9024',
        `${subjects.actor} may not nest non-arrow functions — hoist the function to module ` +
          'scope and import it',
      );
    }
    if (binding !== undefined) {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === binding.parameter
      ) {
        const name = node.name.text;
        if (computedFieldNames.has(name)) {
          fail(
            node,
            'OEC9024',
            `${subjects.single} may not read computed field "${name}" — read its source ` +
              `${binding.parameter}.<property> inputs instead (computed fields cannot chain)`,
          );
        }
        if (!plainFieldNames.has(name)) {
          fail(
            node,
            'OEC9024',
            `${subjects.plural} may only read ${binding.parameter}.<declared property> (found ` +
              `${binding.parameter}.${name})`,
          );
        }
        if (!deps.includes(name)) deps.push(name);
        return;
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const name = node.name.text;
      if (computedFieldNames.has(name)) {
        fail(
          node,
          'OEC9024',
          `${subjects.single} may not read computed field "${name}" — read its source ` +
            'this.<property> inputs instead (computed fields cannot chain)',
        );
      }
      if (!plainFieldNames.has(name)) {
        fail(
          node,
          'OEC9024',
          `${subjects.plural} may only read this.<declared property> (found this.${name})`,
        );
      }
      if (!deps.includes(name)) deps.push(name);
      replacements.push({ start: node.getStart(sf), end: node.getEnd(), name });
      return;
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
      fail(node, 'OEC9024', `${subjects.actor} may only reference this.<property>`);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  let bodyText = body.getText(sf);
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    const offset = body.getStart(sf);
    bodyText =
      bodyText.slice(0, replacement.start - offset) +
      `__s.${replacement.name}.value` +
      bodyText.slice(replacement.end - offset);
  }
  return { deps, bodyText };
}
