/**
 * Source-aware diagnostics for the v0.44 compiler boundary.
 *
 * Diagnostics are deliberately small and serializable. The Vite adapter turns
 * the formatted error into its build error, while compiler tests can inspect
 * the structured record without parsing a display string.
 */

import ts from 'typescript';

export interface CompilerDiagnostic {
  code: string;
  message: string;
  file: string;
  line: number;
  character: number;
  start: number;
  end: number;
}

export class CompilerDiagnosticError extends Error {
  readonly diagnostics: CompilerDiagnostic[];

  constructor(diagnostics: CompilerDiagnostic[]) {
    super(
      diagnostics
        .map((diagnostic) =>
          `${diagnostic.file}:${diagnostic.line}:${diagnostic.character} - error ` +
          `${diagnostic.code}: ${diagnostic.message}`
        )
        .join('\n'),
    );
    this.name = 'CompilerDiagnosticError';
    this.diagnostics = diagnostics;
  }
}

/** Create one stable source range from a TypeScript AST node. */
export function diagnosticAt(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  code: string,
  message: string,
): CompilerDiagnostic {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    code,
    message,
    file: sourceFile.fileName,
    line: position.line + 1,
    character: position.character + 1,
    start,
    end,
  };
}

/** Flatten a TypeScript parse diagnostic without leaking compiler internals. */
export function diagnosticMessage(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
}
