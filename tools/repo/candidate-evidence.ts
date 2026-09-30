/**
 * Candidate evidence: record one CI job's proof, aggregate job proofs, or
 * validate an aggregated artifact.
 *
 * Since the #1473 extraction and the alpha6 record split this file is only
 * the CLI: the `import.meta.main` dispatch plus compatibility re-exports so
 * existing import paths keep working. The record foundation — the
 * `StepResult`/`JobResult`/`LoadedJob` shapes, the process helpers (step
 * runner, git probes, SHA-free log bookkeeping), and the workspace `--job`
 * producer — lives in candidate-evidence-record.ts, the fresh-clone lane and
 * its Site E2E ownership in candidate-evidence-fresh-clone.ts, and the
 * spawn-free audit lanes in their own modules:
 *
 *   candidate-evidence-record.ts      record shapes + process primitives +
 *                                     the workspace `--job` producer
 *   candidate-evidence-fresh-clone.ts fresh-clone lane (Site E2E owner)
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

import { join } from '@std/path';
import { JOB_NAMES, type JobName } from './candidate-steps.ts';
import { aggregate } from './candidate-evidence-aggregate.ts';
import { ARTIFACT_RETENTION_DAYS, validate } from './candidate-evidence-validate.ts';
import { expectedSha, flagValue, recordJob, repoRoot } from './candidate-evidence-record.ts';
import { recordFreshClone } from './candidate-evidence-fresh-clone.ts';

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

// Record-foundation compatibility re-exports: the shapes and process
// primitives moved to candidate-evidence-record.ts and the audit lanes import
// them there; these keep the historical import paths working.
export {
  denoExe,
  expectedSha,
  type JobResult,
  type LoadedJob,
  packedRollupFromLog,
  repoRoot,
  required,
} from './candidate-evidence-record.ts';

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
