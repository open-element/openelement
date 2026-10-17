/**
 * diagnostics.ts — the machine-readable diagnostic envelope (#1612).
 *
 * One JSON shape covers every failure the framework surfaces to a build exit:
 * the compiler's `OEC####` diagnostics, the style plan's `OE_PRESET_*`
 * refusals, the admission scan's coded warnings, the SSG pipeline's `OE_SSG_*`
 * failures and the CLI's own exit path. Before this module each surface
 * reported its own way and a consumer had to know which log to read; the
 * envelope is the one consumption surface an agent (or a human) reads instead.
 *
 * Ownership follows the producers: the ENVELOPE is owned here (a types-only
 * contract, like the rest of this package); the CODES stay with their
 * producers (`@openelement/compiler`, `@openelement/element`, and the router
 * own their registries). Nothing here validates a code against any registry —
 * a producer this workspace has never heard of still round-trips, which is
 * the forward-compatibility clause #1612 pins.
 *
 * Like `errors.ts`, this module is import-free except for the error contract
 * it maps from, so every producer can adopt the shape without gaining host,
 * bundler, or mutable module state.
 */

import { OpenElementError } from './errors.ts';

// ─── Vocabularies ───────────────────────────────────────────────────

/**
 * How severe one diagnostic is. `error` fails the build, `warning` reports a
 * recoverable defect, `info` is reserved for advisories. The build report's
 * `ok` flag derives from this: any `error` diagnostic makes the report not-ok.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * The pipeline phase a diagnostic was raised in — the same vocabulary the
 * error contract's {@linkcode ErrorPhase} uses, so a producer's code, phase
 * and envelope cannot disagree about where a failure happened.
 */
export type DiagnosticPhase =
  | 'render'
  | 'ssr'
  | 'csr'
  | 'build'
  | 'navigation'
  | 'validation'
  | 'unknown';

// ─── The envelope ───────────────────────────────────────────────────

/**
 * One machine-readable diagnostic: the producer's stable code, where the
 * failure sits (`file`, `line`, `column` — absent when the producer has no
 * source location, e.g. a configuration refusal), what happened
 * (`message`), and when known, the fix (`hint`).
 *
 * `line`/`column` are 1-based, matching the diagnostics the compiler records
 * from TypeScript source positions. Unknown envelope fields are tolerated on
 * the wire (forward compat); the required core is exactly these fields.
 */
export interface DiagnosticEnvelope {
  /** The producer's own stable code (`OEC9020`, `OE_PRESET_*`, `OE_SSG_*`). */
  code: string;
  severity: DiagnosticSeverity;
  phase: DiagnosticPhase;
  /** What happened, in the producer's own words. */
  message: string;
  /** The source file (or module specifier) the diagnostic points at. */
  file?: string;
  /** 1-based authored line, when the producer has a source location. */
  line?: number;
  /** 1-based authored column, when the producer has a source location. */
  column?: number;
  /** The fix, when the producer can name one. */
  hint?: string;
}

// ─── The aggregate report ───────────────────────────────────────────

/**
 * The `format` discriminator every report carries. Consumers branch on it
 * instead of guessing: a future shape change mints a new tag rather than
 * reinterpreting old bytes.
 */
export const DIAGNOSTIC_REPORT_FORMAT = 'openelement.diagnostics/1';

/** One format tag value (kept as a type for the report's `format` field). */
export type DiagnosticReportFormat = typeof DIAGNOSTIC_REPORT_FORMAT;

/**
 * One build exit's diagnostics: the format tag, whether the run is clean
 * (`ok` is false the moment any diagnostic carries severity `error`), and
 * every diagnostic the exit collected. This is the document the CLI writes to
 * the stream and the diagnostics file — one aggregate containing every code.
 */
export interface DiagnosticReport {
  format: DiagnosticReportFormat;
  ok: boolean;
  diagnostics: DiagnosticEnvelope[];
}

/**
 * Assemble the exit's report. `ok` derives from the diagnostics' severities,
 * never from a caller's optimism: one `error` severity is enough to fail it.
 */
export function diagnosticReport(diagnostics: DiagnosticEnvelope[]): DiagnosticReport {
  return {
    format: DIAGNOSTIC_REPORT_FORMAT,
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    diagnostics,
  };
}

/** Serialize a report for the stream/file channel: one line, no trailing newline. */
export function serializeDiagnosticReport(report: DiagnosticReport): string {
  return JSON.stringify(report);
}

/**
 * Raised by {@linkcode parseDiagnosticReport} when the text is not a
 * consumable report. Fail closed: a consumer that catches this knows the
 * channel answered garbage — never a half-valid report.
 */
export class DiagnosticReportParseError extends Error {
  /** Every structural problem found, in input order. */
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      problems.length === 1
        ? `malformed diagnostics report: ${problems[0]}`
        : `malformed diagnostics report (${problems.length} problems): ${problems.join('; ')}`,
    );
    this.name = 'DiagnosticReportParseError';
    this.problems = problems;
  }
}

/** One structural validation failure: where in the report, and what was wrong. */
function problem(at: string, expected: string): string {
  return `${at}: expected ${expected}`;
}

/**
 * Validate one envelope entry. Structure only — the code (and, for forward
 * compat, the severity/phase spellings) are the producers' vocabulary and are
 * never policed here; the field PRESENCE and PRIMITIVE TYPES are.
 * Unknown fields pass through untouched, so a future producer's extra fields
 * survive the round trip.
 */
function parseEnvelope(value: unknown, at: string): DiagnosticEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DiagnosticReportParseError([problem(at, 'a diagnostic object')]);
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof record.code !== 'string' || record.code.length === 0) {
    problems.push(problem(`${at}.code`, 'a non-empty string'));
  }
  if (typeof record.severity !== 'string' || record.severity.length === 0) {
    problems.push(problem(`${at}.severity`, 'a non-empty string'));
  }
  if (typeof record.phase !== 'string' || record.phase.length === 0) {
    problems.push(problem(`${at}.phase`, 'a non-empty string'));
  }
  if (typeof record.message !== 'string') {
    problems.push(problem(`${at}.message`, 'a string'));
  }
  for (const field of ['file', 'hint'] as const) {
    const value = record[field];
    if (value !== undefined && typeof value !== 'string') {
      problems.push(problem(`${at}.${field}`, 'a string when present'));
    }
  }
  for (const field of ['line', 'column'] as const) {
    const value = record[field];
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    ) {
      problems.push(problem(`${at}.${field}`, 'a positive integer when present'));
    }
  }
  if (problems.length > 0) throw new DiagnosticReportParseError(problems);
  return record as unknown as DiagnosticEnvelope;
}

/**
 * Parse one report off the wire. Fails closed: truncated JSON, a foreign
 * format tag, or any structurally broken diagnostic raises
 * {@linkcode DiagnosticReportParseError} instead of returning a partial
 * report a consumer might mistake for the truth.
 */
export function parseDiagnosticReport(text: string): DiagnosticReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new DiagnosticReportParseError([
      `not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    ]);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DiagnosticReportParseError([problem('report', 'a JSON object')]);
  }
  const record = parsed as Record<string, unknown>;
  const problems: string[] = [];
  if (record.format !== DIAGNOSTIC_REPORT_FORMAT) {
    problems.push(
      problem(
        'report.format',
        `the literal "${DIAGNOSTIC_REPORT_FORMAT}" (got ${JSON.stringify(record.format)})`,
      ),
    );
  }
  if (typeof record.ok !== 'boolean') {
    problems.push(problem('report.ok', 'a boolean'));
  }
  if (!Array.isArray(record.diagnostics)) {
    problems.push(problem('report.diagnostics', 'an array'));
  }
  if (problems.length > 0) throw new DiagnosticReportParseError(problems);

  const diagnostics = (record.diagnostics as unknown[]).map((entry, index) =>
    parseEnvelope(entry, `report.diagnostics[${index}]`),
  );
  return {
    format: record.format as DiagnosticReportFormat,
    ok: record.ok as boolean,
    diagnostics,
  };
}

// ─── Producer mapping ───────────────────────────────────────────────

/**
 * Map the one error dialect ({@linkcode OpenElementError} — every producer's
 * raiser goes through it) onto the envelope. The error's code, severity and
 * phase ARE the envelope's; the message carries verbatim. Producers with a
 * fix pass it as `hint`.
 */
export function errorToEnvelope(
  error: OpenElementError,
  options: { hint?: string } = {},
): DiagnosticEnvelope {
  return {
    code: error.code,
    severity: error.severity,
    phase: error.phase,
    message: error.message,
    ...(options.hint !== undefined ? { hint: options.hint } : {}),
  };
}
