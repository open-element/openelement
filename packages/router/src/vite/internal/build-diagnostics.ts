/**
 * build-diagnostics.ts — the build exit's diagnostics aggregation (#1612).
 *
 * The envelope TYPE is `@openelement/protocol`'s (the types-only contract);
 * this module is the router-side seam between the producers and the CLI exit:
 *
 *   - the plugins record their coded warnings here (the admission scan's
 *     report classes — the "warns through build logs" surface) alongside the
 *     human log line, so a machine-readable exit can replay them;
 *   - the CLI exit walks whatever the build threw — the compiler's structured
 *     OEC record (#1413), an `OpenElementError` from any coded producer (style
 *     plan, SSG pipeline, delivery), a plain error — onto the same envelopes;
 *   - `buildExitReport` assembles the ONE aggregate the exit writes.
 *
 * The collector is process-scoped module state BY CONTRACT: a build runs one
 * process at a time (the CLI one-shot; the test graph is sequential), and
 * `buildApp` resets it at the start of every invocation so back-to-back
 * builds in one process never leak warnings into each other's reports. The
 * dev server records into it but never reads — its failure surface is the
 * overlay, not an exit report.
 */

import type { DiagnosticEnvelope, DiagnosticReport } from '@openelement/protocol/diagnostics';
import { diagnosticReport, errorToEnvelope } from '@openelement/protocol/diagnostics';
import { CompilerErrorCode, ErrorCode, OpenElementError } from '@openelement/protocol/errors';
import {
  clearCompilerDiagnostics,
  compilerDiagnosticsToEnvelopes,
  takeCompilerDiagnostics,
} from '@openelement/compiler';
import { createLogger, formatError, type Logger } from '@openelement/element';

const log = createLogger('router-vite');

/** The warnings recorded during the current build, in report order. */
let recorded: DiagnosticEnvelope[] = [];

/** Record one build-scoped diagnostic (a coded warning) for the exit report. */
export function recordBuildDiagnostic(envelope: DiagnosticEnvelope): void {
  recorded.push(envelope);
}

/** Drain the recorded diagnostics: the exit reads them exactly once. */
export function takeBuildDiagnostics(): DiagnosticEnvelope[] {
  const drained = recorded;
  recorded = [];
  return drained;
}

/**
 * Clear BOTH producers' exit records — the router collector and the
 * compiler's boundary record (#1612). `buildApp` starts every invocation
 * here, so back-to-back builds in one process never leak into each other's
 * reports.
 */
export function resetBuildExitRecords(): void {
  recorded = [];
  clearCompilerDiagnostics();
}

// ─── Human line ─────────────────────────────────────────────────────

/**
 * Render one envelope as the human log line, keeping the `[CODE]` token
 * contract the classification rule pins (a host matches by code, never by
 * prose). The location rides in parentheses; the fix, when the producer
 * named one, closes the line.
 */
export function formatDiagnosticLine(envelope: DiagnosticEnvelope): string {
  const location = envelope.file
    ? ` (${envelope.file}${
        envelope.line !== undefined
          ? `:${envelope.line}${envelope.column !== undefined ? `:${envelope.column}` : ''}`
          : ''
      })`
    : '';
  const hint = envelope.hint ? ` ${envelope.hint}` : '';
  return `[${envelope.code}] ${envelope.message}${location}${hint}`;
}

// ─── The scan-phase fatal report (#1616) ────────────────────────────

/**
 * Report one scan-phase fatal and hand it back to throw — the established
 * log-before-throw pattern (#1616).
 *
 * WHY THIS EXISTS. On rolldown-vite 8 the bundler's `buildStart` error surface
 * does not carry the thrown message to the CLI (pre-existing; verified on the
 * alpha15 baseline): a scan-phase fatal that only THROWS is a diagnostic the
 * developer never sees — the build walks on with a half-empty scan and fails
 * later with a misleading downstream error. The interim contract, until the
 * bundler is fixed (out of scope here), is that every scan-phase fatal
 * REPORTS FIRST, through both channels of the diagnostics envelope (#1612):
 * the human line (`[CODE] …`) reaches the build log, and the envelope is
 * recorded so the machine-readable exit replays it even when the throw itself
 * is swallowed. The error is returned, not thrown, so the raise site keeps its
 * own `throw` (the fail-closed semantics stay visible at the raise site).
 *
 * Every scan-phase fatal goes through this ONE seam — a fatal that throws
 * without reporting is exactly the defect class this lane closed.
 */
export function reportScanFatal(
  error: OpenElementError,
  options: { hint?: string } = {},
): OpenElementError {
  const envelope = errorToEnvelope(error, options);
  recordBuildDiagnostic(envelope);
  log.error(formatDiagnosticLine(envelope));
  return error;
}

/**
 * Report a HANDLED failure — a recovery path that keeps serving and must not
 * swallow the reason (#1616). The dev server's recovery channels (style
 * configuration reload, candidate re-registration, descriptor rescan) catch
 * failures and keep the last good state; the report is the operator's only
 * signal, so it names the failure's code per the envelope (#1612) when the
 * failure carries one, and the prose reason either way.
 */
export function reportRecoveryFailure(channel: Logger, headline: string, error: unknown): void {
  const coded =
    error instanceof OpenElementError
      ? formatDiagnosticLine(errorToEnvelope(error))
      : formatError(error);
  channel.error(`${headline}: ${coded}`);
}

// ─── Failure walking ────────────────────────────────────────────────

/**
 * ANSI SGR escapes the bundler paints its messages with. The envelope is a
 * machine-readable surface: a consumer matching on message text must not
 * have to know what color the failure was.
 */
// Intentional ANSI color matching for the machine-readable channel.
// oxlint-disable-next-line no-control-regex
const ANSI_SGR = /\x1b\[[0-9;]*m/g;

/** Strip the bundler's color codes from one message destined for the envelope. */
function plainMessage(message: string): string {
  return message.replace(ANSI_SGR, '');
}

/**
 * The code shapes the one error dialect raises: the `OE_`-prefixed catalogue,
 * the compiler's `OEC####` records, the pre-dialect `OPEN_ELEMENT_*` values,
 * and the legacy well-known constants. Anything else on a thrown error is the
 * BUNDLER's own classification (rolldown clobbers `code` with
 * `PLUGIN_ERROR`), and the envelope must not launder it into a producer code.
 */
const PRODUCER_CODE =
  /^(?:OE_|OEC\d|OPEN_ELEMENT_|SSR_RENDER_ERROR|BOUNDARY_CAUGHT|RENDER_ERROR|UNKNOWN)/;

/**
 * The compiler's structured record as it rides a build error: the shape the
 * `this.error()` projection (#1413) puts on the thrown error, identical to
 * `CompilerDiagnostic` minus the compiler-internal range fields.
 */
interface CarriedCompilerDiagnostic {
  code: string;
  message: string;
  file: string;
  line: number;
  character: number;
}

/** Structural guard: does this value look like the compiler's record? */
function isCarriedCompilerDiagnostic(value: unknown): value is CarriedCompilerDiagnostic {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.code === 'string' &&
    record.code.length > 0 &&
    typeof record.message === 'string' &&
    typeof record.file === 'string' &&
    typeof record.line === 'number' &&
    Number.isInteger(record.line) &&
    typeof record.character === 'number'
  );
}

/** The error fields the walker reads, structurally — no instanceof across bundles. */
interface WalkerError {
  message?: unknown;
  code?: unknown;
  severity?: unknown;
  phase?: unknown;
  cause?: unknown;
  id?: unknown;
  diagnostics?: unknown;
}

/** One walk step, depth-bounded and cycle-safe. */
function walkError(
  error: unknown,
  depth: number,
  visited: Set<object>,
  out: DiagnosticEnvelope[],
): void {
  if (typeof error !== 'object' || error === null || depth > 10) return;
  if (visited.has(error)) return;
  visited.add(error);
  const source = error as WalkerError;

  const diagnostics = Array.isArray(source.diagnostics)
    ? source.diagnostics.filter(isCarriedCompilerDiagnostic)
    : [];
  if (diagnostics.length > 0) {
    // The compiler family (#1386's classification): the thrown failure IS
    // "one or more source-located diagnostics stopped the compile", so the
    // family code names WHY the build stopped and each member envelope says
    // WHERE — the same split CompilerDiagnosticError carries, read back off
    // the build-carried record.
    const first = diagnostics[0]!;
    out.push({
      code:
        typeof source.code === 'string' && source.code.startsWith('OE_')
          ? source.code
          : CompilerErrorCode.DIAGNOSTICS,
      severity: 'error',
      phase: 'build',
      message:
        typeof source.message === 'string' && source.message.length > 0
          ? plainMessage(source.message)
          : `${diagnostics.length} source-located diagnostic(s) stopped the compile`,
      file: first.file,
    });
    out.push(...compilerDiagnosticsToEnvelopes(diagnostics));
  } else if (
    typeof source.code === 'string' &&
    PRODUCER_CODE.test(source.code) &&
    typeof source.severity === 'string' &&
    typeof source.phase === 'string' &&
    typeof source.message === 'string'
  ) {
    // The one error dialect: every coded producer raises this shape, so the
    // envelope reads its fields verbatim (producers keep their codes).
    out.push(errorToEnvelope(error as never));
  } else {
    // An uncoded failure still reports — the UNKNOWN envelope keeps the
    // aggregate total, and a rollup module id rides as the file when present.
    out.push({
      code: ErrorCode.UNKNOWN,
      severity: 'error',
      phase: 'build',
      message:
        typeof source.message === 'string' && source.message.length > 0
          ? plainMessage(source.message)
          : String(error),
      ...(typeof source.id === 'string' ? { file: source.id } : {}),
    });
  }

  if (source.cause !== undefined) walkError(source.cause, depth + 1, visited, out);
}

/**
 * Map one build failure onto envelopes: the compiler's record, a coded
 * producer error, a plain error, and every cause in between — every code the
 * failure carried, in one list.
 */
export function buildFailureEnvelopes(error: unknown): DiagnosticEnvelope[] {
  const out: DiagnosticEnvelope[] = [];
  walkError(error, 0, new Set(), out);
  return out;
}

// ─── Exit assembly ──────────────────────────────────────────────────

/**
 * Assemble the exit's report: the recorded warnings (in the order the build
 * raised them) plus, on a failure, every envelope the thrown failure walks
 * out as. `ok` derives from severities — a warn-only build stays green-side
 * honest, and a clean build answers an empty report (the exit then writes
 * nothing at all).
 *
 * The compiler's boundary record (#1612) joins here: rolldown flattens the
 * structured record off the THROWN error, so the projection hosts record the
 * envelopes before `this.error()` and the exit drains them. When the walk
 * recovered the record from the thrown error anyway (a host that preserves
 * custom error fields), the drained copies are discarded; otherwise the
 * record rides from the boundary — the family envelope says why the build
 * stopped, each member envelope says where.
 */
export function buildExitReport(error: unknown): DiagnosticReport {
  const warnings = takeBuildDiagnostics();
  const failure = error === undefined ? [] : buildFailureEnvelopes(error);
  const compilerEnvelopes = takeCompilerDiagnostics();
  if (
    compilerEnvelopes.length > 0 &&
    !failure.some((envelope) => envelope.code === CompilerErrorCode.DIAGNOSTICS)
  ) {
    const first = compilerEnvelopes[0]!;
    const message =
      typeof (error as { message?: unknown } | null)?.message === 'string' &&
      (error as { message: string }).message.length > 0
        ? plainMessage((error as { message: string }).message)
        : `${compilerEnvelopes.length} source-located diagnostic(s) stopped the compile`;
    failure.unshift(
      {
        code: CompilerErrorCode.DIAGNOSTICS,
        severity: 'error',
        phase: 'build',
        message,
        file: first.file,
      },
      ...compilerEnvelopes,
    );
  }
  return diagnosticReport([...warnings, ...failure]);
}
