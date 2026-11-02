/**
 * TypeScript parsing policy helper for the strict compilation path (#1473).
 *
 * `ParserPort` returns a TypeScript AST and TypeScript syntax diagnostics; it
 * is not a backend-neutral AST boundary. Other paths, including module analysis
 * and type-check hosts, also parse source. Tolerant discovery and strict
 * compilation have different diagnostic responsibilities and need not share
 * this helper's TSX/ES2022 policy.
 *
 * A future parser change requires auditing those consumers, AST assumptions,
 * source locations and diagnostics. TypeScript API maintenance or another
 * parser's decorator support may motivate evaluation, but do not establish a
 * drop-in replacement or a one-file backend swap.
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
