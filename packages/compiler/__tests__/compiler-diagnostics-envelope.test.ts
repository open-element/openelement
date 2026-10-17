/**
 * The compiler producer exposes its diagnostics in the envelope shape (#1612).
 *
 * The compiler keeps its own `OEC####` registry (#1413 delivered the
 * structured record); the envelope is the unified CONSUMPTION surface. The
 * adapter projects each `CompilerDiagnostic` onto `DiagnosticEnvelope` —
 * 1-based line/column verbatim, severity `error`, phase `build` — without
 * touching the record itself, so `CompilerDiagnosticError` consumers and the
 * build exit both read the same truth.
 */
import { describe, expect, test } from 'vitest';
import {
  clearCompilerDiagnostics,
  CompiledElementError,
  compileElementProgram,
  compilerDiagnosticsToEnvelopes,
  recordCompilerDiagnostics,
  takeCompilerDiagnostics,
} from '../src/compiler.ts';
import { CompilerErrorCode } from '@openelement/protocol/errors';
import {
  DIAGNOSTIC_REPORT_FORMAT,
  diagnosticReport,
  serializeDiagnosticReport,
  parseDiagnosticReport,
  type DiagnosticEnvelope,
} from '@openelement/protocol/diagnostics';

const FILE = '/proj/app/components/oe-probe.tsx';

function compileFailingModule(member: string): CompiledElementError {
  const source = [
    "import { element, OpenElement, property } from '@openelement/element';",
    "@element('oe-probe', { root: 'light' })",
    'export class Probe extends OpenElement {',
    member,
    '  render() { return <div>probe</div>; }',
    '}',
    '',
  ].join('\n');
  try {
    compileElementProgram(source, FILE);
  } catch (error) {
    if (error instanceof CompiledElementError) return error;
    throw error;
  }
  throw new Error('the module compiled; a diagnostic was expected');
}

describe('compiler diagnostics → envelope', () => {
  test('each OEC diagnostic projects with its source location intact', () => {
    // OEC9020: a property default that is not a serializable literal — the
    // diagnostic lands on the `Math.max(1, 2)` initializer on line 4.
    const failure = compileFailingModule(
      '  @property({ reflect: false })\n  count = Math.max(1, 2);',
    );
    expect(failure.diagnostics.length).toBeGreaterThan(0);

    const envelopes = compilerDiagnosticsToEnvelopes(failure.diagnostics);
    expect(envelopes).toHaveLength(failure.diagnostics.length);
    failure.diagnostics.forEach((diagnostic, index) => {
      const envelope: DiagnosticEnvelope | undefined = envelopes[index];
      expect(envelope).toEqual({
        code: diagnostic.code,
        severity: 'error',
        phase: 'build',
        message: diagnostic.message,
        file: diagnostic.file,
        line: diagnostic.line,
        column: diagnostic.character,
      });
      expect(envelope?.code).toMatch(/^OEC\d/);
    });
  });

  test('the projected aggregate round-trips the report channel with the family code', () => {
    const failure = compileFailingModule('  @property({ attribute: 1 })\n  count = 0;');
    const envelopes = compilerDiagnosticsToEnvelopes(failure.diagnostics);
    // The family classification rides beside the per-diagnostic records —
    // the CompilerErrorCode.DIAGNOSTICS envelope says WHY the build stopped
    // ("one or more source-located diagnostics"), the OEC entries say WHERE.
    const family: DiagnosticEnvelope = {
      code: CompilerErrorCode.DIAGNOSTICS,
      severity: 'error',
      phase: 'build',
      message: `${failure.diagnostics.length} source-located diagnostic(s) stopped the compile`,
      file: failure.diagnostics[0]?.file,
    };
    const wire = serializeDiagnosticReport(diagnosticReport([family, ...envelopes]));
    const report = parseDiagnosticReport(wire);
    expect(report.format).toEqual(DIAGNOSTIC_REPORT_FORMAT);
    expect(report.ok).toEqual(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain('OEC9023');
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      CompilerErrorCode.DIAGNOSTICS,
    );
  });

  test('an empty diagnostics list projects to an empty envelope list (no invented location)', () => {
    expect(compilerDiagnosticsToEnvelopes([])).toEqual([]);
  });

  test('the exit-side record survives the boundary flattening and drains once', () => {
    clearCompilerDiagnostics();
    const failure = compileFailingModule(
      '  @property({ reflect: false })\n  count = Math.max(1, 2);',
    );
    // What the projection hosts do at the this.error() boundary: rolldown
    // flattens the structured record off the thrown error, so the envelopes
    // are recorded BEFORE the error is handed to the bundler.
    recordCompilerDiagnostics(failure.diagnostics);
    const drained = takeCompilerDiagnostics();
    expect(drained).toEqual(compilerDiagnosticsToEnvelopes(failure.diagnostics));
    // Drained: the next exit starts from an empty record.
    expect(takeCompilerDiagnostics()).toEqual([]);
    // Clearing without reading is the fresh-build hygiene.
    recordCompilerDiagnostics(failure.diagnostics);
    clearCompilerDiagnostics();
    expect(takeCompilerDiagnostics()).toEqual([]);
  });
});
