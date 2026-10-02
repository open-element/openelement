/**
 * Candidate evidence — the fresh-clone producer (alpha6 record split).
 *
 * The fresh-clone lane proves the candidate from a clean clone with an empty
 * DENO_DIR and npm cache: clone, checkout (the SHA is re-verified inside the
 * clone), install, typecheck, the fast source gate, the packed gate, the Site
 * build, and the official Site E2E — bracketed by clean proofs so
 * `trackedClean` is derived, not asserted. Commands are declared in shared
 * roles and only the spawn materializes real paths, so the recorded evidence
 * stays free of machine-specific locations.
 *
 * This lane owns the candidate's Site proof: it stages the raw
 * `.artifacts/site-e2e-report.json` bytes from inside the clone next to its
 * result.json (the sidecar stays in `extras.siteE2e`). A red Site E2E step
 * still stages the report before the failure is re-raised unchanged (#1409),
 * and a lane that produced no sidecar at all records `ran: false` for the
 * validator to fail closed on. Moved out of candidate-evidence.ts verbatim
 * (alpha6 architecture-debt lane): step order, failure behavior, and the
 * record shape are unchanged. The record shapes and process primitives come
 * from candidate-evidence-record.ts.
 */

import { join } from '@std/path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { commandOutput } from './node-command.ts';
import {
  CANDIDATE_EVIDENCE_SCHEMA_VERSION,
  cleanProofArgv,
  EVIDENCE_ROLES,
  FRESH_CLONE_ISOLATION,
  freshCloneCommands,
  materializeEvidencePath,
  normalizeEvidencePath,
  type PathRoleMapping,
} from './candidate-steps.ts';
import {
  assertCleanAtSha,
  denoExe,
  expectedSha,
  type JobResult,
  repoRoot,
  required,
  toolVersions,
} from './candidate-evidence-record.ts';
import { sha256Bytes } from './candidate-evidence-tarballs.ts';
import { type SiteE2eRollup, stageCloneSiteE2e } from './candidate-evidence-site-e2e.ts';

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

export async function recordFreshClone(outDir: string): Promise<void> {
  const expected = expectedSha();
  const { sha, tree } = await assertCleanAtSha(expected);
  await mkdir(join(outDir, 'logs'), { recursive: true });
  const tmpRoot = await mkdtemp(join(tmpdir(), 'fresh-candidate-'));
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
    const output = await commandOutput(argv[0], {
      args: argv.slice(1),
      cwd,
      stdin: 'null',
      stdout: 'piped',
      stderr: 'piped',
      env,
    });
    const text = new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr);
    const logPath = `logs/fresh-clone-${commands.length}-${name}.log`;
    await writeFile(join(outDir, logPath), text, 'utf8');
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
      ...process.env,
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
    await rm(tmpRoot, { recursive: true }).catch(() => undefined);
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
  await writeFile(join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  if (siteE2eFailure) throw siteE2eFailure;
  if (result.result !== 'PASS') process.exit(1);
}
