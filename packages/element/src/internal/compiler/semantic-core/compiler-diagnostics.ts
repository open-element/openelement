/**
 * Compiler-boundary diagnostics for the semantic core: the element compiler's
 * error class, the syntax-diagnostic adapter, and the shared source-location
 * helpers every later stage (analysis, lowering, program and module emission)
 * consumes (#1473 split — moved verbatim from the compile facade).
 */

import ts from 'typescript';
import {
  type CompilerDiagnostic,
  CompilerDiagnosticError,
  diagnosticAt,
  diagnosticMessage,
} from './diagnostics/index.ts';

/** A source-aware compiler diagnostic: stable OEC code, message and source range. */
export interface ElementCompilerDiagnostic extends CompilerDiagnostic {}

/** Error shape consumed by the Vite plugin and compiler tests. */
export class CompiledElementError extends CompilerDiagnosticError {
  constructor(diagnostics: ElementCompilerDiagnostic[]) {
    super(diagnostics);
    this.name = 'CompiledElementError';
  }
}

/**
 * The fail closure every compiler stage takes: locate `node` in the parsed
 * module's source file and fail closed with one source-located OEC diagnostic.
 */
export type CompilerFail = (node: ts.Node, code: string, message: string) => never;

/** Build the fail closure for one parsed module source file. */
export function failAt(sf: ts.SourceFile): CompilerFail {
  return (node, code, message) => {
    throw new CompiledElementError([diagnosticAt(sf, node, code, message)]);
  };
}

export function sourceRange(
  sf: ts.SourceFile,
  node: ts.Node,
): {
  file: string;
  start: { offset: number; line: number; column: number };
  end: { offset: number; line: number; column: number };
} {
  const start = node.getStart(sf);
  const end = node.getEnd();
  const startPosition = sf.getLineAndCharacterOfPosition(start);
  const endPosition = sf.getLineAndCharacterOfPosition(end);
  return {
    file: sf.fileName,
    start: { offset: start, line: startPosition.line + 1, column: startPosition.character + 1 },
    end: { offset: end, line: endPosition.line + 1, column: endPosition.character + 1 },
  };
}

export function parseDiagnostic(
  sf: ts.SourceFile,
  diagnostic: ts.Diagnostic,
): ElementCompilerDiagnostic {
  const start = diagnostic.start ?? 0;
  const end = diagnostic.start === undefined ? start : start + (diagnostic.length ?? 0);
  const position = sf.getLineAndCharacterOfPosition(start);
  return {
    code: 'OEC9000',
    message: diagnosticMessage(diagnostic),
    file: sf.fileName,
    line: position.line + 1,
    character: position.character + 1,
    start,
    end,
  };
}
