/**
 * The build exit's diagnostics aggregation (#1612).
 *
 * The envelope type is protocol's; THIS is the router half of the seam: the
 * in-process collector the plugins record coded warnings into, the failure
 * walker that maps whatever the build threw (the compiler's structured
 * record, an `OpenElementError`, a plain error, a cause chain) onto
 * envelopes, and the one report assembly the CLI exit writes. The contract:
 * a failing fixture build yields ONE aggregate containing every code, and a
 * warning recorded mid-build survives into the same report.
 */
import { expect, test } from 'vitest';
import {
  CompiledElementError,
  compileElementProgram,
  recordCompilerDiagnostics,
} from '@openelement/compiler';
import {
  DIAGNOSTIC_REPORT_FORMAT,
  diagnosticReport,
  type DiagnosticEnvelope,
} from '@openelement/protocol/diagnostics';
import { CompilerErrorCode, ErrorCode, OpenElementError } from '@openelement/protocol/errors';
import {
  buildExitReport,
  buildFailureEnvelopes,
  formatDiagnosticLine,
  recordBuildDiagnostic,
  resetBuildExitRecords,
  takeBuildDiagnostics,
} from '../src/vite/internal/build-diagnostics.ts';

const FILE = '/proj/app/components/oe-probe.tsx';

function compiledFailingModule(): CompiledElementError {
  const source = [
    "import { element, OpenElement, property } from '@openelement/element';",
    "@element('oe-probe', { root: 'light' })",
    'export class Probe extends OpenElement {',
    '  @property({ reflect: false })\n  count = Math.max(1, 2);',
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

test('the collector records coded warnings and take() drains them once', () => {
  resetBuildExitRecords();
  const warning: DiagnosticEnvelope = {
    code: 'OE_PACKAGE_ADMISSION_MANIFEST_LESS',
    severity: 'warning',
    phase: 'build',
    message: 'the component package has no valid OpenElement manifest',
    file: 'node_modules/@acme/ui/dist/element.ts',
    hint: 'ship a manifest export through the ./manifest subpath',
  };
  recordBuildDiagnostic(warning);
  expect(takeBuildDiagnostics()).toEqual([warning]);
  // Drained: the next build exit starts from an empty slate.
  expect(takeBuildDiagnostics()).toEqual([]);
});

test('the human line keeps the [CODE] token contract and names the location', () => {
  const line = formatDiagnosticLine({
    code: 'OE_PACKAGE_ADMISSION_DYNAMIC_UNPROVEN',
    severity: 'warning',
    phase: 'build',
    message: '"app/entry.tsx" imports "@acme/ui" only through a dynamic import()',
    file: 'app/entry.tsx',
    hint: 'Declare "@acme/ui" in packageIslands.',
  });
  expect(line.startsWith('[OE_PACKAGE_ADMISSION_DYNAMIC_UNPROVEN] ')).toBe(true);
  expect(line).toContain('app/entry.tsx');
  expect(line).toContain('Declare "@acme/ui" in packageIslands.');
  // A record without a location degrades to the bare token + message.
  expect(
    formatDiagnosticLine({
      code: 'OE_X',
      severity: 'info',
      phase: 'build',
      message: 'no location known',
    }),
  ).toEqual('[OE_X] no location known');
});

test('a compiler failure walks out as the family code plus every OEC member', () => {
  resetBuildExitRecords();
  const failure = compiledFailingModule();
  const envelopes = buildFailureEnvelopes(failure);
  const codes = envelopes.map((envelope) => envelope.code);
  expect(codes).toContain(CompilerErrorCode.DIAGNOSTICS);
  expect(codes).toContain(failure.diagnostics[0]!.code);
  const member = envelopes.find((envelope) => envelope.code === failure.diagnostics[0]!.code);
  expect(member?.file).toEqual(FILE);
  expect(member?.line).toEqual(failure.diagnostics[0]!.line);
  expect(member?.severity).toEqual('error');
  expect(member?.phase).toEqual('build');
});

test('the rollup-carried record (this.error projection) walks out the same way', () => {
  resetBuildExitRecords();
  const failure = compiledFailingModule();
  // The shape Vite's this.error() puts on the thrown build error (#1413).
  const rollupError = Object.assign(new Error(failure.message), {
    id: FILE,
    loc: {
      file: FILE,
      line: failure.diagnostics[0]!.line,
      column: failure.diagnostics[0]!.character,
    },
    frame: 'the rendered frame',
    diagnostics: failure.diagnostics,
  });
  const codes = buildFailureEnvelopes(rollupError).map((envelope) => envelope.code);
  expect(codes).toContain(CompilerErrorCode.DIAGNOSTICS);
  expect(codes).toContain(failure.diagnostics[0]!.code);
});

test('a coded producer failure (style plan / SSG shape) walks onto one envelope', () => {
  resetBuildExitRecords();
  const refusal = new OpenElementError('the tailwind entry is required by an admitted component', {
    code: 'OE_PRESET_TAILWIND_REQUIRED_DISABLED',
    severity: 'error',
    phase: 'build',
  });
  expect(buildFailureEnvelopes(refusal)).toEqual([
    {
      code: 'OE_PRESET_TAILWIND_REQUIRED_DISABLED',
      severity: 'error',
      phase: 'build',
      message: 'the tailwind entry is required by an admitted component',
    },
  ]);
});

test('a plain error still reports — the UNKNOWN envelope keeps the aggregate total', () => {
  resetBuildExitRecords();
  const envelopes = buildFailureEnvelopes(new Error('Cannot resolve entry module index.html'));
  expect(envelopes).toEqual([
    {
      code: ErrorCode.UNKNOWN,
      severity: 'error',
      phase: 'build',
      message: 'Cannot resolve entry module index.html',
    },
  ]);
});

test('a cause chain contributes every code, cycles included without hanging', () => {
  resetBuildExitRecords();
  const root = new OpenElementError('the sheet file is missing', {
    code: 'OE_CLIENT_BUILD_STYLE_ASSET_UNREGISTERED',
    severity: 'error',
    phase: 'build',
  });
  const mid = new OpenElementError('the client build failed', {
    code: 'OE_CLIENT_BUILD_PACKAGE_IDENTITY_UNRESOLVED',
    severity: 'error',
    phase: 'build',
    cause: root,
  });
  // A cycle: nothing may walk it forever.
  (root as { cause?: unknown }).cause = mid;
  const codes = buildFailureEnvelopes(mid).map((envelope) => envelope.code);
  expect(codes).toContain('OE_CLIENT_BUILD_STYLE_ASSET_UNREGISTERED');
  expect(codes).toContain('OE_CLIENT_BUILD_PACKAGE_IDENTITY_UNRESOLVED');
});

test('a bundler-clobbered code is never laundered into a producer code', () => {
  resetBuildExitRecords();
  // Rolldown overwrites the thrown error's `code` with its own classification
  // while the producer's severity/phase survive. The envelope keeps the
  // honest UNKNOWN code and the producer's message — never PLUGIN_ERROR.
  const clobbered = Object.assign(new Error('SSR render failed: SSG pipeline'), {
    code: 'PLUGIN_ERROR',
    severity: 'error',
    phase: 'ssr',
  });
  expect(buildFailureEnvelopes(clobbered)).toEqual([
    {
      code: ErrorCode.UNKNOWN,
      severity: 'error',
      phase: 'build',
      message: 'SSR render failed: SSG pipeline',
    },
  ]);
});

test('the flattened record rides from the compiler boundary record (#1612)', () => {
  resetBuildExitRecords();
  const failure = compiledFailingModule();
  // What the build actually throws on rolldown-vite 8: the structured record
  // is gone; the compiler plugin recorded the envelopes at the boundary.
  recordCompilerDiagnostics(failure.diagnostics);
  const flattened = Object.assign(new Error(failure.message), { code: 'PLUGIN_ERROR' });
  const report = buildExitReport(flattened);
  const codes = report.diagnostics.map((envelope) => envelope.code);
  expect(codes, `codes: ${codes.join(', ')}`).toContain(CompilerErrorCode.DIAGNOSTICS);
  expect(codes, `codes: ${codes.join(', ')}`).toContain(failure.diagnostics[0]!.code);
  const member = report.diagnostics.find(
    (envelope) => envelope.code === failure.diagnostics[0]!.code,
  );
  expect(member?.file).toEqual(FILE);
  expect(member?.line).toEqual(failure.diagnostics[0]!.line);
  expect(member?.column).toEqual(failure.diagnostics[0]!.character);
});

test('a record that survives the boundary is not duplicated by the boundary record', () => {
  resetBuildExitRecords();
  const failure = compiledFailingModule();
  // A host that preserves custom error fields hands the walker the record;
  // the boundary record for the same failure must not double the entries.
  recordCompilerDiagnostics(failure.diagnostics);
  const carrying = Object.assign(new Error(failure.message), {
    code: CompilerErrorCode.DIAGNOSTICS,
    diagnostics: failure.diagnostics,
  });
  const report = buildExitReport(carrying);
  const oecCodes = report.diagnostics
    .map((envelope) => envelope.code)
    .filter((code) => code === failure.diagnostics[0]!.code);
  expect(oecCodes).toHaveLength(1);
});

test('the exit report is ONE aggregate: warnings and the failure, every code, honest ok', () => {
  resetBuildExitRecords();
  recordBuildDiagnostic({
    code: 'OE_PACKAGE_ADMISSION_MANIFEST_LESS',
    severity: 'warning',
    phase: 'build',
    message: 'a recorded mid-build warning',
  });
  const report = buildExitReport(compiledFailingModule());
  expect(report.format).toEqual(DIAGNOSTIC_REPORT_FORMAT);
  expect(report.ok).toEqual(false);
  const codes = report.diagnostics.map((envelope) => envelope.code);
  expect(codes).toContain('OE_PACKAGE_ADMISSION_MANIFEST_LESS');
  expect(codes).toContain(CompilerErrorCode.DIAGNOSTICS);

  // The success path with only warnings stays green-side honest.
  resetBuildExitRecords();
  recordBuildDiagnostic({
    code: 'OE_PACKAGE_ADMISSION_DYNAMIC_UNPROVEN',
    severity: 'warning',
    phase: 'build',
    message: 'warn-only build',
  });
  const warningsOnly = buildExitReport(undefined);
  expect(warningsOnly.ok).toEqual(true);
  expect(warningsOnly.diagnostics.map((envelope) => envelope.code)).toEqual([
    'OE_PACKAGE_ADMISSION_DYNAMIC_UNPROVEN',
  ]);

  // A clean build answers an empty report — the exit writes nothing.
  resetBuildExitRecords();
  expect(buildExitReport(undefined)).toEqual(diagnosticReport([]));
});
