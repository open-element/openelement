/**
 * The compiler's parse seam — the ONE module that depends on the TypeScript
 * JavaScript parsing API (#1473, item 2 of the semantic-core split).
 *
 * `ParserPort` is the explicit boundary every parse backend implements:
 * authored source in, TS AST plus syntax diagnostics out. The rest of the
 * semantic core consumes the resulting AST through read-only type predicates
 * and never constructs or transpiles a parse tree itself, so replacing the
 * backend is a change to this file's single implementation and nowhere else.
 *
 * Retirement conditions (the alpha6 architecture-debt lane, issue #1473): this
 * TypeScript-backed implementation is scheduled to be replaced when either
 * trigger fires, whichever lands first —
 *   1. the TypeScript 6 line ends JavaScript-API maintenance ("JS-API EOL"),
 *      making tsgo's native API the supported parse entry, or
 *   2. oxc's standard-decorators support is declared stable.
 * At that point `typescriptParser` swaps for an oxc/tsgo-backed `ParserPort`
 * implementation; the compiler pipeline and its diagnostics contract stay.
 */

import ts from 'typescript';

/** Authored source parsed to a TS AST, together with the parse's syntax diagnostics. */
export interface ParsedModule {
  readonly sourceFile: ts.SourceFile;
  readonly syntaxDiagnostics: readonly ts.Diagnostic[];
}

/**
 * The parse boundary: source in, TS AST plus syntax diagnostics out. The
 * caller fails closed on any syntax diagnostic; the port never throws.
 */
export interface ParserPort {
  parseModule(source: string, fileName: string): ParsedModule;
}

/** The one TypeScript-backed `ParserPort` implementation. */
export const typescriptParser: ParserPort = {
  parseModule(source, fileName) {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TSX,
    );
    const syntaxDiagnostics =
      ts.transpileModule(source, {
        fileName,
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
      }).diagnostics ?? [];
    return { sourceFile, syntaxDiagnostics };
  },
};
