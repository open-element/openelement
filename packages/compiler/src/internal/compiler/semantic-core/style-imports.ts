/**
 * Sheet-import admission (#1558): the one authoring form for component styles
 * is a real `.css` file imported and referenced by `static styles`.
 *
 * A compiled module's sheets must arrive as default imports of relative
 * `.css` modules, arrayed in the class's `static styles` initializer in
 * authored order. The import statement IS the static proof the old string
 * admission machine (the retired style-admission.ts, OEC9028) reconstructed
 * by reading template-literal bytes: a file on disk carries the sheet, the
 * bundler's graph carries the import edge, and the build's style-asset plugin
 * owns the emitted artifact. Nothing here reads or validates sheet content —
 * only the import/initializer shape:
 *
 *  - every relative `.css`-suffixed specifier must be a runtime default
 *    import (side-effect and named forms have no binding for the class to
 *    reference — the sheet could never be adopted);
 *  - every such import must appear in `static styles`, and `static styles`
 *    must be an array literal of exactly those bindings — an initializer
 *    carrying anything else (a string, a factory call, a foreign binding)
 *    would put stylesheet bytes back inside the JS graph;
 *  - the tracked edges travel out on the compile result so the host build's
 *    style-asset plugin can intercept them (the request channel of
 *    ADR-0164, now keyed on the authored specifier instead of a synthesized
 *    reserved-suffix sibling).
 *
 * Bare (package-rooted) `.css` specifiers are refused with the same
 * diagnostic: the sheet edge must resolve inside the authoring tree, where
 * the build's file ownership and the import edge's self-containment both
 * hold.
 */

import ts from 'typescript';
import { type CompilerFail } from './compiler-diagnostics.ts';

/** True when the specifier is a relative `.css` module path (no query). */
export function isRelativeCssSpecifier(specifier: string): boolean {
  return /^(\.{1,2}\/).*\.css$/.test(specifier);
}

/** One tracked sheet edge: the local binding and the specifier it imports. */
export interface SheetImport {
  readonly localName: string;
  readonly specifier: string;
}

/**
 * Collect the module's sheet imports and reject every `.css`-suffixed import
 * that does not bind a default. Returns the admitted edges in source order.
 */
export function collectSheetImports(
  sf: ts.SourceFile,
  fail: CompilerFail,
): ReadonlyMap<string, SheetImport> {
  const sheetImports = new Map<string, SheetImport>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!isRelativeCssSpecifier(specifier)) continue;
    const clause = statement.importClause;
    if (!clause || !clause.name) {
      fail(
        statement,
        'OEC9029',
        `a .css import must bind its sheet (import <name> from '${specifier}') — a ` +
          'side-effect import has no binding for static styles to adopt. Component styles ' +
          'must be .css file imports: import the sheet and array that binding in static ' +
          'styles — inline stylesheet strings are retired',
      );
      continue;
    }
    const localName = clause.name.text;
    if (sheetImports.has(localName)) {
      fail(statement, 'OEC9029', `duplicate sheet import "${localName}"`);
    }
    sheetImports.set(localName, { localName, specifier });
  }
  return sheetImports;
}

/**
 * Admit one authored `static styles` initializer against the module's sheet
 * imports: an array literal of exactly those bindings, in authored order.
 * Returns the specifiers in initializer order — the style edges the compile
 * result reports.
 */
export function admitStylesInitializer(
  initializer: ts.Expression | undefined,
  sheetImports: ReadonlyMap<string, SheetImport>,
  sf: ts.SourceFile,
  fail: CompilerFail,
): readonly string[] {
  const used = new Set<string>();
  const specifiers: string[] = [];
  if (initializer === undefined) {
    if (sheetImports.size > 0) {
      fail(
        sf,
        'OEC9029',
        `imported sheet "${[...sheetImports.keys()][0]}" is never referenced — array it in ` +
          'static styles. Component styles must be .css file imports: import the sheet and ' +
          'array that binding in static styles — inline stylesheet strings are retired',
      );
    }
    return specifiers;
  }
  const value = unwrapInitializer(initializer);
  if (!ts.isArrayLiteralExpression(value)) {
    fail(
      initializer,
      'OEC9029',
      'static styles must be an array of .css imports. Component styles must be .css file ' +
        'imports: import the sheet and array that binding in static styles — inline ' +
        'stylesheet strings are retired',
    );
    return specifiers;
  }
  for (const element of value.elements) {
    if (ts.isSpreadElement(element)) {
      fail(
        element,
        'OEC9029',
        'static styles entries must be .css import bindings. Component styles must be .css ' +
          'file imports: import the sheet and array that binding in static styles — inline ' +
          'stylesheet strings are retired',
      );
      continue;
    }
    if (!ts.isIdentifier(element)) {
      fail(
        element,
        'OEC9029',
        'static styles entries must be .css import bindings. Component styles must be .css ' +
          'file imports: import the sheet and array that binding in static styles — inline ' +
          'stylesheet strings are retired',
      );
      continue;
    }
    const name = element.text;
    const sheetImport = sheetImports.get(name);
    if (sheetImport === undefined) {
      fail(
        element,
        'OEC9029',
        `"${name}" is not a .css import. Component styles must be .css file imports: import ` +
          'the sheet and array that binding in static styles — inline stylesheet strings ' +
          'are retired',
      );
      continue;
    }
    used.add(name);
    specifiers.push(sheetImport.specifier);
  }
  for (const [name] of sheetImports) {
    if (!used.has(name)) {
      fail(
        value,
        'OEC9029',
        `imported sheet "${name}" is never referenced — array it in static styles. Component ` +
          'styles must be .css file imports: import the sheet and array that binding in ' +
          'static styles — inline stylesheet strings are retired',
      );
    }
  }
  return specifiers;
}

function unwrapInitializer(expr: ts.Expression): ts.Expression {
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
