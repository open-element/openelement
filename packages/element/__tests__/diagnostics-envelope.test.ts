/**
 * The machine-readable diagnostics envelope (#1612).
 *
 * One JSON shape covers every build failure the framework surfaces: the
 * compiler's OEC diagnostics, the style plan's OE_PRESET_* refusals, the
 * admission scan's coded warnings, SSG failures and the CLI's exit path. The
 * envelope type is owned by `@openelement/protocol` (a types-only contract);
 * producers keep their own code registries and map their already-structured
 * records INTO the shape. These tests pin the contract itself:
 *
 *   - an `OpenElementError` (the one error dialect every producer raises)
 *     maps onto the envelope and round-trips through the report serializer
 *     and parser field for field;
 *   - an UNKNOWN-CODE failure still round-trips: the parser never polices
 *     the code vocabulary (producers own their registries — forward compat);
 *   - truncated or malformed consumer input fails CLOSED: a typed parse
 *     error, never a half-valid report.
 */
import { expect, test } from 'vitest';
import { CompilerErrorCode, ErrorCode, OpenElementError } from '@openelement/protocol/errors';
import {
  DiagnosticReportParseError,
  DIAGNOSTIC_REPORT_FORMAT,
  errorToEnvelope,
  parseDiagnosticReport,
  serializeDiagnosticReport,
  type DiagnosticEnvelope,
} from '@openelement/protocol/diagnostics';

test('an OpenElementError maps onto the envelope and round-trips the report channel', () => {
  const failure = new OpenElementError('the preset engine is required by this component', {
    code: 'OE_PRESET_STYLE_PROVIDER_CONFLICT',
    severity: 'error',
    phase: 'build',
  });

  const envelope = errorToEnvelope(failure);
  expect(envelope).toEqual({
    code: 'OE_PRESET_STYLE_PROVIDER_CONFLICT',
    severity: 'error',
    phase: 'build',
    message: 'the preset engine is required by this component',
  });

  // The wire form: one JSON document the consumer parses back into the same
  // fields it wrote — no display-string round trip anywhere.
  const wire = serializeDiagnosticReport({
    format: DIAGNOSTIC_REPORT_FORMAT,
    ok: false,
    diagnostics: [envelope],
  });
  const report = parseDiagnosticReport(wire);
  expect(report.format).toEqual(DIAGNOSTIC_REPORT_FORMAT);
  expect(report.ok).toEqual(false);
  expect(report.diagnostics).toEqual([envelope]);
});

test('a warning-severity diagnostic keeps the report green-side honest (ok derives from severity)', () => {
  const report = parseDiagnosticReport(
    serializeDiagnosticReport({
      format: DIAGNOSTIC_REPORT_FORMAT,
      ok: true,
      diagnostics: [
        {
          code: 'OE_PACKAGE_ADMISSION_MANIFEST_LESS',
          severity: 'warning',
          phase: 'build',
          message: 'the component package has no valid OpenElement manifest',
          file: 'node_modules/@acme/ui/dist element.ts',
          hint: 'ship a manifest export through the ./manifest subpath',
        },
      ],
    }),
  );
  expect(report.ok).toEqual(true);
  expect(report.diagnostics[0]?.hint).toEqual(
    'ship a manifest export through the ./manifest subpath',
  );
});

test('an unknown code still round-trips: the parser never polices producer registries', () => {
  // A future producer invents a code this build has never heard of. The
  // envelope is the consumption surface, not the registry: the record must
  // survive a serialize → parse trip untouched.
  const forwardCompat: DiagnosticEnvelope = {
    code: 'OE_SOMETHING_FROM_THE_FUTURE',
    severity: 'error',
    phase: 'build',
    message: 'a code this workspace does not know yet',
    file: 'app/routes/index.tsx',
    line: 3,
    column: 9,
  };
  const report = parseDiagnosticReport(
    serializeDiagnosticReport({
      format: DIAGNOSTIC_REPORT_FORMAT,
      ok: false,
      diagnostics: [forwardCompat],
    }),
  );
  expect(report.diagnostics).toEqual([forwardCompat]);
});

test('truncated consumer input fails closed', () => {
  const wire = serializeDiagnosticReport({
    format: DIAGNOSTIC_REPORT_FORMAT,
    ok: false,
    diagnostics: [
      {
        code: CompilerErrorCode.DIAGNOSTICS,
        severity: 'error',
        phase: 'build',
        message: 'one or more source-located diagnostics stopped the compile',
      },
    ],
  });
  // A consumer that reads the file while it is still being written sees the
  // prefix. The parser must refuse it, not salvage a partial report.
  expect(() => parseDiagnosticReport(wire.slice(0, Math.floor(wire.length / 2)))).toThrow(
    DiagnosticReportParseError,
  );
  // Empty and whitespace-only input are the same refusal.
  expect(() => parseDiagnosticReport('')).toThrow(DiagnosticReportParseError);
});

test('malformed consumer input fails closed, naming the structural problem', () => {
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ['not an object at all', ['openelement.diagnostics/1']],
    ['a wrong format tag', { format: 'other.tool/9', ok: true, diagnostics: [] }],
    ['ok is not a boolean', { format: DIAGNOSTIC_REPORT_FORMAT, ok: 'yes', diagnostics: [] }],
    [
      'diagnostics is not an array',
      { format: DIAGNOSTIC_REPORT_FORMAT, ok: true, diagnostics: {} },
    ],
    [
      'an entry with no code',
      {
        format: DIAGNOSTIC_REPORT_FORMAT,
        ok: true,
        diagnostics: [{ severity: 'error', phase: 'build', message: 'x' }],
      },
    ],
    [
      'an entry with an empty code',
      {
        format: DIAGNOSTIC_REPORT_FORMAT,
        ok: true,
        diagnostics: [{ code: '', severity: 'error', phase: 'build', message: 'x' }],
      },
    ],
    [
      'an entry with no message',
      {
        format: DIAGNOSTIC_REPORT_FORMAT,
        ok: true,
        diagnostics: [{ code: 'OE_X', severity: 'error', phase: 'build' }],
      },
    ],
    [
      'an entry with a non-integer line',
      {
        format: DIAGNOSTIC_REPORT_FORMAT,
        ok: true,
        diagnostics: [{ code: 'OE_X', severity: 'error', phase: 'build', message: 'x', line: 1.5 }],
      },
    ],
    [
      'an entry with a non-string severity',
      {
        format: DIAGNOSTIC_REPORT_FORMAT,
        ok: true,
        diagnostics: [{ code: 'OE_X', severity: 3, phase: 'build', message: 'x' }],
      },
    ],
  ];
  for (const [label, payload] of cases) {
    let failure: unknown;
    try {
      parseDiagnosticReport(JSON.stringify(payload));
    } catch (error) {
      failure = error;
    }
    expect(failure, label).toBeInstanceOf(DiagnosticReportParseError);
    // The typed error names what was wrong — a consumer logs it verbatim.
    expect((failure as DiagnosticReportParseError).problems.length).toBeGreaterThan(0);
  }
});

test('the parser keeps unknown envelope fields (forward compat) but never trusts a loose shape', () => {
  const wire = JSON.stringify({
    format: DIAGNOSTIC_REPORT_FORMAT,
    ok: true,
    diagnostics: [
      {
        code: ErrorCode.UNKNOWN,
        severity: 'info',
        phase: 'render',
        message: 'carries a field a future producer added',
        suggestedAction: 'a field this build does not know',
      },
    ],
  });
  const report = parseDiagnosticReport(wire);
  expect(report.diagnostics[0]).toMatchObject({ code: ErrorCode.UNKNOWN, severity: 'info' });
  expect((report.diagnostics[0] as Record<string, unknown>).suggestedAction).toEqual(
    'a field this build does not know',
  );
});
