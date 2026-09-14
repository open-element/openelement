/**
 * Candidate evidence: record one CI job's proof, aggregate job proofs, or
 * validate an aggregated artifact.
 *
 * The evidence system never re-runs the suite in the aggregation step:
 *
 *   fast-checks  -> job result (fmt/lint/markdown/typecheck + OSS scanners)
 *   source-matrix-> gate:source + permission/FFI scans
 *   packed       -> gate:packed + publish:npm:dry-run + tarball hashes +
 *                   structured pack diagnostics
 *   fresh-clone  -> clean clone, empty DENO_DIR/npm cache, install, check,
 *                   source gate, release check
 *
 * Each `--job` run writes `<out>/result.json` plus `<out>/logs/*.log`; the
 * result records command, exit code, result, log path, and the log SHA-256.
 * `--aggregate` reads the downloaded job results, requires one commit/tree,
 * recomputes every log hash, and writes the candidate evidence JSON next to
 * the tarball manifest, fresh-clone manifest, and pack diagnostic summary.
 * `--validate` re-checks a written artifact (SHA/tree, log presence + hashes,
 * manifest hashes, artifact age) without trusting its contents.
 *
 * All commands run with stdin closed (non-interactive invariant).
 */

import { dirname, join, relative } from '@std/path';
import { readPackages } from '../lib/package-graph.ts';
import { auditSiteE2e, type SiteE2eResult } from './site-e2e-result.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import {
  auditFreshCloneIsolation,
  auditStepCommand,
  FRESH_CLONE_ISOLATION,
  freshCloneCommands,
  JOB_NAMES,
  type JobName,
  REQUIRED_STEPS,
  STATIC_JOB_STEPS,
} from './candidate-steps.ts';

export { JOB_NAMES, REQUIRED_STEPS } from './candidate-steps.ts';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const ARTIFACT_RETENTION_DAYS = 14;

/** Required production-package tarball keys; extras or fakes are rejected. */
export const REQUIRED_PACKAGE_TARBALLS: readonly string[] = [
  '@openelement/element',
  '@openelement/router',
  '@openelement/create',
  '@openelement/ui',
];

/**
 * Required packed-consumer proof set. Kept as the single canonical list that
 * the validator and its tests share; a task-wiring guard asserts every entry
 * appears in the gate:packed definition so the two cannot drift.
 */
export const REQUIRED_PACKED_CONSUMERS: readonly string[] = [
  'tools/release#consumer:packaged',
  'tools/release#consumer:packaged-app',
  'tools/release#consumer:packaged-router',
  'tools/release#consumer:packaged-element',
  'tools/release#consumer:packaged-ui',
  'tests/fixtures/third-party-web-components#smoke',
];

/** Site E2E projects (single canonical list lives in site-e2e-result.ts). */
export { SITE_E2E_PROJECTS as REQUIRED_SITE_BROWSERS } from './site-e2e-result.ts';

interface StepResult {
  name: string;
  command: string[];
  startedAt: string;
  durationMs: number;
  exitCode: number;
  result: 'PASS' | 'FAIL';
  logPath: string;
  logSha256: string;
  counts?: Record<string, number>;
  note?: string;
}

interface JobResult {
  schemaVersion: 1;
  job: JobName;
  sha: string;
  tree: string;
  trackedClean: true;
  result: 'PASS' | 'FAIL';
  steps: StepResult[];
  toolVersions: Record<string, unknown>;
  extras?: Record<string, unknown>;
  generatedAt: string;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return 'sha256:' +
    Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function required(command: string, args: string[]): Promise<string> {
  const output = await new Deno.Command(command, {
    args,
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const text = new TextDecoder().decode(output.stdout).trim() +
    new TextDecoder().decode(output.stderr).trim();
  if (!output.success) throw new Error(`${command} ${args.join(' ')} failed: ${text}`);
  return text;
}

function flagValue(name: string): string | undefined {
  const index = Deno.args.indexOf(`--${name}`);
  return index === -1 ? undefined : Deno.args[index + 1];
}

function expectedSha(): string {
  const value = flagValue('expected-sha') ?? Deno.env.get('CANDIDATE_SHA');
  if (!value || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error('Set CANDIDATE_SHA (or --expected-sha) to the exact 40-character SHA.');
  }
  return value;
}

const denoExe = Deno.execPath();

async function assertCleanAtSha(expected: string): Promise<{ sha: string; tree: string }> {
  const sha = await required('git', ['rev-parse', 'HEAD']);
  if (sha !== expected) {
    throw new Error(`Candidate SHA mismatch: expected ${expected}, checked out ${sha}.`);
  }
  for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']]) {
    const result = await new Deno.Command('git', { args, cwd: repoRoot }).output();
    if (!result.success) {
      throw new Error(`Candidate requires a tracked-clean worktree (git ${args.join(' ')}).`);
    }
  }
  return { sha, tree: await required('git', ['rev-parse', 'HEAD^{tree}']) };
}

function stripAnsi(text: string): string {
  // Intentional ANSI color stripping for log scans.
  // deno-lint-ignore no-control-regex
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
  const home = Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE') ?? '';
  for (
    const cache of [
      join(home, '.cache/ms-playwright'),
      join(home, 'Library/Caches/ms-playwright'),
      join('C:', 'Users', 'runneradmin', 'AppData', 'Local', 'ms-playwright'),
    ]
  ) {
    try {
      for await (const entry of Deno.readDir(cache)) {
        if (!entry.isDirectory) continue;
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

async function toolVersions(): Promise<Record<string, unknown>> {
  const [node, npm] = await Promise.all([
    required('node', ['--version']).catch(() => 'unavailable'),
    required('npm', ['--version']).catch(() => 'unavailable'),
  ]);
  return {
    deno: Deno.version.deno,
    v8: Deno.version.v8,
    typescript: Deno.version.typescript,
    node,
    npm,
    os: `${Deno.build.os}/${Deno.build.arch}`,
    playwrightBrowsers: await playwrightBrowserVersions(),
  };
}

async function runStep(
  name: string,
  command: string[],
  outDir: string,
): Promise<StepResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const logPath = `logs/${name}.log`;
  const output = await new Deno.Command(command[0], {
    args: command.slice(1),
    cwd: repoRoot,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const text = new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr);
  await Deno.writeTextFile(join(outDir, logPath), text);
  return {
    name,
    command,
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

/** Partial sidecar shape as embedded in the aggregated evidence bundle. */
export type SiteE2eRollup = Partial<SiteE2eResult>;

async function packExtras(
  packedSteps: StepResult[],
  outDir: string,
): Promise<Record<string, unknown>> {
  const gatePacked = packedSteps.find((step) => step.name === 'gate-packed');
  const packedText = gatePacked ? await Deno.readTextFile(join(outDir, gatePacked.logPath)) : '';
  const { artifactCheck, consumers } = packedRollupFromLog(packedText);

  const publish = packedSteps.find((step) => step.name === 'publish-npm-dry-run');
  const text = publish ? await Deno.readTextFile(join(outDir, publish.logPath)) : '';
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
  const packages = await readPackages();
  const tarballs: Record<string, string> = {};
  for (const pkg of packages) {
    const bytes = await Deno.readFile(tarballPath(pkg)).catch(() => null);
    if (!bytes) throw new Error(`Candidate tarball missing for ${pkg.name}: ${tarballPath(pkg)}`);
    tarballs[pkg.name] = await sha256Bytes(bytes);
  }
  return {
    tarballs,
    packDiagnostics: packSummaries,
    artifactCheck,
    consumers,
  };
}

async function sourceExtras(
  _sourceSteps: StepResult[],
  _outDir: string,
): Promise<Record<string, unknown>> {
  // The Site E2E task writes a structured sidecar (Playwright JSON summary),
  // so unrelated fixture output can never fake the browser proof.
  try {
    const raw = await Deno.readTextFile(join(repoRoot, '.artifacts/site-e2e-result.json'));
    const result = JSON.parse(raw) as SiteE2eRollup;
    return { siteE2e: result };
  } catch {
    return { siteE2e: { ran: false } };
  }
}

async function recordJob(job: Exclude<JobName, 'fresh-clone'>, outDir: string): Promise<void> {
  const expected = expectedSha();
  const { sha, tree } = await assertCleanAtSha(expected);
  await Deno.mkdir(join(outDir, 'logs'), { recursive: true });
  const steps: StepResult[] = [];
  for (const { name, command } of STATIC_JOB_STEPS[job]) {
    const argv = [...command];
    console.log(`[evidence] ${job}: ${name}: ${argv.join(' ')}`);
    const step = await runStep(name, argv, outDir);
    if (name === 'gate-source' || name === 'gate-packed') {
      const text = await Deno.readTextFile(join(outDir, step.logPath));
      step.counts = gateStepCounts(text);
    }
    steps.push(step);
    console.log(
      `[evidence] ${job}: ${step.result} ${name} (${(step.durationMs / 1000).toFixed(1)}s)`,
    );
  }
  const extras = job === 'packed'
    ? await packExtras(steps, outDir)
    : job === 'source-matrix'
    ? await sourceExtras(steps, outDir)
    : undefined;
  const result: JobResult = {
    schemaVersion: 1,
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
  await Deno.writeTextFile(join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  if (result.result !== 'PASS') Deno.exit(1);
}

// ─── Fresh clone ─────────────────────────────────────────────────────

/** Stable, path-free step name for a fresh-clone command. */
function freshCommandName(argv: string[]): string {
  const executable = argv[0].split('/').pop() ?? argv[0];
  if (executable.startsWith('git')) {
    return argv[1] === 'clone' ? 'clone' : `git-${argv[3] ?? 'command'}`;
  }
  if (argv[1] === 'install') return 'install';
  if (argv[1] === 'task') {
    const last = argv[argv.length - 1];
    return `task-${last.replaceAll(':', '-').replaceAll('/', '-')}`;
  }
  return executable;
}

interface FreshCloneCommand {
  argv: string[];
  cwd: string;
  startedAt: string;
  durationMs: number;
  exitCode: number;
  logPath: string;
  logSha256: string;
}

async function recordFreshClone(outDir: string): Promise<void> {
  const expected = expectedSha();
  const { sha, tree } = await assertCleanAtSha(expected);
  await Deno.mkdir(join(outDir, 'logs'), { recursive: true });
  const tmpRoot = await Deno.makeTempDir({ prefix: 'fresh-candidate-' });
  const cloneDir = join(tmpRoot, 'repo');
  const denoDir = join(tmpRoot, 'deno-dir');
  const npmCache = join(tmpRoot, 'npm-cache');
  const commands: FreshCloneCommand[] = [];
  const run = async (argv: string[], cwd: string, env?: Record<string, string>): Promise<void> => {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const output = await new Deno.Command(argv[0], {
      args: argv.slice(1),
      cwd,
      stdin: 'null',
      stdout: 'piped',
      stderr: 'piped',
      env,
    }).output();
    const text = new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr);
    const logPath = `logs/fresh-clone-${commands.length}-${argv[0].split('/').pop()}.log`;
    await Deno.writeTextFile(join(outDir, logPath), text);
    commands.push({
      argv,
      cwd: 'fresh clone (removed after the run)',
      startedAt,
      durationMs: Date.now() - started,
      exitCode: output.code,
      logPath,
      logSha256: await sha256Bytes(new TextEncoder().encode(text)),
    });
    if (!output.success) {
      throw new Error(`fresh-clone step failed: ${argv.join(' ')} (exit ${output.code})`);
    }
  };
  try {
    await run(freshCloneCommands.clone(repoRoot, cloneDir), tmpRoot);
    await run(freshCloneCommands.checkout(cloneDir, sha), tmpRoot);
    const clonedSha = (await required('git', ['-C', cloneDir, 'rev-parse', 'HEAD'])).trim();
    if (clonedSha !== sha) throw new Error(`fresh clone checked out ${clonedSha}, want ${sha}`);
    const isolatedEnv = {
      ...Deno.env.toObject(),
      DENO_DIR: denoDir,
      NPM_CONFIG_CACHE: npmCache,
      npm_config_cache: npmCache,
      DENO_NO_UPDATE_CHECK: '1',
    };
    await run(freshCloneCommands.install(denoExe), cloneDir, isolatedEnv);
    await run(freshCloneCommands.check(denoExe), cloneDir, isolatedEnv);
    // The real source gate (includes Site E2E) and the real release check
    // (registry check + packed gate + publish dry-run) — no duplicated
    // packed/dry-run steps, since release:check already owns them.
    await run(freshCloneCommands.gateSource(denoExe), cloneDir, isolatedEnv);
    await run(freshCloneCommands.releaseCheck(denoExe), cloneDir, isolatedEnv);
  } finally {
    await Deno.remove(tmpRoot, { recursive: true }).catch(() => undefined);
  }
  const result: JobResult = {
    schemaVersion: 1,
    job: 'fresh-clone',
    sha,
    tree,
    trackedClean: true,
    result: commands.every((command) => command.exitCode === 0) ? 'PASS' : 'FAIL',
    steps: commands.map((command) => ({
      name: freshCommandName(command.argv),
      command: command.argv,
      startedAt: command.startedAt,
      durationMs: command.durationMs,
      exitCode: command.exitCode,
      result: command.exitCode === 0 ? 'PASS' : 'FAIL',
      logPath: command.logPath,
      logSha256: command.logSha256,
    })),
    toolVersions: await toolVersions(),
    extras: { isolation: FRESH_CLONE_ISOLATION },
    generatedAt: new Date().toISOString(),
  };
  await Deno.writeTextFile(join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  if (result.result !== 'PASS') Deno.exit(1);
}

// ─── Aggregation ─────────────────────────────────────────────────────

interface LoadedJob {
  job: JobResult;
  dir: string;
  read: (path: string) => Promise<Uint8Array | null>;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256_HEX = /^sha256:[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCommit(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
}

function auditSafeRelativePath(value: unknown): string[] {
  if (typeof value !== 'string' || value === '') return ['path must be a non-empty string'];
  if (value.startsWith('/') || value.includes('\\')) {
    return [`path must be a relative POSIX path, got ${JSON.stringify(value)}`];
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return [`path must not contain empty, '.', or '..' segments, got ${JSON.stringify(value)}`];
  }
  return [];
}

function auditArtifactPath(
  jobName: JobName,
  value: unknown,
  mode: 'job' | 'bundle',
): string[] {
  if (typeof value !== 'string' || value === '') return ['log path must be a non-empty string'];
  if (value.startsWith('/') || value.includes('\\')) {
    return [`log path must be a relative POSIX path, got ${JSON.stringify(value)}`];
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return [`log path must not contain empty, '.', or '..' segments, got ${JSON.stringify(value)}`];
  }
  const prefix = mode === 'bundle' ? `ci/${jobName}/logs/` : 'logs/';
  if (!value.startsWith(prefix) || !value.endsWith('.log')) {
    return [`log path must be under ${prefix} and end with .log, got ${JSON.stringify(value)}`];
  }
  return [];
}

interface AuditJobContext {
  mode: 'job' | 'bundle';
  sha: string;
  tree: string;
  generatedAt: string;
  read: (path: string) => Promise<Uint8Array | null>;
  extras?: unknown;
}

/**
 * Single source of job invariants shared by aggregate (job result.json files)
 * and validate (the aggregated bundle). Everything is treated as untrusted
 * JSON: every field is required and validated, and malformed input returns
 * explicit failures instead of defaulting or throwing.
 */
async function auditJob(
  jobName: unknown,
  jobResult: unknown,
  rawSteps: unknown,
  context: AuditJobContext,
): Promise<string[]> {
  const failures: string[] = [];
  if (typeof jobName !== 'string' || !JOB_NAMES.includes(jobName as JobName)) {
    return [`unknown job result: ${JSON.stringify(jobName)}`];
  }
  const job = jobName as JobName;
  if (!isCommit(context.sha)) failures.push(`${job}: sha is not a 40-character commit`);
  if (!isCommit(context.tree)) failures.push(`${job}: tree is not a 40-character tree`);
  if (jobResult !== 'PASS') {
    failures.push(`${job}: job result must be PASS, got ${JSON.stringify(jobResult)}`);
  }
  const generatedAtMs = ISO_TIMESTAMP.test(context.generatedAt ?? '')
    ? Date.parse(context.generatedAt)
    : Number.NaN;
  if (Number.isNaN(generatedAtMs)) {
    failures.push(
      `${job}: generatedAt must be an ISO-8601 timestamp, got ${
        JSON.stringify(context.generatedAt)
      }`,
    );
  }
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    failures.push(`${job}: steps must be a non-empty array`);
    return failures;
  }
  const byName = new Map<string, Record<string, unknown>>();
  for (const [index, raw] of rawSteps.entries()) {
    if (!isRecord(raw)) {
      failures.push(`${job}: steps[${index}] must be an object`);
      continue;
    }
    const name = raw.name;
    if (typeof name !== 'string' || name === '') {
      failures.push(`${job}: steps[${index}].name must be a non-empty string`);
      continue;
    }
    if (byName.has(name)) {
      failures.push(`${job}: duplicate step '${name}'`);
      continue;
    }
    byName.set(name, raw);
  }
  const required = REQUIRED_STEPS[job];
  for (const name of required) {
    if (!byName.has(name)) failures.push(`${job}: required step missing: ${name}`);
  }
  for (const name of byName.keys()) {
    if (!required.includes(name)) {
      failures.push(`${job}: unknown step '${name}' (not in the canonical contract)`);
    }
  }
  let previousStartedAt = Number.NEGATIVE_INFINITY;
  for (const name of required) {
    const step = byName.get(name);
    if (!step) continue;
    const label = `${job}/${name}`;
    failures.push(
      ...auditStepCommand(job, name, step.command, { sha: context.sha }).map(
        (failure) => `${label}: ${failure}`,
      ),
    );
    const startedAt = step.startedAt;
    if (typeof startedAt !== 'string' || !ISO_TIMESTAMP.test(startedAt)) {
      failures.push(
        `${label}: startedAt must be an ISO-8601 timestamp, got ${JSON.stringify(startedAt)}`,
      );
    } else {
      const startedAtMs = Date.parse(startedAt);
      if (Number.isNaN(startedAtMs)) {
        failures.push(`${label}: startedAt is not a valid date`);
      } else {
        if (!Number.isNaN(generatedAtMs) && startedAtMs > generatedAtMs) {
          failures.push(`${label}: startedAt ${startedAt} is after the evidence generatedAt`);
        }
        if (startedAtMs < previousStartedAt) {
          failures.push(`${label}: startedAt ${startedAt} is out of order`);
        }
        previousStartedAt = Math.max(previousStartedAt, startedAtMs);
      }
    }
    if (!Number.isSafeInteger(step.durationMs) || (step.durationMs as number) < 0) {
      failures.push(
        `${label}: durationMs must be a non-negative safe integer, got ${
          JSON.stringify(step.durationMs)
        }`,
      );
    }
    if (step.result !== 'PASS') {
      failures.push(`${label}: result must be PASS, got ${JSON.stringify(step.result)}`);
    }
    if (!Number.isSafeInteger(step.exitCode) || step.exitCode !== 0) {
      failures.push(
        `${label}: exitCode must be the integer 0, got ${JSON.stringify(step.exitCode)}`,
      );
    }
    failures.push(
      ...auditArtifactPath(job, step.logPath, context.mode).map((failure) =>
        `${label}: ${failure}`
      ),
    );
    if (typeof step.logSha256 !== 'string' || !SHA256_HEX.test(step.logSha256)) {
      failures.push(
        `${label}: logSha256 must be sha256:<64 lowercase hex>, got ${
          JSON.stringify(step.logSha256)
        }`,
      );
    }
    if (typeof step.logPath === 'string' && step.logPath !== '') {
      const bytes = await context.read(step.logPath);
      if (!bytes) {
        failures.push(`${label}: log missing at ${step.logPath}`);
      } else if (
        typeof step.logSha256 === 'string' && (await sha256Bytes(bytes)) !== step.logSha256
      ) {
        failures.push(`${label}: log hash mismatch`);
      }
    }
  }
  if (job === 'fresh-clone') {
    const isolation = isRecord(context.extras) ? context.extras.isolation : undefined;
    failures.push(...auditFreshCloneIsolation(isolation).map((failure) => `${job}: ${failure}`));
  }
  return failures;
}

/** Pure proof checks for one recorded job. Exported for tests. */
export async function collectJobFailures(
  jobs: readonly Pick<LoadedJob, 'job' | 'read'>[],
  expected: string,
  expectedTree: string,
): Promise<string[]> {
  const failures: string[] = [];
  const byName = new Map<string, Pick<LoadedJob, 'job' | 'read'>>();
  for (const entry of jobs) {
    const raw: unknown = entry.job;
    if (!isRecord(raw) || typeof raw.job !== 'string') {
      failures.push('job result is missing a string job name');
      continue;
    }
    if (byName.has(raw.job)) failures.push(`duplicate job result: ${raw.job}`);
    byName.set(raw.job, entry);
  }
  for (const jobName of JOB_NAMES) {
    const entry = byName.get(jobName);
    if (!entry) {
      failures.push(`required job result missing: ${jobName}`);
      continue;
    }
    const raw = entry.job as unknown as Record<string, unknown>;
    if (raw.sha !== expected) {
      failures.push(`${jobName}: sha ${JSON.stringify(raw.sha)} != ${expected}`);
    }
    if (raw.tree !== expectedTree) {
      failures.push(`${jobName}: tree ${JSON.stringify(raw.tree)} != ${expectedTree}`);
    }
    failures.push(
      ...await auditJob(jobName, raw.result, raw.steps, {
        mode: 'job',
        sha: typeof raw.sha === 'string' ? raw.sha : '',
        tree: typeof raw.tree === 'string' ? raw.tree : '',
        generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
        read: entry.read,
        extras: raw.extras,
      }),
    );
  }
  for (const name of byName.keys()) {
    if (!JOB_NAMES.includes(name as JobName)) failures.push(`unknown job result: ${name}`);
  }
  return failures;
}

/** Pure checks for the packed artifact/consumer and Site E2E rollup. */
export function collectRollupFailures(rollup: Rollup | undefined): string[] {
  const failures: string[] = [];
  if (!rollup) {
    failures.push('rollup missing (packed artifact scan, packed consumers, and Site E2E proof)');
    return failures;
  }
  if (rollup.artifactCheck !== true) {
    failures.push('packed artifact scan did not run (package-artifacts:check missing)');
  }
  const consumers = new Set(rollup.consumers ?? []);
  for (const required of REQUIRED_PACKED_CONSUMERS) {
    if (!consumers.has(required)) failures.push(`packed consumer missing: ${required}`);
  }
  failures.push(...auditSiteE2e(rollup.siteE2e));
  return failures;
}

interface Rollup {
  artifactCheck?: boolean;
  consumers?: string[];
  siteE2e?: SiteE2eRollup;
}

/** Pure artifact checks for an aggregated evidence bundle. Exported for tests. */
export async function collectBundleFailures(
  evidence: unknown,
  options: {
    expectedSha?: string;
    expectedTree: string;
    read: (path: string) => Promise<Uint8Array | null>;
    now?: number;
    maxAgeDays?: number;
  },
): Promise<string[]> {
  if (!isRecord(evidence)) return ['evidence bundle must be a JSON object'];
  const failures: string[] = [];
  const sha = evidence.sha;
  const tree = evidence.tree;
  if (!isCommit(sha)) failures.push('evidence sha is not a 40-character commit');
  if (options.expectedSha && sha !== options.expectedSha) {
    failures.push(`evidence sha ${JSON.stringify(sha)} != expected ${options.expectedSha}`);
  }
  if (!isCommit(tree)) failures.push('evidence tree is not a 40-character tree');
  if (tree !== options.expectedTree) {
    failures.push(`evidence tree ${JSON.stringify(tree)} != HEAD tree ${options.expectedTree}`);
  }
  const generatedAt = typeof evidence.generatedAt === 'string' ? evidence.generatedAt : '';
  const recorded = ISO_TIMESTAMP.test(generatedAt) ? Date.parse(generatedAt) : Number.NaN;
  const maxAgeDays = options.maxAgeDays ?? ARTIFACT_RETENTION_DAYS;
  const now = options.now ?? Date.now();
  if (Number.isNaN(recorded)) {
    failures.push('evidence generatedAt is missing or unparsable');
  } else if (recorded > now) {
    failures.push('evidence generatedAt is in the future');
  } else if (now - recorded > maxAgeDays * 24 * 60 * 60 * 1000) {
    failures.push(`evidence is older than the ${maxAgeDays}-day retention window`);
  }
  if (evidence.requiredOk !== true) {
    failures.push('evidence requiredOk must be exactly true');
  }

  const rawJobs = evidence.jobs;
  if (!Array.isArray(rawJobs)) {
    failures.push('evidence jobs must be an array');
  } else {
    const seen = new Set<string>();
    for (const [index, raw] of rawJobs.entries()) {
      if (!isRecord(raw)) {
        failures.push(`evidence.jobs[${index}] must be an object`);
        continue;
      }
      const name = raw.job;
      if (typeof name !== 'string') {
        failures.push(`evidence.jobs[${index}].job must be a string`);
        continue;
      }
      if (seen.has(name)) failures.push(`duplicate job result: ${name}`);
      seen.add(name);
      // Bundle steps carry `logSource`; auditJob reads `logPath`.
      const steps = Array.isArray(raw.steps)
        ? raw.steps.map((step) => isRecord(step) ? { ...step, logPath: step.logSource } : step)
        : raw.steps;
      failures.push(
        ...await auditJob(name, raw.result, steps, {
          mode: 'bundle',
          sha: typeof sha === 'string' ? sha : '',
          tree: typeof tree === 'string' ? tree : '',
          generatedAt,
          read: options.read,
          extras: raw.extras,
        }),
      );
    }
    for (const jobName of JOB_NAMES) {
      if (!seen.has(jobName)) failures.push(`required job result missing: ${jobName}`);
    }
    for (const name of seen) {
      if (!JOB_NAMES.includes(name as JobName)) failures.push(`unknown job result: ${name}`);
    }
  }

  const tarballs = isRecord(evidence.tarballs) ? evidence.tarballs : {};
  const tarballKeys = Object.keys(tarballs).sort();
  const expectedKeys = [...REQUIRED_PACKAGE_TARBALLS].sort();
  if (tarballKeys.join(',') !== expectedKeys.join(',')) {
    failures.push(
      `tarball manifest must contain exactly ${expectedKeys.join(', ')}; found ${
        tarballKeys.join(', ') || 'none'
      }`,
    );
  }
  for (const name of REQUIRED_PACKAGE_TARBALLS) {
    const hash = tarballs[name];
    if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
      failures.push(`tarball ${name}: missing or malformed sha256`);
    }
  }
  failures.push(
    ...collectRollupFailures(isRecord(evidence.rollup) ? evidence.rollup as Rollup : undefined),
  );
  for (
    const [label, manifest] of [
      ['tarballManifest', evidence.tarballManifest],
      ['packDiagnostics', evidence.packDiagnostics],
    ] as const
  ) {
    if (!isRecord(manifest)) {
      failures.push(`${label} reference missing`);
      continue;
    }
    const path = manifest.path;
    const hash = manifest.sha256;
    const pathFailures = auditSafeRelativePath(path);
    if (pathFailures.length > 0) {
      failures.push(`${label}: ${pathFailures.join('; ')}`);
      continue;
    }
    if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
      failures.push(`${label}: sha256 must be sha256:<64 lowercase hex>`);
      continue;
    }
    const bytes = await options.read(path as string);
    if (!bytes) failures.push(`${label} missing at ${path}`);
    else if ((await sha256Bytes(bytes)) !== hash) {
      failures.push(`${label} hash mismatch at ${path}`);
    }
  }
  return failures;
}

async function loadJobs(inputDir: string): Promise<LoadedJob[]> {
  const jobs: LoadedJob[] = [];
  for (const jobName of JOB_NAMES) {
    const dir = join(inputDir, jobName);
    let raw: string;
    try {
      raw = await Deno.readTextFile(join(dir, 'result.json'));
    } catch {
      continue;
    }
    jobs.push({
      job: JSON.parse(raw) as JobResult,
      dir,
      read: (path) => Deno.readFile(join(dir, path)).catch(() => null),
    });
  }
  return jobs;
}

async function aggregate(inputDir: string, output: string): Promise<void> {
  const expected = expectedSha();
  const [headSha, headTree] = [
    await required('git', ['rev-parse', 'HEAD']),
    await required(
      'git',
      ['rev-parse', 'HEAD^{tree}'],
    ),
  ];
  if (headSha !== expected) throw new Error(`HEAD ${headSha} != expected ${expected}`);
  const jobs = await loadJobs(inputDir);
  const failures = await collectJobFailures(jobs, expected, headTree);
  if (failures.length > 0) {
    console.error(`candidate aggregation FAILED:\n${failures.join('\n')}`);
    Deno.exit(1);
  }

  const packed = jobs.find(({ job }) => job.job === 'packed') as LoadedJob;
  const source = jobs.find(({ job }) => job.job === 'source-matrix') as LoadedJob;
  const tarballs = (packed.job.extras?.tarballs ?? {}) as Record<string, string>;
  if (Object.keys(tarballs).length < 4) {
    throw new Error('packed job: tarball manifest must contain at least four packages');
  }
  const rollup = {
    artifactCheck: packed.job.extras?.artifactCheck === true,
    consumers: (packed.job.extras?.consumers ?? []) as string[],
    siteE2e: (source.job.extras?.siteE2e ?? {}) as SiteE2eRollup,
  };
  const rollupFailures = collectRollupFailures(rollup);
  if (rollupFailures.length > 0) {
    console.error(`candidate aggregation FAILED:\n${rollupFailures.join('\n')}`);
    Deno.exit(1);
  }
  const outDir = dirname(output);
  await Deno.mkdir(outDir, { recursive: true });

  const writeManifest = async (name: string, value: unknown): Promise<string> => {
    const path = join(outDir, name);
    await Deno.writeTextFile(path, JSON.stringify(value, null, 2) + '\n');
    return await sha256Bytes(Deno.readFileSync(path));
  };
  const tarballManifestSha = await writeManifest('tarball-manifest.json', tarballs);
  const packDiagnosticsSha = await writeManifest(
    'pack-diagnostics.json',
    packed.job.extras?.packDiagnostics ?? [],
  );

  const evidence = {
    schemaVersion: 1,
    sha: headSha,
    tree: headTree,
    trackedClean: true,
    toolVersions: jobs.find(({ job }) => job.job === 'source-matrix')?.job.toolVersions ?? {},
    jobs: jobs.map(({ job, dir }) => ({
      job: job.job,
      result: job.result,
      generatedAt: job.generatedAt,
      extras: job.extras ?? {},
      steps: job.steps.map((step) => ({
        name: step.name,
        command: step.command,
        startedAt: step.startedAt,
        durationMs: step.durationMs,
        exitCode: step.exitCode,
        result: step.result,
        counts: step.counts ?? {},
        logSource: relative(outDir, join(dir, step.logPath)),
        logSha256: step.logSha256,
      })),
    })),
    tarballs,
    tarballManifest: { path: 'tarball-manifest.json', sha256: tarballManifestSha },
    packDiagnostics: { path: 'pack-diagnostics.json', sha256: packDiagnosticsSha },
    rollup,
    // Validated and set from the assembled bundle below; the placeholder is
    // the value that will be written only if every invariant holds.
    requiredOk: true,
    aggregate: {
      inputs: jobs.map(({ job, dir }) => `${job.job}@${relative(outDir, dir)}`),
      recomputedLogHashes: jobs.reduce((sum, { job }) => sum + job.steps.length, 0),
    },
    generatedAt: new Date().toISOString(),
    result: 'PASS' as const,
  };
  const assemblyFailures = await collectBundleFailures(evidence, {
    expectedSha: expected,
    expectedTree: headTree,
    read: (path) => Deno.readFile(join(outDir, path)).catch(() => null),
  });
  if (assemblyFailures.length > 0) {
    console.error(
      `candidate aggregation FAILED while validating the assembled bundle:\n${
        assemblyFailures.join('\n')
      }`,
    );
    Deno.exit(1);
  }
  evidence.requiredOk = true;
  await Deno.writeTextFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`candidate evidence aggregated: ${output}`);
}

// ─── Validation ──────────────────────────────────────────────────────

async function validate(
  evidencePath: string,
  expected: string | undefined,
  maxAgeDays: number,
): Promise<void> {
  const root = dirname(evidencePath);
  const evidence = JSON.parse(await Deno.readTextFile(evidencePath)) as Parameters<
    typeof collectBundleFailures
  >[0];
  const sha = await required('git', ['rev-parse', 'HEAD']);
  const tree = await required('git', ['rev-parse', 'HEAD^{tree}']);
  const failures = await collectBundleFailures(evidence, {
    expectedSha: expected ?? sha,
    expectedTree: tree,
    read: (path) => Deno.readFile(join(root, path)).catch(() => null),
    maxAgeDays,
  });
  if (failures.length > 0) {
    console.error(`evidence validation FAILED:\n${failures.join('\n')}`);
    Deno.exit(1);
  }
  const boundSha = isRecord(evidence) && typeof evidence.sha === 'string'
    ? evidence.sha
    : 'unknown';
  console.log(`evidence validation ok: ${evidencePath} binds ${boundSha}`);
}

// ─── CLI ─────────────────────────────────────────────────────────────

async function localFullRun(): Promise<void> {
  const expected = expectedSha();
  const base = '.artifacts/ci';
  for (const job of ['fast-checks', 'source-matrix', 'packed'] as const) {
    await recordJob(job, join(repoRoot, base, job));
  }
  await recordFreshClone(join(repoRoot, base, 'fresh-clone'));
  await aggregate(join(repoRoot, base), join(repoRoot, '.artifacts/candidate-evidence.json'));
  await validate(join(repoRoot, '.artifacts/candidate-evidence.json'), expected, 14);
}

if (import.meta.main) {
  const validatePath = flagValue('validate');
  if (validatePath) {
    await validate(
      validatePath,
      flagValue('expected-sha') ?? Deno.env.get('CANDIDATE_SHA'),
      Number(flagValue('max-age-days') ?? ARTIFACT_RETENTION_DAYS),
    );
  } else if (Deno.args.includes('--aggregate')) {
    await aggregate(
      flagValue('input-dir') ?? join(repoRoot, '.artifacts/ci'),
      flagValue('output') ?? join(repoRoot, '.artifacts/candidate-evidence.json'),
    );
  } else if (flagValue('job')) {
    const job = flagValue('job') as JobName;
    if (!JOB_NAMES.includes(job)) throw new Error(`Unknown job: ${job}`);
    const outDir = flagValue('out') ?? join(repoRoot, '.artifacts/ci', job);
    if (job === 'fresh-clone') await recordFreshClone(outDir);
    else await recordJob(job, outDir);
  } else {
    await localFullRun();
  }
}
