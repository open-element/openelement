/**
 * The build CLI's machine-readable exit contract (#1612).
 *
 * `openelement build` keeps its human output and exit codes verbatim; the
 * diagnostics flags ADD one machine-readable channel:
 *
 *   `--diagnostics=json`        one JSON report line on stderr,
 *   `--diagnostics-file=<path>` the same document written to a file.
 *
 * A build that produced no diagnostics writes nothing at all — the flags
 * open the channel, the diagnostics fill it. These tests drive the REAL CLI
 * in a scratch directory (no app → the build fails, exactly the cli-bin
 * contract's fixture) and consume the report as JSON, never by grepping
 * prose.
 */
import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIAGNOSTIC_REPORT_FORMAT, type DiagnosticReport } from '@openelement/protocol/diagnostics';
import { parseDiagnosticsChannels, writeDiagnosticsExit } from '../src/cli/diagnostics-exit.ts';
import { resetBuildExitRecords } from '../src/vite/internal/build-diagnostics.ts';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const CLI_BIN = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'cli.ts');

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], cwd: string): Promise<CliRun> {
  const child = spawn(process.execPath, [CLI_BIN, ...args], { cwd });
  const [out, err] = await Promise.all([
    Array.fromAsync(child.stdout),
    Array.fromAsync(child.stderr),
  ]);
  const code = await new Promise<number>((resolve) => {
    child.once('exit', (c) => resolve(c ?? -1));
  });
  return {
    code,
    stdout: Buffer.concat(out).toString(),
    stderr: Buffer.concat(err).toString(),
  };
}

/** Parse every stderr line that claims to be a diagnostics report. */
function reportLines(stderr: string): DiagnosticReport[] {
  const reports: DiagnosticReport[] = [];
  for (const line of stderr.split('\n')) {
    if (!line.startsWith('{"format":')) continue;
    reports.push(JSON.parse(line) as DiagnosticReport);
  }
  return reports;
}

// ─── Flag parsing (unit) ────────────────────────────────────────────

test('diagnostics flags parse: json stream, file path, both, or neither', () => {
  expect(parseDiagnosticsChannels([])).toEqual({ stream: false, file: undefined });
  expect(parseDiagnosticsChannels(['--diagnostics=json'])).toEqual({
    stream: true,
    file: undefined,
  });
  expect(parseDiagnosticsChannels(['--diagnostics-file=oe-diag.json'])).toEqual({
    stream: false,
    file: 'oe-diag.json',
  });
  expect(
    parseDiagnosticsChannels(['--diagnostics=json', '--diagnostics-file=/tmp/d.json']),
  ).toEqual({ stream: true, file: '/tmp/d.json' });
});

test('an unsupported --diagnostics value fails the usage, never silently ignores', () => {
  expect(() => parseDiagnosticsChannels(['--diagnostics=xml'])).toThrow(/--diagnostics=json/);
  expect(() => parseDiagnosticsChannels(['--diagnostics-file='])).toThrow(/path/);
});

test('a clean exit writes nothing even when the channel is open', () => {
  resetBuildExitRecords();
  const stderr: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    writeDiagnosticsExit({ stream: true, file: '/nonexistent-dir-oe/diag.json' }, undefined);
  } finally {
    process.stderr.write = original;
  }
  expect(stderr).toEqual([]);
  expect(existsSync('/nonexistent-dir-oe/diag.json')).toBe(false);
});

// ─── The real CLI exit (spawned, failing build) ─────────────────────

test('the failing build CLI answers --diagnostics=json with one report line beside the human output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-diag-exit-'));
  try {
    const run = await runCli(['build', '--diagnostics=json'], dir);
    expect(run.code).toEqual(1);
    // The human output is untouched.
    expect(run.stderr).toContain('Build failed:');
    // The machine-readable answer: exactly one parseable report line.
    const reports = reportLines(run.stderr);
    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report.format).toEqual(DIAGNOSTIC_REPORT_FORMAT);
    expect(report.ok).toEqual(false);
    expect(report.diagnostics.length).toBeGreaterThan(0);
    expect(report.diagnostics.every((diagnostic) => typeof diagnostic.code === 'string')).toBe(
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);

test('the failing build CLI writes the same aggregate to --diagnostics-file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-diag-exit-'));
  const file = join(dir, 'diagnostics', 'oe-diagnostics.json');
  try {
    const run = await runCli(['build', `--diagnostics-file=${file}`], dir);
    expect(run.code).toEqual(1);
    expect(run.stderr).toContain('Build failed:');
    // No stream line when only the file was asked for.
    expect(reportLines(run.stderr)).toEqual([]);
    // The harness reads the FILE as JSON — one aggregate with every code.
    const report = JSON.parse(await readFile(file, 'utf8')) as DiagnosticReport;
    expect(report.format).toEqual(DIAGNOSTIC_REPORT_FORMAT);
    expect(report.ok).toEqual(false);
    expect(report.diagnostics.length).toBeGreaterThan(0);
    const codes = report.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain('UNKNOWN');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);

test('without the flags the failing CLI prints human output only — no report line appears', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-diag-exit-'));
  try {
    const run = await runCli(['build'], dir);
    expect(run.code).toEqual(1);
    expect(run.stderr).toContain('Build failed:');
    expect(reportLines(run.stderr)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
