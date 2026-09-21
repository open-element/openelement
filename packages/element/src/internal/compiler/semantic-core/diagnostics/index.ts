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

// ─── Adapter hand-off (#1413) ────────────────────────────────────────
//
// The structured record above is the truth; a display string is not. Vite's
// `this.error()` accepts `{ id, loc, frame, message }`, so the adapter hands
// the build the same fields a Rollup plugin error carries: the module id for
// module resolution/HMR, the `file:line:column` location, and a rendered code
// frame. The overlay and the CLI then underline the authored line instead of
// printing a bare sentence, and programmatic consumers keep the full
// diagnostics array on the same object.

/** Rollup-compatible error shape emitted by the Vite adapter boundary. */
export interface PluginDiagnosticError {
  id: string;
  loc: { file: string; line: number; column: number };
  frame: string;
  message: string;
  diagnostics: CompilerDiagnostic[];
}

/**
 * Render the authored line and its neighbours with a caret under the recorded
 * range — the frame field a build overlay consumes. Multi-line ranges caret
 * only the first line (Rollup's own frames do the same); an empty or
 * out-of-range location degrades to the nearest real line instead of failing.
 */
export function formatDiagnosticFrame(
  source: string,
  diagnostic: CompilerDiagnostic,
  context = 2,
): string {
  const lines = source.split('\n');
  const lineIndex = Math.min(Math.max(diagnostic.line - 1, 0), lines.length - 1);
  const from = Math.max(0, lineIndex - context);
  const to = Math.min(lines.length - 1, lineIndex + context);
  const gutter = String(to + 1).length;
  const out: string[] = [];
  for (let index = from; index <= to; index++) {
    const text = lines[index] ?? '';
    out.push(`${index === lineIndex ? '>' : ' '} ${String(index + 1).padStart(gutter)} | ${text}`);
    if (index !== lineIndex) continue;
    const column = Math.max(diagnostic.character - 1, 0);
    const span = Math.max(diagnostic.end - diagnostic.start, 1);
    const width = Math.max(1, Math.min(span, Math.max(text.length - column, 1)));
    out.push(`  ${' '.repeat(gutter)} | ${' '.repeat(column)}${'^'.repeat(width)}`);
  }
  return out.join('\n');
}

/**
 * Project compiler diagnostics onto the adapter's error shape. Returns null
 * for an empty diagnostics list: there is nothing to locate or render, and
 * the caller keeps its own fallback rather than inventing a location.
 */
export function diagnosticPluginError(
  diagnostics: CompilerDiagnostic[],
  source: string,
  id: string,
): PluginDiagnosticError | null {
  const first = diagnostics[0];
  if (!first) return null;
  const extra = diagnostics.length > 1
    ? ` (+${diagnostics.length - 1} further diagnostic(s) in this module)`
    : '';
  return {
    id,
    loc: { file: first.file, line: first.line, column: first.character },
    frame: formatDiagnosticFrame(source, first),
    message: `${first.file}:${first.line}:${first.character} - error ${first.code}: ` +
      `${first.message}${extra}`,
    diagnostics,
  };
}
