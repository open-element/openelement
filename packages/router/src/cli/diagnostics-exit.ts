/**
 * cli/diagnostics-exit.ts — the build CLI's machine-readable exit (#1612).
 *
 * The stable exit contract: participating gates emit a machine-readable
 * diagnostics aggregate ALONGSIDE the human output, on request:
 *
 *   openelement build --diagnostics=json        one JSON report line on stderr
 *   openelement build --diagnostics-file=<path> the same document to a file
 *
 * Both channels carry the same document (`DiagnosticReport` from
 * `@openelement/protocol/diagnostics`): every coded diagnostic the build
 * raised — the recorded warnings plus whatever the failure walked out as —
 * in one aggregate. A build that produced no diagnostics writes nothing, and
 * the channels never change the verdict: the human output and the exit code
 * stay exactly what they were before the flags existed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { serializeDiagnosticReport } from '@openelement/protocol/diagnostics';
import { buildExitReport } from '../vite/internal/build-diagnostics.ts';

/** The channels the diagnostics flags opened for one CLI run. */
export interface DiagnosticsChannels {
  /** `--diagnostics=json`: the report rides stderr as one JSON line. */
  stream: boolean;
  /** `--diagnostics-file=<path>`: the report is written to this file. */
  file?: string;
}

/**
 * Parse the diagnostics flags out of the build subcommand's argv. Unknown
 * flags are not this module's business (the build CLI never rejected them);
 * a diagnostics flag with an unsupported value fails the usage loudly — a
 * silently dropped channel would answer a consumer's read with nothing.
 */
export function parseDiagnosticsChannels(argv: string[]): DiagnosticsChannels {
  const channels: DiagnosticsChannels = { stream: false, file: undefined };
  for (const arg of argv) {
    if (arg === '--diagnostics=json') {
      channels.stream = true;
      continue;
    }
    if (arg.startsWith('--diagnostics=')) {
      throw new Error(
        `Unsupported --diagnostics value "${arg.slice('--diagnostics='.length)}"; ` +
          'the supported form is --diagnostics=json (or --diagnostics-file=<path>)',
      );
    }
    if (arg.startsWith('--diagnostics-file=')) {
      const path = arg.slice('--diagnostics-file='.length);
      if (path.length === 0) {
        throw new Error('--diagnostics-file requires a file path: --diagnostics-file=<path>');
      }
      channels.file = path;
      continue;
    }
  }
  return channels;
}

/**
 * Write the run's diagnostics aggregate to every opened channel. Called
 * exactly once per CLI run — success or failure — after the human output;
 * a report with no diagnostics writes nothing at all. A file-channel failure
 * is reported to stderr but never masks the build's own verdict.
 */
export function writeDiagnosticsExit(channels: DiagnosticsChannels, error: unknown): void {
  if (!channels.stream && channels.file === undefined) return;
  // The collector starts empty for this run (buildApp reset it) and the
  // failure walk reads the thrown error; drain the warnings either way so a
  // second exit in one process cannot replay them.
  const report = buildExitReport(error);
  if (report.diagnostics.length === 0) return;
  const wire = `${serializeDiagnosticReport(report)}\n`;
  if (channels.stream) {
    process.stderr.write(wire);
  }
  if (channels.file !== undefined) {
    try {
      mkdirSync(dirname(channels.file), { recursive: true });
      writeFileSync(channels.file, wire, 'utf8');
    } catch (cause) {
      console.error(
        `[openelement] could not write the diagnostics file ${channels.file}: ` +
          `${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
}
