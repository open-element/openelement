/**
 * Static style admission for the island style asset protocol (ADR-0164 §4).
 *
 * An island component's `static styles` ships as one OE-controlled
 * `.oe-style.css` resource request instead of template-literal bytes inside
 * the JS chunk. That replacement is only sound when the compiler can read the
 * exact bytes the verbatim initializer would have shipped, so v1 admits four
 * statically provable shapes: template literals without interpolation,
 * `compiledStyle()`-marked calls over a static string, static arrays of the
 * above, and same-module `const` declarations of the above. Everything else
 * fails closed with OEC9028 — a silent inline fallback would put the
 * stylesheet bytes back into the island chunk and void the zero-inline
 * guarantee the protocol exists for.
 *
 * `compiledStyle` is an authoring convention (the ADR-0143 helper shape), not
 * a compiler intrinsic: admission is by the call-site spelling with exactly
 * one static string argument — the same contract-name admission `static
 * styles` itself uses. The marked call never evaluates in the generated
 * module; its argument's literal text IS the sheet, and the authored factory
 * is bypassed along with the inlined bytes.
 */

import ts from 'typescript';
import { unwrapExpression } from './analyze-module.ts';
import { type CompilerFail } from './compiler-diagnostics.ts';

/** The call-site spelling that marks a sheet factory (ADR-0164 §4). */
const STYLE_FACTORY_SPELLING = 'compiledStyle';

/** Statically provable sheets: the admitted CSS texts in authored order. */
export interface StaticStyles {
  kind: 'static';
  sheets: string[];
}

/** Static proof stopped here: the diagnostic's node plus the migration hint. */
export interface DynamicStyles {
  kind: 'dynamic';
  node: ts.Node;
  reason: string;
}

export type StyleAdmission = StaticStyles | DynamicStyles;

/** Same-module style constants (name -> authored initializer), scan order. */
export type StyleConstants = ReadonlyMap<string, ts.Expression>;

/** The style-constant statements a module carries, kept for the erasure scan. */
export interface StyleConstantDeclarations {
  constants: Map<string, ts.Expression>;
  statements: ts.VariableStatement[];
}

/**
 * The one style-resource request an admitted island component generates
 * (ADR-0164 §2): a sibling module id with the reserved `.oe-style.css`
 * suffix, and the exact CSS the emitted asset must carry.
 */
export interface CompiledStyleRequest {
  /** The custom-element tag the sheets style; also the request's file stem. */
  readonly tag: string;
  /** The reserved-suffix sibling specifier emitted in the generated module. */
  readonly specifier: string;
  /** The admitted sheets joined in authored order — the request's CSS. */
  readonly css: string;
}

const dynamic = (node: ts.Node, reason: string): DynamicStyles => ({
  kind: 'dynamic',
  node,
  reason,
});

/**
 * Admit one expression (a `static styles` initializer or a style constant's)
 * as statically provable sheets, seeing through same-module constants. Cycles
 * are cut by the `seen` chain; TS itself rejects use-before-declaration, so a
 * constant only ever resolves to an earlier declaration.
 */
function admitExpression(
  expr: ts.Expression,
  sf: ts.SourceFile,
  constants: StyleConstants,
  seen: ReadonlySet<string>,
): StyleAdmission {
  const value = unwrapExpression(expr);
  if (ts.isNoSubstitutionTemplateLiteral(value)) {
    return { kind: 'static', sheets: [value.text] };
  }
  if (ts.isTemplateExpression(value)) {
    return dynamic(
      value,
      'template literal interpolation is not statically provable — inline the composed sheet text',
    );
  }
  if (ts.isTaggedTemplateExpression(value)) {
    return dynamic(
      value,
      'tagged template literals cook the raw bytes — write a plain template literal',
    );
  }
  if (ts.isCallExpression(value)) {
    if (!ts.isIdentifier(value.expression) || value.expression.text !== STYLE_FACTORY_SPELLING) {
      return dynamic(
        value,
        `call to ${value.expression.getText(sf)} is not a compiledStyle() sheet factory`,
      );
    }
    if (value.arguments.length !== 1) {
      return dynamic(value, 'compiledStyle() takes exactly one static string argument');
    }
    const argument = unwrapExpression(value.arguments[0]!);
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      return { kind: 'static', sheets: [argument.text] };
    }
    if (ts.isIdentifier(argument)) {
      return resolveConstant(argument, sf, constants, seen);
    }
    return dynamic(argument, 'compiledStyle() argument is not a static string');
  }
  if (ts.isArrayLiteralExpression(value)) {
    const sheets: string[] = [];
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) {
        return dynamic(element, 'spread in the styles array is not statically provable');
      }
      const admitted = admitExpression(element, sf, constants, seen);
      if (admitted.kind === 'dynamic') return admitted;
      sheets.push(...admitted.sheets);
    }
    return { kind: 'static', sheets };
  }
  if (ts.isIdentifier(value)) {
    return resolveConstant(value, sf, constants, seen);
  }
  if (ts.isBinaryExpression(value)) {
    return dynamic(
      value,
      'runtime concatenation is not statically provable — compose the sheet text in source',
    );
  }
  return dynamic(value, 'expression is not statically provable');
}

function resolveConstant(
  identifier: ts.Identifier,
  sf: ts.SourceFile,
  constants: StyleConstants,
  seen: ReadonlySet<string>,
): StyleAdmission {
  const name = identifier.text;
  const initializer = constants.get(name);
  if (initializer === undefined) {
    return dynamic(
      identifier,
      `"${name}" is not a same-module style constant (imports and non-const bindings are ` +
        'not statically provable)',
    );
  }
  if (seen.has(name)) {
    return dynamic(identifier, `"${name}" is a cyclic style constant`);
  }
  return admitExpression(initializer, sf, constants, new Set([...seen, name]));
}

/** The v1 entry: admit one authored `static styles` initializer. */
export function admitStaticStyles(
  initializer: ts.Expression,
  sf: ts.SourceFile,
  constants: StyleConstants,
): StyleAdmission {
  return admitExpression(initializer, sf, constants, new Set());
}

/**
 * Admit one top-level variable statement as same-module style constants
 * (ADR-0164 §4): a plain non-exported `const` whose every declaration binds
 * an identifier to a statically provable style initializer. Returns null when
 * the statement is not a style-const shape at all — the caller falls through
 * to the module grammar's standing OEC9008 — and never fails on its own.
 */
export function admitStyleConstantStatement(
  statement: ts.VariableStatement,
  sf: ts.SourceFile,
  constants: StyleConstants,
): Array<{ name: ts.Identifier; initializer: ts.Expression }> | null {
  const modifiers = ts.getModifiers(statement) ?? [];
  if (
    modifiers.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.ExportKeyword ||
        modifier.kind === ts.SyntaxKind.DeclareKeyword,
    ) ||
    (statement.declarationList.flags & ts.NodeFlags.Const) === 0
  ) {
    return null;
  }
  const declarations: Array<{ name: ts.Identifier; initializer: ts.Expression }> = [];
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return null;
    const admitted = admitStaticStyles(declaration.initializer, sf, constants);
    if (admitted.kind === 'dynamic') return null;
    declarations.push({ name: declaration.name, initializer: declaration.initializer });
  }
  return declarations;
}

/**
 * Style constants are erased from the generated module (their bytes live in
 * the emitted asset), so every reference must stay inside the channels the
 * protocol replaces: the style constants' own initializers and the `static
 * styles` initializer. Any other reference — a method body, the island policy,
 * a type annotation — would dangle in the generated module.
 */
export function assertStyleConstantsErased(
  sf: ts.SourceFile,
  declarations: StyleConstantDeclarations,
  stylesInitializer: ts.Expression | undefined,
  fail: CompilerFail,
): void {
  const skip = new Set<ts.Node>([...declarations.statements]);
  if (stylesInitializer !== undefined) skip.add(stylesInitializer);
  const visit = (node: ts.Node): void => {
    if (skip.has(node)) return;
    if (ts.isIdentifier(node) && declarations.constants.has(node.text)) {
      fail(
        node,
        'OEC9028',
        `same-module style constant "${node.text}" is referenced outside static styles; the ` +
          'style asset protocol erases it from the island module, so no other reference can ' +
          'survive — move the runtime copy into its own module',
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
