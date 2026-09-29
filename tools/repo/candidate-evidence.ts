/**
 * Candidate evidence: record one CI job's proof, aggregate job proofs, or
 * validate an aggregated artifact.
 *
 * Since the #1473 extraction this file is the record foundation and the CLI:
 * it keeps the job-record shapes, the process helpers (step runner, git
 * probes, SHA-free log bookkeeping), the `--job` producer, the fresh-clone
 * lane, and the `import.meta.main` dispatch. The four spawn-free audit lanes
 * live in their own modules and are re-exported below so existing import
 * paths keep working:
 *
 *   candidate-evidence-aggregate.ts   --aggregate composition
 *   candidate-evidence-validate.ts    --validate + the job/bundle audits
 *   candidate-evidence-tarballs.ts    tarball staging + byte/hash guards
 *   candidate-evidence-site-e2e.ts    Site E2E staging + forged-sidecar guard
 *
 * The evidence system never re-runs the suite in the aggregation step:
 *
 *   fast-checks  -> job result (fmt/lint/markdown/typecheck + OSS scanners)
 *   source-matrix-> gate:source (the fast PR-layer gate) + permission/FFI scans
 *   packed       -> gate:packed + publish:npm:dry-run + tarball hashes +
 *                   structured pack diagnostics
 *   fresh-clone  -> clean clone, empty DENO_DIR/npm cache, install, check,
 *                   source gate, packed gate, Site build + official Site E2E
 *
 * Each `--job` run writes `<out>/result.json` plus `<out>/logs/*.log`; the
 * result records command, exit code, result, log path, and the log SHA-256.
 * `--aggregate` reads the downloaded job results, requires one commit/tree,
 * recomputes every log hash, and writes the candidate evidence JSON next to
 * the tarball manifest, fresh-clone manifest, and pack diagnostic summary.
 * `--validate` re-checks a written artifact (SHA/tree, log presence + hashes,
 * manifest hashes, artifact age) without trusting its contents.
 *
 * Site E2E proof travels as data, not log lines: the fresh-clone lane owns it
 * (the fast source gate no longer drives the Site) and stages the raw
 * `.artifacts/site-e2e-report.json` bytes from inside the clone next to its
 * result.json (the sidecar stays in `extras.siteE2e`), and both aggregation
 * and validation recompute the summary + SHA-256 from those bytes and
 * require the sidecar's `candidateSha` to equal the candidate commit. A
 * forged, stale, or report-less sidecar fails closed.
 *
 * All commands run with stdin closed (non-interactive invariant).
 */

import { dirname, join } from '@std/path';
import { readPackages } from '../lib/package-graph.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import {
  CANDIDATE_EVIDENCE_SCHEMA_VERSION,
  cleanProofArgv,
  EVIDENCE_ROLES,
  type EvidenceToolVersions,
  FRESH_CLONE_ISOLATION,
  freshCloneCommands,
  JOB_NAMES,
  type JobName,
  materializeEvidencePath,
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
import type { SiteE2eRollup } from './candidate-evidence-site-e2e.ts';
import { stageCloneSiteE2e } from './candidate-evidence-site-e2e.ts';
import { aggregate } from './candidate-evidence-aggregate.ts';
import { ARTIFACT_RETENTION_DAYS, validate } from './candidate-evidence-validate.ts';

export { JOB_NAMES, REQUIRED_STEPS } from './candidate-steps.ts';

export { SITE_E2E_PROJECTS as REQUIRED_SITE_BROWSERS } from './site-e2e-result.ts';

export {
  carryPackedTarballs,
  collectPackedTarballFailures,
  REQUIRED_PACKAGE_TARBALLS,
  stageTarballEvidence,
} from './candidate-evidence-tarballs.ts';

export {
  collectBundleFailures,
  collectJobFailures,
  collectRollupFailures,
  REQUIRED_PACKED_CONSUMERS,
} from './candidate-evidence-validate.ts';

export {
  collectSiteE2eRecomputeFailures,
  SITE_E2E_REPORT_BUNDLE_PATH,
  SITE_E2E_REPORT_FILE,
  stageCloneSiteE2e,
} from './candidate-evidence-site-e2e.ts';

export { composeBundleJobs } from './candidate-evidence-aggregate.ts';

export const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

export const denoExe = Deno.execPath();

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

export async function required(command: string, args: string[]): Promise<string> {
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

export function expectedSha(): string {
  const value = flagValue('expected-sha') ?? Deno.env.get('CANDIDATE_SHA');
  if (!value || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error('Set CANDIDATE_SHA (or --expected-sha) to the exact 40-character SHA.');
  }
  return value;
}

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
  const packages = (await readPackages()).filter((pkg) =>
    REQUIRED_PACKAGE_TARBALLS.includes(pkg.name as (typeof REQUIRED_PACKAGE_TARBALLS)[number])
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
  for (const [label, keys] of [['tarballs', tarballs], ['tarballFiles', tarballFiles]] as const) {
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
  // Staged from inside the clone before it is deleted; the sidecar is the
  // candidate's Site proof and this lane is where it is produced.
  let siteE2e: SiteE2eRollup | undefined;
  // #1409: a red Site E2E step must not skip the evidence staging below, so it
  // is captured here and re-raised after `result.json` is written.
  let siteE2eFailure: Error | undefined;
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
    // The PR-layer lane: the fresh clone proves the fast source gate and the
    // packed gate. The release train (registry read, gate:release, packed
    // gate, publish dry-run) belongs to the release workflow, not to every
    // PR — see docs/maintainers/releasing.md.
    await run('task-gate-source', freshCloneCommands.gateSource(denoExe), cloneDir, isolatedEnv);
    await run('task-gate-packed', freshCloneCommands.gatePacked(denoExe), cloneDir, isolatedEnv);
    // This lane owns the candidate's Site proof: build the Site in the clone
    // and drive the official Playwright suite there, so the recorded sidecar
    // describes the same exact SHA/tree as every other job.
    await run('task-site-build', freshCloneCommands.siteBuild(denoExe), cloneDir, isolatedEnv);
    // #1409: the Site E2E step must not throw past the evidence staging below.
    // A failing suite is exactly the case whose per-test names are unrecoverable
    // without a live runner, so the raw report is staged on failure too — then
    // the failure is re-raised, unchanged, after the record is written.
    try {
      await run('task-site-e2e', freshCloneCommands.siteE2e(denoExe), cloneDir, isolatedEnv);
    } catch (cause) {
      siteE2eFailure = cause instanceof Error ? cause : new Error(String(cause));
    }
    await runCleanProof('after');
    // Staged whenever the runner wrote a recordable sidecar (green or red);
    // a lane that produced no sidecar at all records `ran: false` and the
    // validator fails closed on it.
    siteE2e = await stageCloneSiteE2e(cloneDir, outDir, sha, { required: !siteE2eFailure });
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
    extras: { isolation: FRESH_CLONE_ISOLATION, siteE2e: siteE2e ?? { ran: false } },
    generatedAt: new Date().toISOString(),
  };
  await Deno.writeTextFile(join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  if (siteE2eFailure) throw siteE2eFailure;
  if (result.result !== 'PASS') Deno.exit(1);
}

// ─── Aggregation ─────────────────────────────────────────────────────

/** One job result loaded from a downloaded evidence directory. */
export interface LoadedJob {
  job: JobResult;
  dir: string;
  read: (path: string) => Promise<Uint8Array | null>;
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
