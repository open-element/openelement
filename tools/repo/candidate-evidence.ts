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

import { basename, dirname, join, relative } from '@std/path';
import { readPackages } from '../lib/package-graph.ts';
import { auditSiteE2e, type SiteE2eResult } from './site-e2e-result.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import {
  auditFreshCloneIsolation,
  auditStep,
  auditToolVersions,
  CANDIDATE_EVIDENCE_SCHEMA_VERSION,
  cleanProofArgv,
  cleanProofLine,
  EVIDENCE_ROLES,
  type EvidenceToolVersions,
  FRESH_CLONE_ISOLATION,
  freshCloneCommands,
  JOB_NAMES,
  type JobName,
  materializeEvidencePath,
  normalizeEvidencePath,
  type PathRoleMapping,
  REQUIRED_STEPS,
  STATIC_JOB_STEPS,
} from './candidate-steps.ts';
import { auditTarballPackage } from './tarball-inspect.ts';

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

interface JobResult {
  schemaVersion: typeof CANDIDATE_EVIDENCE_SCHEMA_VERSION;
  job: JobName;
  sha: string;
  tree: string;
  trackedClean: true;
  result: 'PASS' | 'FAIL';
  steps: StepResult[];
  toolVersions: EvidenceToolVersions;
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

async function toolVersions(): Promise<EvidenceToolVersions> {
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
  cwd: string = repoRoot,
  roles: PathRoleMapping = [],
): Promise<StepResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const logPath = `logs/${name}.log`;
  const output = await new Deno.Command(command[0], {
    args: command.slice(1),
    cwd,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const text = new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr);
  await Deno.writeTextFile(join(outDir, logPath), text);
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

/** Role mapping for workspace jobs: the repository root is $SOURCE. */
const SOURCE_ROLES: PathRoleMapping = [[repoRoot, EVIDENCE_ROLES.source]];

async function recordJob(job: Exclude<JobName, 'fresh-clone'>, outDir: string): Promise<void> {
  const expected = expectedSha();
  const { sha, tree } = await assertCleanAtSha(expected);
  await Deno.mkdir(join(outDir, 'logs'), { recursive: true });
  const steps: StepResult[] = [];
  const runCleanProof = async (phase: 'before' | 'after'): Promise<void> => {
    const name = `workspace-clean-${phase}`;
    const argv = [denoExe, ...cleanProofArgv(sha, tree, phase).slice(1)];
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
      const text = await Deno.readTextFile(join(outDir, step.logPath));
      step.counts = gateStepCounts(text);
    }
    steps.push(step);
    console.log(
      `[evidence] ${job}: ${step.result} ${name} (${(step.durationMs / 1000).toFixed(1)}s)`,
    );
  }
  await runCleanProof('after');
  const extras = job === 'packed'
    ? await packExtras(steps, outDir)
    : job === 'source-matrix'
    ? await sourceExtras(steps, outDir)
    : undefined;
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
  await Deno.writeTextFile(join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  if (result.result !== 'PASS') Deno.exit(1);
}

// ─── Fresh clone ─────────────────────────────────────────────────────

interface FreshCloneCommand {
  name: string;
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
  // One mapping for every recorded path: real absolute paths stay private and
  // the validator only ever sees the shared roles.
  const roles: PathRoleMapping = [
    [repoRoot, EVIDENCE_ROLES.source],
    [tmpRoot, EVIDENCE_ROLES.temp],
    [cloneDir, EVIDENCE_ROLES.clone],
  ];
  const commands: FreshCloneCommand[] = [];
  const run = async (
    name: string,
    roleArgv: string[],
    cwd: string,
    env?: Record<string, string>,
  ): Promise<void> => {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    // Commands are declared in shared roles; only the spawn uses real paths,
    // so the recorded evidence stays free of machine-specific locations.
    const argv = roleArgv.map((element) => materializeEvidencePath(element, roles));
    const output = await new Deno.Command(argv[0], {
      args: argv.slice(1),
      cwd,
      stdin: 'null',
      stdout: 'piped',
      stderr: 'piped',
      env,
    }).output();
    const text = new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr);
    const logPath = `logs/fresh-clone-${commands.length}-${name}.log`;
    await Deno.writeTextFile(join(outDir, logPath), text);
    commands.push({
      name,
      argv: argv.map((element) => normalizeEvidencePath(element, roles)),
      cwd: normalizeEvidencePath(cwd, roles),
      startedAt,
      durationMs: Date.now() - started,
      exitCode: output.code,
      logPath,
      logSha256: await sha256Bytes(new TextEncoder().encode(text)),
    });
    if (!output.success) {
      throw new Error(`fresh-clone step failed: ${name} (exit ${output.code})`);
    }
  };
  try {
    await run('clone', freshCloneCommands.clone(), tmpRoot);
    await run('git-checkout', freshCloneCommands.checkout(sha), tmpRoot);
    const clonedSha = (await required('git', ['-C', cloneDir, 'rev-parse', 'HEAD'])).trim();
    if (clonedSha !== sha) throw new Error(`fresh clone checked out ${clonedSha}, want ${sha}`);
    const isolatedEnv = {
      ...Deno.env.toObject(),
      DENO_DIR: denoDir,
      NPM_CONFIG_CACHE: npmCache,
      npm_config_cache: npmCache,
      DENO_NO_UPDATE_CHECK: '1',
    };
    const runCleanProof = (phase: 'before' | 'after') =>
      run(
        `workspace-clean-${phase}`,
        [denoExe, ...cleanProofArgv(sha, tree, phase).slice(1)],
        cloneDir,
        isolatedEnv,
      );
    await runCleanProof('before');
    await run('install', freshCloneCommands.install(denoExe), cloneDir, isolatedEnv);
    await run('task-check', freshCloneCommands.check(denoExe), cloneDir, isolatedEnv);
    // The real source gate (includes Site E2E) and the real release check
    // (registry check + packed gate + publish dry-run) — no duplicated
    // packed/dry-run steps, since release:check already owns them.
    await run('task-gate-source', freshCloneCommands.gateSource(denoExe), cloneDir, isolatedEnv);
    await run(
      'task-release-check',
      freshCloneCommands.releaseCheck(denoExe),
      cloneDir,
      isolatedEnv,
    );
    await runCleanProof('after');
  } finally {
    await Deno.remove(tmpRoot, { recursive: true }).catch(() => undefined);
  }
  const result: JobResult = {
    schemaVersion: CANDIDATE_EVIDENCE_SCHEMA_VERSION,
    job: 'fresh-clone',
    sha,
    tree,
    trackedClean: true,
    result: commands.every((command) => command.exitCode === 0) ? 'PASS' : 'FAIL',
    steps: commands.map((command) => ({
      name: command.name,
      command: command.argv,
      cwd: command.cwd,
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
  /** Bundle generatedAt (bundle mode only); jobs may not finish after it. */
  bundleGeneratedAtMs?: number;
  read: (path: string) => Promise<Uint8Array | null>;
}

const JOB_KEYS = [
  'schemaVersion',
  'job',
  'sha',
  'tree',
  'trackedClean',
  'result',
  'generatedAt',
  'toolVersions',
  'steps',
  'extras',
] as const;

const STEP_KEYS = [
  'name',
  'command',
  'cwd',
  'startedAt',
  'durationMs',
  'exitCode',
  'result',
  'logPath',
  'logSha256',
  'counts',
  'note',
] as const;

function unknownKeys(record: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(record).filter((key) => !allowed.includes(key));
}

/**
 * Single source of job invariants shared by aggregate (job result.json files)
 * and validate (the aggregated bundle). Everything is treated as untrusted
 * JSON: every field is required and validated, and malformed input returns
 * explicit failures instead of defaulting or throwing.
 */
async function auditJob(
  jobName: unknown,
  rawJob: unknown,
  context: AuditJobContext,
): Promise<string[]> {
  const failures: string[] = [];
  if (typeof jobName !== 'string' || !JOB_NAMES.includes(jobName as JobName)) {
    return [`unknown job result: ${JSON.stringify(jobName)}`];
  }
  const job = jobName as JobName;
  if (!isRecord(rawJob)) return [`${job}: job result must be an object`];
  const extra = unknownKeys(rawJob, JOB_KEYS);
  if (extra.length > 0) failures.push(`${job}: unknown job fields: ${extra.join(', ')}`);
  if (rawJob.schemaVersion !== CANDIDATE_EVIDENCE_SCHEMA_VERSION) {
    failures.push(
      `${job}: schemaVersion must be ${CANDIDATE_EVIDENCE_SCHEMA_VERSION}, got ${
        JSON.stringify(rawJob.schemaVersion)
      }`,
    );
  }
  if (rawJob.job !== job) failures.push(`${job}: job field must be ${JSON.stringify(job)}`);
  if (rawJob.sha !== context.sha) {
    failures.push(`${job}: sha ${JSON.stringify(rawJob.sha)} != ${context.sha}`);
  }
  if (rawJob.tree !== context.tree) {
    failures.push(`${job}: tree ${JSON.stringify(rawJob.tree)} != ${context.tree}`);
  }
  if (rawJob.trackedClean !== true) {
    failures.push(`${job}: trackedClean must be exactly true`);
  }
  if (rawJob.result !== 'PASS') {
    failures.push(`${job}: job result must be PASS, got ${JSON.stringify(rawJob.result)}`);
  }
  const generatedAtMs = typeof rawJob.generatedAt === 'string' &&
      ISO_TIMESTAMP.test(rawJob.generatedAt)
    ? Date.parse(rawJob.generatedAt)
    : Number.NaN;
  if (Number.isNaN(generatedAtMs)) {
    failures.push(
      `${job}: generatedAt must be an ISO-8601 timestamp, got ${
        JSON.stringify(rawJob.generatedAt)
      }`,
    );
  } else if (
    context.bundleGeneratedAtMs !== undefined && generatedAtMs > context.bundleGeneratedAtMs
  ) {
    failures.push(`${job}: generatedAt is after the bundle generatedAt`);
  }
  failures.push(...auditToolVersions(rawJob.toolVersions, job));

  const rawSteps = rawJob.steps;
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
    const stepExtra = unknownKeys(raw, STEP_KEYS);
    if (stepExtra.length > 0) {
      failures.push(`${job}: steps[${index}] unknown fields: ${stepExtra.join(', ')}`);
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
  let lastStepEndMs = Number.NEGATIVE_INFINITY;
  for (const name of required) {
    const step = byName.get(name);
    if (!step) continue;
    const label = `${job}/${name}`;
    failures.push(
      ...auditStep(job, name, step.command, step.cwd, { sha: context.sha, tree: context.tree })
        .map((failure) => `${label}: ${failure}`),
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
        if (startedAtMs < previousStartedAt) {
          failures.push(`${label}: startedAt ${startedAt} is out of order`);
        }
        previousStartedAt = Math.max(previousStartedAt, startedAtMs);
        if (
          Number.isSafeInteger(step.durationMs) && (step.durationMs as number) >= 0 &&
          !Number.isNaN(generatedAtMs)
        ) {
          const end = startedAtMs + (step.durationMs as number);
          lastStepEndMs = Math.max(lastStepEndMs, end);
          if (end > generatedAtMs) {
            failures.push(`${label}: step ends after the job generatedAt`);
          }
        }
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
    let logText: string | undefined;
    if (typeof step.logPath === 'string' && step.logPath !== '') {
      const bytes = await context.read(step.logPath);
      if (!bytes) {
        failures.push(`${label}: log missing at ${step.logPath}`);
      } else {
        logText = new TextDecoder().decode(bytes);
        if (typeof step.logSha256 === 'string' && (await sha256Bytes(bytes)) !== step.logSha256) {
          failures.push(`${label}: log hash mismatch`);
        }
      }
    }
    if (typeof step.logSha256 !== 'string' || !SHA256_HEX.test(step.logSha256)) {
      failures.push(
        `${label}: logSha256 must be sha256:<64 lowercase hex>, got ${
          JSON.stringify(step.logSha256)
        }`,
      );
    }
    if (name === 'workspace-clean-before' || name === 'workspace-clean-after') {
      const phase = name.endsWith('before') ? 'before' : 'after';
      if (
        logText !== undefined && !logText.includes(
          cleanProofLine(context.sha, context.tree, phase),
        )
      ) {
        failures.push(`${label}: log is missing the canonical clean-proof PASS line`);
      }
    }
  }
  if (job === 'fresh-clone') {
    const isolation = isRecord(rawJob.extras) ? rawJob.extras.isolation : undefined;
    failures.push(...auditFreshCloneIsolation(isolation).map((failure) => `${job}: ${failure}`));
  } else if (
    rawJob.extras !== undefined &&
    unknownKeys(rawJob.extras as Record<string, unknown>, []).length > 0
  ) {
    // Non-fresh jobs may expose typed extras at most; unknown extras fail closed.
    if (!isRecord(rawJob.extras)) failures.push(`${job}: extras must be an object`);
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
    failures.push(
      ...await auditJob(jobName, entry.job, {
        mode: 'job',
        sha: expected,
        tree: expectedTree,
        read: entry.read,
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

const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

const BUNDLE_KEYS = [
  'schemaVersion',
  'sha',
  'tree',
  'generatedAt',
  'result',
  'trackedClean',
  'requiredOk',
  'toolVersions',
  'packageVersion',
  'aggregate',
  'jobs',
  'tarballs',
  'tarballFiles',
  'tarballManifest',
  'packDiagnostics',
  'rollup',
] as const;

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function auditTarballFiles(
  evidence: Record<string, unknown>,
  options: { read: (path: string) => Promise<Uint8Array | null> },
): Promise<string[]> {
  const failures: string[] = [];
  const tarballs = isRecord(evidence.tarballs) ? evidence.tarballs : {};
  const tarballKeys = Object.keys(tarballs).sort();
  const expectedKeys = [...REQUIRED_PACKAGE_TARBALLS].sort();
  if (tarballKeys.join(',') !== expectedKeys.join(',')) {
    failures.push(
      `tarballs must contain exactly ${expectedKeys.join(', ')}; found ${
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
  const files = isRecord(evidence.tarballFiles) ? evidence.tarballFiles : {};
  const fileKeys = Object.keys(files).sort();
  if (fileKeys.join(',') !== expectedKeys.join(',')) {
    failures.push(
      `tarballFiles must map exactly ${expectedKeys.join(', ')}; found ${
        fileKeys.join(', ') || 'none'
      }`,
    );
  }
  const version = evidence.packageVersion;
  if (typeof version !== 'string' || !PACKAGE_VERSION_PATTERN.test(version)) {
    failures.push(`packageVersion must be an x.y.z(-label) string, got ${JSON.stringify(version)}`);
  }
  const packedJob = Array.isArray(evidence.jobs)
    ? (evidence.jobs as unknown[]).find((job) => isRecord(job) && job.job === 'packed') as
      | Record<string, unknown>
      | undefined
    : undefined;
  const packedExtras = packedJob && isRecord(packedJob.extras) ? packedJob.extras : undefined;
  if (packedExtras && !deepEqual(packedExtras.tarballs, evidence.tarballs)) {
    failures.push('packed job extras.tarballs must equal the top-level tarballs map');
  }
  const seenPaths = new Set<string>();
  for (const name of REQUIRED_PACKAGE_TARBALLS) {
    const path = files[name];
    const pathFailures = auditSafeRelativePath(path);
    if (pathFailures.length > 0) {
      failures.push(`tarballFiles.${name}: ${pathFailures.join('; ')}`);
      continue;
    }
    const relativePath = path as string;
    if (!relativePath.startsWith('tarballs/') || !relativePath.endsWith('.tgz')) {
      failures.push(`tarballFiles.${name}: must be a tarballs/*.tgz path, got ${relativePath}`);
      continue;
    }
    if (seenPaths.has(relativePath)) {
      failures.push(`tarballFiles.${name}: duplicate archive path ${relativePath}`);
      continue;
    }
    seenPaths.add(relativePath);
    const bytes = await options.read(relativePath);
    if (!bytes) {
      failures.push(`tarball ${name}: archive missing at ${relativePath}`);
      continue;
    }
    const actual = await sha256Bytes(bytes);
    if (tarballs[name] !== actual) {
      failures.push(`tarball ${name}: archive sha256 ${actual} != recorded ${tarballs[name]}`);
    }
    if (typeof version === 'string' && PACKAGE_VERSION_PATTERN.test(version)) {
      failures.push(
        ...(await auditTarballPackage(bytes, name, version)).map((failure) =>
          `tarball ${name}: ${failure}`
        ),
      );
    }
  }
  return failures;
}

async function auditPackDiagnostics(
  evidence: Record<string, unknown>,
  read: (path: string) => Promise<Uint8Array | null>,
): Promise<string[]> {
  const failures: string[] = [];
  const reference = evidence.packDiagnostics;
  if (!isRecord(reference)) return ['packDiagnostics reference missing'];
  const path = reference.path;
  const hash = reference.sha256;
  const pathFailures = auditSafeRelativePath(path);
  if (pathFailures.length > 0) return [`packDiagnostics: ${pathFailures.join('; ')}`];
  if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
    return ['packDiagnostics: sha256 must be sha256:<64 lowercase hex>'];
  }
  const bytes = await read(path as string);
  if (!bytes) return [`packDiagnostics missing at ${path}`];
  if ((await sha256Bytes(bytes)) !== hash) {
    return [`packDiagnostics hash mismatch at ${path}`];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return ['packDiagnostics is not valid JSON'];
  }
  if (!Array.isArray(parsed)) return ['packDiagnostics must be an array'];
  const packedJob = Array.isArray(evidence.jobs)
    ? (evidence.jobs as unknown[]).find((job) => isRecord(job) && job.job === 'packed') as
      | Record<string, unknown>
      | undefined
    : undefined;
  const packedExtras = packedJob && isRecord(packedJob.extras) ? packedJob.extras : undefined;
  if (packedExtras && !deepEqual(packedExtras.packDiagnostics, parsed)) {
    failures.push('packed job extras.packDiagnostics must equal pack-diagnostics.json');
  }
  const expectedNames = [...REQUIRED_PACKAGE_TARBALLS].sort();
  const names = parsed.map((entry) => isRecord(entry) ? entry.package : undefined);
  if (names.join(',') !== expectedNames.join(',')) {
    failures.push(
      `packDiagnostics must list exactly ${expectedNames.join(', ')}; found ${
        names.join(', ') || 'none'
      }`,
    );
  }
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      failures.push('packDiagnostics entries must be objects');
      continue;
    }
    const label = typeof entry.package === 'string' ? entry.package : '<unknown>';
    if (entry.errors !== 0) {
      failures.push(
        `packDiagnostics ${label}: errors must be 0, got ${JSON.stringify(entry.errors)}`,
      );
    }
    if (entry.unexpectedWarnings !== 0) {
      failures.push(
        `packDiagnostics ${label}: unexpectedWarnings must be 0, got ${
          JSON.stringify(entry.unexpectedWarnings)
        }`,
      );
    }
    for (
      const field of [
        'knownUpstreamPrivateWarnings',
        'publicDeclarations',
        'declarationClosure',
      ]
    ) {
      if (!Number.isSafeInteger(entry[field]) || (entry[field] as number) < 0) {
        failures.push(
          `packDiagnostics ${label}: ${field} must be a non-negative safe integer, got ${
            JSON.stringify(entry[field])
          }`,
        );
      }
    }
  }
  return failures;
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
  const extra = unknownKeys(evidence, BUNDLE_KEYS);
  if (extra.length > 0) failures.push(`evidence has unknown fields: ${extra.join(', ')}`);
  if (evidence.schemaVersion !== CANDIDATE_EVIDENCE_SCHEMA_VERSION) {
    failures.push(
      `evidence schemaVersion must be ${CANDIDATE_EVIDENCE_SCHEMA_VERSION}, got ${
        JSON.stringify(evidence.schemaVersion)
      }`,
    );
  }
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
  if (evidence.result !== 'PASS') {
    failures.push(`evidence result must be PASS, got ${JSON.stringify(evidence.result)}`);
  }
  if (evidence.trackedClean !== true) {
    failures.push('evidence trackedClean must be exactly true');
  }
  if (evidence.requiredOk !== true) {
    failures.push('evidence requiredOk must be exactly true');
  }
  failures.push(...auditToolVersions(evidence.toolVersions, 'evidence'));

  let totalSteps = 0;
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
        ? raw.steps.map((step) => {
          if (!isRecord(step)) return step;
          const { logSource, ...rest } = step;
          return { ...rest, logPath: logSource };
        })
        : raw.steps;
      if (Array.isArray(steps)) totalSteps += steps.length;
      failures.push(
        ...await auditJob(name, { ...raw, steps }, {
          mode: 'bundle',
          sha: typeof sha === 'string' ? sha : '',
          tree: typeof tree === 'string' ? tree : '',
          bundleGeneratedAtMs: Number.isNaN(recorded) ? undefined : recorded,
          read: options.read,
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

  const aggregate = evidence.aggregate;
  if (!isRecord(aggregate)) {
    failures.push('evidence aggregate must be an object');
  } else {
    const aggregateExtra = unknownKeys(aggregate, ['inputs', 'recomputedLogHashes']);
    if (aggregateExtra.length > 0) {
      failures.push(`aggregate has unknown fields: ${aggregateExtra.join(', ')}`);
    }
    const inputs = aggregate.inputs;
    if (
      !Array.isArray(inputs) || inputs.length !== JOB_NAMES.length ||
      inputs.some((entry, index) => entry !== JOB_NAMES[index])
    ) {
      failures.push(
        `aggregate.inputs must be exactly ${JOB_NAMES.join(', ')}; got ${JSON.stringify(inputs)}`,
      );
    }
    if (aggregate.recomputedLogHashes !== totalSteps) {
      failures.push(
        `aggregate.recomputedLogHashes must equal the validated step count ${totalSteps}, got ${
          JSON.stringify(aggregate.recomputedLogHashes)
        }`,
      );
    }
  }

  failures.push(...await auditTarballFiles(evidence, options));
  failures.push(...await auditPackDiagnostics(evidence, options.read));

  const tarballManifest = evidence.tarballManifest;
  if (!isRecord(tarballManifest)) {
    failures.push('tarballManifest reference missing');
  } else {
    const path = tarballManifest.path;
    const hash = tarballManifest.sha256;
    const pathFailures = auditSafeRelativePath(path);
    if (pathFailures.length > 0) {
      failures.push(`tarballManifest: ${pathFailures.join('; ')}`);
    } else if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
      failures.push('tarballManifest: sha256 must be sha256:<64 lowercase hex>');
    } else {
      const bytes = await options.read(path as string);
      if (!bytes) failures.push(`tarballManifest missing at ${path}`);
      else if ((await sha256Bytes(bytes)) !== hash) {
        failures.push(`tarballManifest hash mismatch at ${path}`);
      } else {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(bytes));
          if (!deepEqual(parsed, evidence.tarballs)) {
            failures.push('tarballManifest contents must equal the top-level tarballs map');
          }
        } catch {
          failures.push('tarballManifest is not valid JSON');
        }
      }
    }
  }

  failures.push(
    ...collectRollupFailures(isRecord(evidence.rollup) ? evidence.rollup as Rollup : undefined),
  );
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

  // Carry the shipped archives so the validator can recompute their bytes
  // instead of trusting recorded hash strings.
  const packages = await readPackages();
  const tarballFiles: Record<string, string> = {};
  await Deno.mkdir(join(outDir, 'tarballs'), { recursive: true });
  for (const pkg of packages) {
    const relativeArchive = `tarballs/${basename(tarballPath(pkg))}`;
    tarballFiles[pkg.name] = relativeArchive;
    await Deno.copyFile(tarballPath(pkg), join(outDir, relativeArchive));
  }
  const packageVersion = packages[0]?.version ?? '';

  const evidence = {
    schemaVersion: CANDIDATE_EVIDENCE_SCHEMA_VERSION,
    sha: headSha,
    tree: headTree,
    trackedClean: true,
    toolVersions: jobs.find(({ job }) => job.job === 'source-matrix')?.job.toolVersions ?? {},
    packageVersion,
    jobs: jobs.map(({ job, dir }) => ({
      schemaVersion: job.schemaVersion,
      job: job.job,
      sha: job.sha,
      tree: job.tree,
      trackedClean: job.trackedClean,
      result: job.result,
      generatedAt: job.generatedAt,
      toolVersions: job.toolVersions,
      extras: job.extras ?? {},
      steps: job.steps.map((step) => ({
        name: step.name,
        command: step.command,
        cwd: step.cwd,
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
    tarballFiles,
    tarballManifest: { path: 'tarball-manifest.json', sha256: tarballManifestSha },
    packDiagnostics: { path: 'pack-diagnostics.json', sha256: packDiagnosticsSha },
    rollup,
    // Validated and set from the assembled bundle below; the placeholder is
    // the value that will be written only if every invariant holds.
    requiredOk: true,
    aggregate: {
      inputs: [...JOB_NAMES],
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
