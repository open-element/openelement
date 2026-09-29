/**
 * Candidate evidence — validation (issue #1473 extraction).
 *
 * Everything is treated as untrusted JSON: `auditJob` is the single source of
 * job invariants shared by aggregate (job result.json files) and validate
 * (the aggregated bundle); `collectBundleFailures` re-checks a written
 * artifact (SHA/tree, log presence + hashes, manifest hashes, artifact age)
 * without trusting its contents. The process-side `validate()` entry wraps
 * the pure checks for the CLI. Moved out of candidate-evidence.ts verbatim:
 * checks, failure texts, and exit behavior are unchanged.
 *
 * The job-record shapes (`JobResult`/`LoadedJob`) stay on the record
 * foundation in candidate-evidence.ts and are imported here as types only.
 */

import { dirname, join } from '@std/path';
import {
  auditFreshCloneIsolation,
  auditStep,
  auditToolVersions,
  CANDIDATE_EVIDENCE_SCHEMA_VERSION,
  cleanProofLine,
  JOB_NAMES,
  type JobName,
  REQUIRED_STEPS,
} from './candidate-steps.ts';
import { auditReusedStamp } from './evidence-reuse.ts';
import { auditTarballPackage } from './tarball-inspect.ts';
import {
  auditSafeRelativePath,
  collectPackedTarballFailures,
  isRecord,
  PACKAGE_VERSION_PATTERN,
  REQUIRED_PACKAGE_TARBALLS,
  SHA256_HEX,
  sha256Bytes,
} from './candidate-evidence-tarballs.ts';
import { auditSiteE2e } from './site-e2e-result.ts';
import {
  collectSiteE2eRecomputeFailures,
  SITE_E2E_REPORT_BUNDLE_PATH,
  type SiteE2eRollup,
} from './candidate-evidence-site-e2e.ts';
import type { JobResult, LoadedJob } from './candidate-evidence.ts';
import { required } from './candidate-evidence.ts';

/** Artifact age policy shared by the CLI validate path. */
export const ARTIFACT_RETENTION_DAYS = 14;

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

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function isCommit(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
}

function unknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  return Object.keys(record).filter((key) => !allowed.includes(key));
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
  // Present only on a job whose proof was reused from a tree-identical run
  // (tools/repo/evidence-reuse.ts); it is what licenses `sha` to differ.
  'reused',
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
  // Reuse (#1425 follow-up): a job carrying `reused` proved a TREE, not this
  // commit, so its `sha` legitimately differs. `tree` must still match — that
  // is the reuse key — and the stamp is audited on its own.
  const reusedStamp = rawJob.reused;
  if (reusedStamp === undefined) {
    if (rawJob.sha !== context.sha) {
      failures.push(`${job}: sha ${JSON.stringify(rawJob.sha)} != ${context.sha}`);
    }
  } else {
    failures.push(...auditReusedStamp(reusedStamp).map((failure) => `${job}: ${failure}`));
    if (rawJob.sha === context.sha) {
      failures.push(
        `${job}: claims reused proof for its own commit ${context.sha}; a reused job must ` +
          `record the source commit it was replayed from`,
      );
    }
    // The stamp and the record must agree on the source commit: a stamp that
    // names a different commit than the record ran at cannot be traced back to
    // a tree-identical run.
    if (isRecord(reusedStamp) && reusedStamp.sha !== rawJob.sha) {
      failures.push(
        `${job}: reused.sha ${JSON.stringify(reusedStamp.sha)} != job sha ${
          JSON.stringify(rawJob.sha)
        }`,
      );
    }
  }
  // Everything a reused record's steps were produced against is the SOURCE
  // commit (its argv, its clean-proof lines), so the step audit binds to the
  // record's own sha whenever the proof was replayed.
  const proofSha = reusedStamp !== undefined && typeof rawJob.sha === 'string'
    ? rawJob.sha
    : context.sha;
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
  const requiredSteps = REQUIRED_STEPS[job];
  for (const name of requiredSteps) {
    if (!byName.has(name)) failures.push(`${job}: required step missing: ${name}`);
  }
  for (const name of byName.keys()) {
    if (!requiredSteps.includes(name)) {
      failures.push(`${job}: unknown step '${name}' (not in the canonical contract)`);
    }
  }
  let previousStartedAt = Number.NEGATIVE_INFINITY;
  let lastStepEndMs = Number.NEGATIVE_INFINITY;
  for (const name of requiredSteps) {
    const step = byName.get(name);
    if (!step) continue;
    const label = `${job}/${name}`;
    failures.push(
      ...auditStep(job, name, step.command, step.cwd, { sha: proofSha, tree: context.tree })
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
          cleanProofLine(proofSha, context.tree, phase),
        )
      ) {
        failures.push(`${label}: log is missing the canonical clean-proof PASS line`);
      }
    }
  }
  if (job === 'fresh-clone') {
    const isolation = isRecord(rawJob.extras) ? rawJob.extras.isolation : undefined;
    failures.push(...auditFreshCloneIsolation(isolation).map((failure) => `${job}: ${failure}`));
    // This lane owns exactly two keys: the isolation disclosure and the Site
    // E2E sidecar it produced. Any other key is an unknown extra and fails
    // closed, so a lane cannot smuggle unaccounted proof into its record.
    if (isRecord(rawJob.extras)) {
      const extra = unknownKeys(rawJob.extras, ['isolation', 'siteE2e']);
      if (extra.length > 0) failures.push(`${job}: unknown extras fields: ${extra.join(', ')}`);
    }
  } else if (job === 'packed') {
    // ponytail: bundle mode checks shape only; final archive bytes are
    // re-verified against the top-level maps (upgrade: byte-check here too
    // once packed paths are bundle-relative).
    failures.push(
      ...await collectPackedTarballFailures(rawJob.extras, {
        read: context.read,
        checkBytes: context.mode === 'job',
      }),
    );
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
  failures.push(
    ...auditReuseConsistency(
      [...byName].map(([name, entry]) => ({
        name,
        reused: isRecord(entry.job) ? entry.job.reused : undefined,
      })),
    ),
  );
  return failures;
}

/**
 * Cross-job reuse consistency (#1425 follow-up). The per-job audit already
 * proved every record's `tree` equals the checked-out tree, so a reused
 * record's differing `sha` is licensed. What can still be checked locally is
 * that the bundle was not spliced: every reused job must name the SAME source
 * run, because that one run's tree match is what makes them all valid. Two
 * source runs would mean the resolver's single decision was bypassed.
 */
function auditReuseConsistency(
  jobs: ReadonlyArray<{ name: string; reused: unknown }>,
): string[] {
  const sourceRuns = new Map<number, string[]>();
  for (const { name, reused } of jobs) {
    if (!isRecord(reused) || !Number.isSafeInteger(reused.runId)) continue;
    const runId = reused.runId as number;
    sourceRuns.set(runId, [...(sourceRuns.get(runId) ?? []), name]);
  }
  if (sourceRuns.size <= 1) return [];
  return [
    `reused evidence comes from ${sourceRuns.size} different runs (` +
    [...sourceRuns].map(([runId, names]) => `${runId}: ${names.join('+')}`).join(', ') +
    `); one reused tree must be replayed from one source run`,
  ];
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
  for (const requiredConsumer of REQUIRED_PACKED_CONSUMERS) {
    if (!consumers.has(requiredConsumer)) {
      failures.push(`packed consumer missing: ${requiredConsumer}`);
    }
  }
  failures.push(...auditSiteE2e(rollup.siteE2e));
  return failures;
}

interface Rollup {
  artifactCheck?: boolean;
  consumers?: string[];
  siteE2e?: SiteE2eRollup;
}

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

/**
 * Order-insensitive equality for string maps (insertion order differs
 * between producer staging and aggregator composition, so JSON.stringify
 * comparison would false-negative on identical maps).
 */
function stringMapsEqual(a: unknown, b: unknown): boolean {
  if (!isRecord(a) || !isRecord(b)) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.join(',') !== bKeys.join(',') || aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
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
  if (packedExtras && !stringMapsEqual(packedExtras.tarballs, evidence.tarballs)) {
    failures.push('packed job extras.tarballs must equal the top-level tarballs map');
  }
  if (packedExtras && !stringMapsEqual(packedExtras.tarballFiles, evidence.tarballFiles)) {
    failures.push('packed job extras.tarballFiles must equal the top-level tarballFiles map');
  }
  if (
    packedExtras && typeof version === 'string' && PACKAGE_VERSION_PATTERN.test(version) &&
    packedExtras.packageVersion !== version
  ) {
    failures.push('packed job extras.packageVersion must equal the top-level packageVersion');
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
  // Diagnostics order is per-package output order, not a contract; compare as
  // a set, but require exactly one entry per package.
  const names = parsed.map((entry) => isRecord(entry) ? entry.package : undefined).sort();
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
    // The bundle path audits each job in place, so the cross-job reuse check
    // has to run here too — a spliced bundle must fail in both modes.
    failures.push(
      ...auditReuseConsistency(
        rawJobs.filter(isRecord).map((job) => ({
          name: typeof job.job === 'string' ? job.job : '<unknown>',
          reused: job.reused,
        })),
      ),
    );
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
          if (!stringMapsEqual(parsed, evidence.tarballs)) {
            failures.push('tarballManifest contents must equal the top-level tarballs map');
          }
        } catch {
          failures.push('tarballManifest is not valid JSON');
        }
      }
    }
  }

  const rollup = isRecord(evidence.rollup) ? evidence.rollup as Rollup : undefined;
  failures.push(...collectRollupFailures(rollup));
  // A reused fresh-clone job proves a tree, not a commit: bind its Site E2E
  // sidecar to the commit the suite actually ran at (#1425). The candidate
  // identity the caller supplied applies first, then the job's own sha wins
  // when the proof was replayed.
  const bundleSha = options.expectedSha ?? (isCommit(sha) ? sha : undefined);
  const freshJob = Array.isArray(evidence.jobs)
    ? (evidence.jobs as unknown[]).find((job) => isRecord(job) && job.job === 'fresh-clone') as
      | Pick<JobResult, 'sha' | 'reused'>
      | undefined
    : undefined;
  const siteE2eSha = freshJob !== undefined && bundleSha !== undefined
    ? jobProofSha(freshJob, bundleSha)
    : bundleSha;
  failures.push(
    ...await collectSiteE2eRecomputeFailures(rollup?.siteE2e, {
      readReport: () => options.read(SITE_E2E_REPORT_BUNDLE_PATH),
      expectedSha: siteE2eSha,
    }),
  );
  return failures;
}

/**
 * The commit a job's proof actually ran at. A reused record (#1425) carries
 * the SOURCE commit, so anything derived from its bytes — the Site E2E
 * sidecar's `candidateSha` — is bound to that, while the tree binding stays
 * the reuse key.
 */
export function jobProofSha(job: Pick<JobResult, 'sha' | 'reused'>, expected: string): string {
  return job.reused !== undefined && typeof job.sha === 'string' ? job.sha : expected;
}

export async function validate(
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
