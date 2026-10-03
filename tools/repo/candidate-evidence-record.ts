/**
 * Candidate evidence — the record foundation (alpha6 record split).
 *
 * One CI job's proof is recorded here: the job-record shapes (`StepResult`,
 * `JobResult`, `LoadedJob`), the process primitives (`repoRoot`, `nodeExe`,
 * `required`, the `CANDIDATE_SHA`/`--expected-sha` resolution in
 * `expectedSha`, the tracked-clean probe in `assertCleanAtSha`), the step
 * runner with its SHA-free log bookkeeping (`runStep`, `toolVersions`,
 * `packedRollupFromLog`), and the workspace `--job` producer (`recordJob`,
 * whose packed extras staging derives every fact from the real gate logs —
 * never from a summary). The fresh-clone lane is its own producer module
 * (candidate-evidence-fresh-clone.ts); the audit lanes
 * (candidate-evidence-aggregate.ts / candidate-evidence-validate.ts) import
 * the shapes and primitives from here read-only, so consuming recorded
 * evidence never imports the CLI shell. Moved out of candidate-evidence.ts
 * verbatim (alpha6 architecture-debt lane): shapes, failure texts, and
 * behavior are unchanged.
 *
 * Every recorded path is normalized to the shared roles (`$SOURCE`, `$CLONE`,
 * `$TEMP`) via the candidate-steps mapping, so real machine locations stay
 * private and the validator only ever sees the roles.
 */

import { dirname, join } from '@std/path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { readPackages } from '../lib/package-graph.ts';
import { commandOutput } from './node-command.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import {
  CANDIDATE_EVIDENCE_SCHEMA_VERSION,
  cleanProofArgv,
  EVIDENCE_ROLES,
  type EvidenceToolVersions,
  type JobName,
  normalizeEvidencePath,
  type PathRoleMapping,
  STATIC_JOB_STEPS,
} from './candidate-steps.ts';
import type { ReusedStamp } from './evidence-reuse.ts';
import {
  PACKAGE_VERSION_PATTERN,
  REQUIRED_PACKAGE_TARBALLS,
  sha256Bytes,
  stageTarballEvidence,
} from './candidate-evidence-tarballs.ts';

export const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

export const nodeExe = process.execPath;

/**
 * The pre-port build identifiers spelled 'windows'/'aarch64'/'x86_64'; node
 * spells them 'win32'/'arm64'/'x64'. The evidence record strings must stay
 * byte-identical across the port, so translate instead of rewording.
 */
function evidenceOs(): string {
  return process.platform === 'win32' ? 'windows' : process.platform;
}

function evidenceArch(): string {
  if (process.arch === 'arm64') return 'aarch64';
  if (process.arch === 'x64') return 'x86_64';
  return process.arch;
}

/** One step of a job's result.json record. */
export interface StepResult {
  name: string;
  command: string[];
  /** Role-normalized execution directory ($SOURCE/$CLONE/$TEMP). */
  cwd: string;
  startedAt: string;
  durationMs: number;
  exitCode: number;
  result: 'PASS' | 'FAIL';
  logPath: string;
  logSha256: string;
  counts?: Record<string, number>;
  note?: string;
}

/** One job's result.json record. */
export interface JobResult {
  schemaVersion: typeof CANDIDATE_EVIDENCE_SCHEMA_VERSION;
  job: JobName;
  sha: string;
  tree: string;
  trackedClean: true;
  result: 'PASS' | 'FAIL';
  /**
   * Present only on a job whose proof was replayed from a tree-identical run
   * (#1425 follow-up, tools/repo/evidence-reuse.ts). It is what licenses `sha`
   * to differ from the candidate commit.
   */
  reused?: ReusedStamp;
  steps: StepResult[];
  toolVersions: EvidenceToolVersions;
  extras?: Record<string, unknown>;
  generatedAt: string;
}

/** One job result loaded from a downloaded evidence directory. */
export interface LoadedJob {
  job: JobResult;
  dir: string;
  read: (path: string) => Promise<Uint8Array | null>;
}

export async function required(command: string, args: string[]): Promise<string> {
  const output = await commandOutput(command, {
    args,
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'piped',
  });
  const text =
    new TextDecoder().decode(output.stdout).trim() + new TextDecoder().decode(output.stderr).trim();
  if (!output.success) throw new Error(`${command} ${args.join(' ')} failed: ${text}`);
  return text;
}

/** Read one `--<name> <value>` flag from the argv of this tool family's CLI. */
export function flagValue(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

export function expectedSha(): string {
  const value = flagValue('expected-sha') ?? process.env['CANDIDATE_SHA'];
  if (!value || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error('Set CANDIDATE_SHA (or --expected-sha) to the exact 40-character SHA.');
  }
  return value;
}

export async function assertCleanAtSha(expected: string): Promise<{ sha: string; tree: string }> {
  const sha = await required('git', ['rev-parse', 'HEAD']);
  if (sha !== expected) {
    throw new Error(`Candidate SHA mismatch: expected ${expected}, checked out ${sha}.`);
  }
  for (const args of [
    ['diff', '--quiet'],
    ['diff', '--cached', '--quiet'],
  ]) {
    const result = await commandOutput('git', { args, cwd: repoRoot });
    if (!result.success) {
      throw new Error(`Candidate requires a tracked-clean worktree (git ${args.join(' ')}).`);
    }
  }
  return { sha, tree: await required('git', ['rev-parse', 'HEAD^{tree}']) };
}

function stripAnsi(text: string): string {
  // Intentional ANSI color stripping for log scans.
  // oxlint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function gateStepCounts(text: string): { pass: number; fail: number } {
  return {
    pass: (text.match(/^PASS .+ \(\d+\.\d+s\)$/gm) ?? []).length,
    fail: (text.match(/^FAIL .+ \(\d+\.\d+s\)$/gm) ?? []).length,
  };
}

async function playwrightBrowserVersions(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  for (const cache of [
    join(home, '.cache/ms-playwright'),
    join(home, 'Library/Caches/ms-playwright'),
    join('C:', 'Users', 'runneradmin', 'AppData', 'Local', 'ms-playwright'),
  ]) {
    try {
      for (const entry of await readdir(cache, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const match = /^(chromium|firefox|webkit|ffmpeg|chromium_headless_shell)-(.+)$/.exec(
          entry.name,
        );
        if (match) out[match[1]] = match[2];
      }
      if (Object.keys(out).length > 0) return out;
    } catch {
      // Cache absent on this machine; keep looking.
    }
  }
  out['status'] = 'ms-playwright cache not found';
  return out;
}

/**
 * The workspace TypeScript version, taken from the installed dependency —
 * `node_modules/typescript/package.json` — the exact copy the workspace gates
 * typechecked with. `process.versions.typescript` was the Deno-era source
 * (Deno ships its own TypeScript); Node's `process.versions` has no such
 * field, so under the Node surface the key silently serialised away and the
 * validator rejected every producer record. A registry probe or a constant
 * would record a version the gates never ran, so this fails closed instead.
 */
export async function workspaceTypescriptVersion(root: string): Promise<string> {
  const manifestPath = join(root, 'node_modules', 'typescript', 'package.json');
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (cause) {
    throw new Error(
      `evidence toolVersions: TypeScript version unavailable — ${manifestPath} is not readable ` +
        `(${cause instanceof Error ? cause.message : String(cause)}); install the workspace ` +
        `(pnpm install) so the recorded version is the one the gates actually ran.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `evidence toolVersions: ${manifestPath} is not valid JSON; refusing to record a fabricated version.`,
    );
  }
  const version =
    typeof parsed === 'object' && parsed !== null && 'version' in parsed
      ? (parsed as { version: unknown }).version
      : undefined;
  if (typeof version !== 'string' || version === '') {
    throw new Error(
      `evidence toolVersions: ${manifestPath} has no non-empty version string; refusing to record a fabricated version.`,
    );
  }
  return version;
}

export async function toolVersions(): Promise<EvidenceToolVersions> {
  const [node, npm, pnpm, typescript] = await Promise.all([
    required('node', ['--version']).catch(() => 'unavailable'),
    required('npm', ['--version']).catch(() => 'unavailable'),
    required('pnpm', ['--version']).catch(() => 'unavailable'),
    workspaceTypescriptVersion(repoRoot),
  ]);
  return {
    node,
    pnpm,
    v8: process.versions.v8!,
    typescript,
    npm,
    os: `${evidenceOs()}/${evidenceArch()}`,
    playwrightBrowsers: await playwrightBrowserVersions(),
  };
}

async function runStep(
  name: string,
  command: string[],
  outDir: string,
  cwd: string = repoRoot,
  roles: PathRoleMapping = [],
): Promise<StepResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const logPath = `logs/${name}.log`;
  const output = await commandOutput(command[0], {
    args: command.slice(1),
    cwd,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  });
  const text = new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr);
  await writeFile(join(outDir, logPath), text, 'utf8');
  return {
    name,
    command: command.map((element) => normalizeEvidencePath(element, roles)),
    cwd: normalizeEvidencePath(cwd, roles),
    startedAt,
    durationMs: Date.now() - started,
    exitCode: output.code,
    result: output.success ? 'PASS' : 'FAIL',
    logPath,
    logSha256: await sha256Bytes(new TextEncoder().encode(text)),
  };
}

const PACKED_CONSUMER_STEP = /^PASS ((?:tools|apps|tests)\/[^\s(]+#(?:consumer:[^\s(]+|smoke))\b/m;

/** Derive packed-gate facts from the real gate log, never from a summary. */
export function packedRollupFromLog(logText: string): {
  artifactCheck: boolean;
  consumers: string[];
} {
  const consumers = [
    ...stripAnsi(logText).matchAll(new RegExp(PACKED_CONSUMER_STEP.source, 'gm')),
  ].map((match) => match[1]);
  return {
    artifactCheck: /^PASS tools\/release#package-artifacts:check\b/m.test(stripAnsi(logText)),
    consumers: [...new Set(consumers)].sort(),
  };
}

async function packExtras(
  packedSteps: StepResult[],
  outDir: string,
): Promise<Record<string, unknown>> {
  const gatePacked = packedSteps.find((step) => step.name === 'gate-packed');
  const packedText = gatePacked ? await readFile(join(outDir, gatePacked.logPath), 'utf8') : '';
  const { artifactCheck, consumers } = packedRollupFromLog(packedText);

  const publish = packedSteps.find((step) => step.name === 'publish-npm-dry-run');
  const text = publish ? await readFile(join(outDir, publish.logPath), 'utf8') : '';
  const packSummaries = [
    ...stripAnsi(text).matchAll(
      /\[npm\] (@openelement\/\S+): pack diagnostics errors=(\d+) unexpectedWarnings=(\d+) knownUpstreamPrivateWarnings=(\d+) publicDeclarations=(\d+) declarationClosure=(\d+)/g,
    ),
  ].map((match) => ({
    package: match[1],
    errors: Number(match[2]),
    unexpectedWarnings: Number(match[3]),
    knownUpstreamPrivateWarnings: Number(match[4]),
    publicDeclarations: Number(match[5]),
    declarationClosure: Number(match[6]),
  }));
  if (packSummaries.length < 4) {
    throw new Error(
      `publish dry-run printed ${packSummaries.length} pack summaries, expected 4 (one per package).`,
    );
  }
  const packages = (await readPackages()).filter((pkg) =>
    REQUIRED_PACKAGE_TARBALLS.includes(pkg.name as (typeof REQUIRED_PACKAGE_TARBALLS)[number]),
  );
  const versions = new Set(packages.map((pkg) => pkg.version));
  if (versions.size !== 1) {
    throw new Error(
      `Candidate packages must share one version; found ${
        [...versions].sort().join(', ') || 'none'
      }.`,
    );
  }
  const packageVersion = packages[0]?.version ?? '';
  if (!PACKAGE_VERSION_PATTERN.test(packageVersion)) {
    throw new Error(`Candidate packageVersion is malformed: ${JSON.stringify(packageVersion)}.`);
  }
  const { hashes: tarballs, files: tarballFiles } = await stageTarballEvidence(
    packages,
    (pkg) => tarballPath(pkg),
    outDir,
  );
  for (const [label, keys] of [
    ['tarballs', tarballs],
    ['tarballFiles', tarballFiles],
  ] as const) {
    const actual = Object.keys(keys).sort();
    const expected = [...REQUIRED_PACKAGE_TARBALLS].sort();
    if (actual.join(',') !== expected.join(',')) {
      throw new Error(
        `Candidate ${label} must contain exactly ${expected.join(', ')}; found ${
          actual.join(', ') || 'none'
        }.`,
      );
    }
  }
  return {
    packageVersion,
    tarballs,
    tarballFiles,
    packDiagnostics: packSummaries,
    artifactCheck,
    consumers,
  };
}

/** Role mapping for workspace jobs: the repository root is $SOURCE. */
const SOURCE_ROLES: PathRoleMapping = [[repoRoot, EVIDENCE_ROLES.source]];

export async function recordJob(
  job: Exclude<JobName, 'fresh-clone'>,
  outDir: string,
): Promise<void> {
  const expected = expectedSha();
  const { sha, tree } = await assertCleanAtSha(expected);
  await mkdir(join(outDir, 'logs'), { recursive: true });
  const steps: StepResult[] = [];
  const runCleanProof = async (phase: 'before' | 'after'): Promise<void> => {
    const name = `workspace-clean-${phase}`;
    const argv = [nodeExe, ...cleanProofArgv(sha, tree, phase).slice(1)];
    console.log(`[evidence] ${job}: ${name}: ${argv.join(' ')}`);
    const step = await runStep(name, argv, outDir, repoRoot, SOURCE_ROLES);
    steps.push(step);
    console.log(
      `[evidence] ${job}: ${step.result} ${name} (${(step.durationMs / 1000).toFixed(1)}s)`,
    );
  };
  // Clean proofs bracket the gates so trackedClean is derived, not asserted.
  await runCleanProof('before');
  for (const { name, command } of STATIC_JOB_STEPS[job]) {
    const argv = [...command];
    console.log(`[evidence] ${job}: ${name}: ${argv.join(' ')}`);
    const step = await runStep(name, argv, outDir, repoRoot, SOURCE_ROLES);
    if (name === 'gate-source' || name === 'gate-packed') {
      const text = await readFile(join(outDir, step.logPath), 'utf8');
      step.counts = gateStepCounts(text);
    }
    steps.push(step);
    console.log(
      `[evidence] ${job}: ${step.result} ${name} (${(step.durationMs / 1000).toFixed(1)}s)`,
    );
  }
  await runCleanProof('after');
  // Site E2E proof is owned by the fresh-clone lane (the trimmed source gate
  // does not build or drive the Site), so this producer records no siteE2e
  // key at all — a missing key is rejected at aggregation, never faked here.
  const extras = job === 'packed' ? await packExtras(steps, outDir) : undefined;
  const result: JobResult = {
    schemaVersion: CANDIDATE_EVIDENCE_SCHEMA_VERSION,
    job,
    sha,
    tree,
    trackedClean: true,
    result: steps.every((step) => step.result === 'PASS') ? 'PASS' : 'FAIL',
    steps,
    toolVersions: await toolVersions(),
    extras,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  if (result.result !== 'PASS') process.exit(1);
}
