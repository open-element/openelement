/**
 * Sheet-import admission (#1558) — the one style authoring form.
 *
 * A compiled module's sheets are real `.css` files imported into the module
 * and arrayed in the class's `static styles`. The generated module copies the
 * authored imports and the initializer verbatim (emit-module), the sheet's
 * bytes stay in exactly one place — the authored file (P6) — and the compile
 * result carries the import edges so the host build's style-asset plugin can
 * intercept them (style-requests.ts). Nothing here reads sheet bytes and
 * nothing here synthesizes sheet text: the compiler polices only the
 * import/initializer shape, and every other sheet spelling fails closed with
 * OEC9029 plus a migration hint — a silent inline path would put stylesheet
 * bytes back into JS chunks and void the zero-inline guarantee (#1553).
 */

import ts from 'typescript';
import { type CompilerFail } from './compiler-diagnostics.ts';

/** One admitted sheet edge: the authored import's binding, specifier and node. */
export interface SheetImport {
  /** The local default-import binding the class's `static styles` arrays. */
  readonly name: string;
  /** The authored relative `.css` specifier, verbatim. */
  readonly specifier: string;
  /** The import declaration — the fail location for a never-arrayed edge. */
  readonly node: ts.ImportDeclaration;
}

/** The module's sheet imports, in authored scan order, keyed by local binding. */
export type SheetImports = ReadonlyMap<string, SheetImport>;

/**
 * The OEC9029 diagnostic: the one style authoring form is `.css` file
 * imports arrayed in `static styles`; the message carries the migration hint.
 */
function failStyleShape(fail: CompilerFail, node: ts.Node, message: string): never {
  fail(
    node,
    'OEC9029',
    `${message} — write the sheet to a .css file, import it ` +
      `(\`import sheet from './<component>.css'\`) and array the binding in ` +
      'static styles; inline sheet strings are retired (#1558)',
  );
}

/** Strip parens and type assertions — the initializer's expression core. */
function unwrap(expr: ts.Expression): ts.Expression {
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

/**
 * Collect the module's `.css` imports and police their shape: every sheet
 * import is a relative specifier bound through a default import — the
 * side-effect form has no binding for `static styles` to adopt, and a bare
 * package specifier does not resolve inside the authoring tree (the style
 * edge is per-module: the intercept keys on the importing module's directory
 * plus the file name). Named or type-only forms are refused for the same
 * dangling-binding reason.
 */
export function collectSheetImports(sf: ts.SourceFile, fail: CompilerFail): SheetImports {
  const imports = new Map<string, SheetImport>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.endsWith('.css')) continue;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      failStyleShape(
        fail,
        statement,
        `the .css import specifier "${specifier}" must be relative; a bare package ` +
          'specifier does not resolve inside the authoring tree',
      );
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.name) {
      failStyleShape(
        fail,
        statement,
        clause
          ? `the .css import of "${specifier}" must bind its sheet as a default import; ` +
              'named and type-only forms have no sheet binding for static styles to adopt'
          : `the .css import of "${specifier}" must bind its sheet — the side-effect ` +
              'form has no binding for static styles to adopt',
      );
    }
    const name = clause.name.text;
    if (imports.has(name)) {
      fail(
        statement,
        'OEC9029',
        `duplicate sheet import binding "${name}" — a compiled module's .css imports ` +
          'bind distinct names so static styles can array them individually',
      );
    }
    imports.set(name, { name, specifier, node: statement });
  }
  return imports;
}

/**
 * Admit the class's authored `static styles` initializer: an array literal of
 * the module's sheet-import bindings, in authored order. Returns the edge
 * specifiers in that order; the admitted initializer emits verbatim, so the
 * generated module keeps the authored import edges the host build intercepts.
 * Every other shape fails closed with OEC9029, and every collected sheet
 * import must be arrayed — an unadopted edge would dangle in the generated
 * module with no style channel to ride.
 */
export function admitStylesInitializer(
  stylesNode: ts.Expression | undefined,
  sheetImports: SheetImports,
  sf: ts.SourceFile,
  fail: CompilerFail,
): readonly string[] {
  const arrayNode = stylesNode === undefined ? undefined : unwrap(stylesNode);
  if (arrayNode !== undefined && !ts.isArrayLiteralExpression(arrayNode)) {
    failStyleShape(
      fail,
      arrayNode,
      `static styles must array the module's .css file imports; ` +
        `"${arrayNode.getText(sf)}" is not an array of sheet imports`,
    );
  }
  const edges: string[] = [];
  const arrayed = new Set<string>();
  if (arrayNode !== undefined) {
    for (const element of arrayNode.elements) {
      if (ts.isSpreadElement(element) || !ts.isIdentifier(element)) {
        failStyleShape(
          fail,
          element,
          "static styles must array the module's .css file imports as plain bindings; " +
            `"${element.getText(sf)}" is not a sheet-import binding`,
        );
      }
      const name = element.text;
      const sheet = sheetImports.get(name);
      if (sheet === undefined) {
        failStyleShape(
          fail,
          element,
          `static styles must array the module's .css file imports; "${name}" is not a ` +
            '.css import binding of this module',
        );
      }
      if (!arrayed.has(name)) {
        arrayed.add(name);
        edges.push(sheet.specifier);
      }
    }
  }
  for (const sheet of sheetImports.values()) {
    if (!arrayed.has(sheet.name)) {
      fail(
        sheet.node,
        'OEC9029',
        `the .css import "${sheet.name}" ("${sheet.specifier}") is never arrayed in ` +
          'static styles — every sheet import of a compiled module is adopted by its class',
      );
    }
  }
  return edges;
}
