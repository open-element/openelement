/**
 * REL-01 — exact-SHA release evidence binder.
 *
 * Produces the qualification block of a PR / release checklist from the
 * authoritative sources instead of a hand-written table:
 *
 *   - every AutoFlow CI run returned for the candidate \`head_sha\`, with its
 *     attempt, conclusion, event/branch and timestamps — a run whose conclusion
 *     is not \`success\` can be *recorded* but is never selected as qualification;
 *   - the exact Full qualification job instances, including the SHA guard and
 *     every matrix leg, and the same-SHA main push jobs for release evidence;
 *   - the run's artifacts (id, name, bytes, expired) and the listing total;
 *   - the authoritative CodeQL alert list for the PR merge ref
 *     (\`refs/pull/<n>/merge\`) or \`refs/heads/main\` — state, severity, rule,
 *     timestamps per alert, never a check-run summary;
 *   - npm dist-tags for the six published packages (read-only \`npm view\`);
 *   - Git tag and GitHub Release existence for the candidate version.
 *
 * Fail-closed rules (each one is a refusal in the verdict, and a non-zero exit):
 *   - a run bound to a different \`head_sha\` than the candidate;
 *   - no Full qualification, or no successful same-SHA main push in release mode;
 *   - a missing, duplicated, or unexpected job instance, an incomplete listing,
 *     or a conclusion that differs from the Full or Base contract;
 *   - a CodeQL answer for a different ref, or a non-network query failure;
 *   - a candidate tag pointing at a different SHA;
 *   - a dimension that could not be queried (network offline, missing fixture)
 *     is a loud SKIP: the run is then \`incomplete\`, never \`qualified\`.
 *
 * Offline / CI-safe use: pass \`--fixtures <file>\` to evaluate a recorded set of
 * API answers (the same evaluation code — no network), or \`--check <file>\` to
 * re-evaluate a previously written evidence document. CI uses the default
 * \`gh\` CLI path; the tests use fixtures.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import {
  CI_BASE_LISTING,
  CI_GUARD_JOB,
  CI_QUALIFICATION_JOBS,
  CI_RUN_INSTANCES,
} from '../repo/ci-qualification.ts';

/** The workflow whose runs are the qualification evidence. */
export const EVIDENCE_WORKFLOW = 'autoflow-ci.yml';

/** The six published packages whose dist-tags are part of the evidence. */
export const RELEASE_PACKAGES: readonly string[] = [
  '@openelement/protocol',
  '@openelement/element',
  '@openelement/compiler',
  '@openelement/router',
  '@openelement/create',
  '@openelement/ui',
];

export interface CiRun {
  id: number;
  attempt: number;
  status: string;
  conclusion: string | null;
  event: string;
  headBranch: string | null;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface CiJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string;
  /** The matrix instance label GitHub renders after the job ID, if any. */
  instance: string | null;
}

export interface CiArtifact {
  id: number;
  name: string;
  sizeInBytes: number;
  expired: boolean;
  createdAt: string;
}

interface CiJobEvidence {
  runId: number;
  jobs: CiJob[];
  jobListingTotal: number;
}

export interface CodeqlAlert {
  number: number;
  ruleId: string;
  /** The rule's own severity (CodeQL's `error`/`warning`). */
  severity: string;
  /** The GitHub security severity when the rule carries one (`medium` etc.). */
  securitySeverity: string | null;
  state: string;
  dismissedReason: string | null;
  tool: string;
  ref: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface PackageDistTags {
  name: string;
  /** Dist-tag -> version, exactly as the registry served it. */
  distTags: Record<string, string>;
  /** Set when the registry did not answer (non-network failures are refusals). */
  error?: string;
}

export interface EvidenceDocument {
  schemaVersion: 1;
  collectedAt: string;
  candidate: {
    sha: string;
    repository: string;
    pullRequest: number | null;
    tag: string;
    packages: readonly string[];
    workflow: string;
    /** True when a push/main run is additionally required (release contract). */
    requireMainPush: boolean;
  };
  ci: {
    origin: string;
    runs: CiRun[];
    qualificationRunId: number | null;
    /**
     * An independent successful main push when the Full qualification was a
     * dispatch. A historical Full main push already proves both requirements.
     */
    mainPush?: CiJobEvidence | null;
    /** Exact successful Base listings skipped ahead of the Full release run. */
    skippedBaseRuns?: CiJobEvidence[];
    /** How the full qualification run was selected from its exact job listing. */
    selectionBasis: string | null;
    /** Successful runs whose job instances did not satisfy the contract. */
    rejectedRuns: { id: number; reason: string }[];
    jobs: CiJob[];
    jobListingTotal: number | null;
    artifacts: CiArtifact[];
    artifactListingTotal: number | null;
  };
  codeql: {
    origin: string;
    ref: string;
    queriedAt: string | null;
    alerts: CodeqlAlert[];
    error: string | null;
  };
  registry: {
    origin: string;
    queriedAt: string | null;
    packages: PackageDistTags[];
    error: string | null;
  };
  git: {
    origin: string;
    tag: { name: string; sha: string | null; exists: boolean; error?: string };
    release: {
      tag: string;
      exists: boolean;
      createdAt: string | null;
      htmlUrl: string | null;
      error?: string;
    };
  };
}

export interface EvidenceVerdict {
  /** True only when every dimension was queried and every rule passed. */
  qualified: boolean;
  /** Fail-closed findings: the candidate must not be cited as qualified. */
  refusals: string[];
  /** Dimensions that could not be queried (loud SKIP; never a silent pass). */
  skips: string[];
  /** Non-blocking facts the checklist must still carry (e.g. open alerts). */
  notes: string[];
}

/** Read a bare evidence document or the envelope written by --json. */
export function parseEvidenceDocument(raw: string): EvidenceDocument {
  const parsed = JSON.parse(raw) as
    | (Partial<EvidenceDocument> & { document?: EvidenceDocument })
    | null;
  const document = parsed?.document ?? parsed;
  if (document?.schemaVersion !== 1 || !document.candidate || !document.ci) {
    throw new Error('expected a version 1 evidence document');
  }
  return document as EvidenceDocument;
}

/** The subset of raw GitHub CI run JSON this tool reads. */
export interface RawRun {
  id: number;
  run_attempt?: number;
  attempt?: number;
  status: string;
  conclusion: string | null;
  event: string;
  head_branch: string | null;
  head_sha: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface RawJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
}

export interface RawArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
  created_at: string;
}

export interface RawAlert {
  number: number;
  state: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  dismissed_reason?: string | null;
  rule: { id: string; severity: string; security_severity_level?: string | null };
  tool: { name: string };
  most_recent_instance?: { ref?: string };
}

/** Recorded API answers for offline evaluation. Missing keys are skips. */
export interface EvidenceFixtures {
  runs?: RawRun[];
  runDetails?: Record<string, RawRun>;
  jobs?: Record<string, { total_count: number; jobs: RawJob[] }>;
  artifacts?: Record<string, { total_count: number; artifacts: RawArtifact[] }>;
  codeql?: { ref: string; alerts: RawAlert[] } | { ref: string; error: string };
  tags?: Record<string, string | null>;
  releases?: Record<string, { name: string; created_at: string; html_url: string } | null>;
  distTags?: Record<string, { distTags: Record<string, string> } | { error: string }>;
}

export interface EvidenceSource {
  /** Human-readable origin recorded in the document. */
  readonly origin: string;
  listWorkflowRuns(workflow: string, sha: string): Promise<CiRun[]>;
  getRun(runId: number): Promise<CiRun | null>;
  listJobs(runId: number): Promise<{ totalCount: number; jobs: CiJob[] } | null>;
  listArtifacts(runId: number): Promise<{ totalCount: number; artifacts: CiArtifact[] } | null>;
  listCodeqlAlerts(
    ref: string,
  ): Promise<{ ref: string; alerts: CodeqlAlert[] } | { error: string }>;
  getTagSha(tag: string): Promise<string | null>;
  getRelease(tag: string): Promise<{ createdAt: string; htmlUrl: string } | null>;
  npmDistTags(packageName: string): Promise<PackageDistTags>;
}

/** True when a failure reads as "the network is not available" (loud SKIP). */
export function isOfflineFailure(message: string): boolean {
  const markers = [
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'getaddrinfo',
    'socket hang up',
    'error connecting to api.github.com',
    'Could not resolve host',
    'network is unreachable',
  ];
  return markers.some((marker) => message.includes(marker));
}

function toRun(raw: RawRun): CiRun {
  return {
    id: raw.id,
    attempt: raw.run_attempt ?? raw.attempt ?? 1,
    status: raw.status,
    conclusion: raw.conclusion,
    event: raw.event,
    headBranch: raw.head_branch,
    headSha: raw.head_sha,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    htmlUrl: raw.html_url,
  };
}

function toJob(raw: RawJob): CiJob {
  // Matrix instances render as "id (instance label)"; the base ID is the key.
  const match = /^([^()]+?)(?:\s+\((.+)\))?$/.exec(raw.name);
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    conclusion: raw.conclusion,
    startedAt: raw.started_at,
    completedAt: raw.completed_at,
    htmlUrl: raw.html_url,
    instance: match?.[2] ?? null,
  };
}

function toArtifact(raw: RawArtifact): CiArtifact {
  return {
    id: raw.id,
    name: raw.name,
    sizeInBytes: raw.size_in_bytes,
    expired: raw.expired,
    createdAt: raw.created_at,
  };
}

/** The severity a checklist cites: GitHub's security level when present. */
function alertSeverity(alert: CodeqlAlert): string {
  return alert.securitySeverity ?? alert.severity;
}

function toAlert(raw: RawAlert): CodeqlAlert {
  return {
    number: raw.number,
    ruleId: raw.rule.id,
    severity: raw.rule.severity,
    securitySeverity: raw.rule.security_severity_level ?? null,
    state: raw.state,
    dismissedReason: raw.dismissed_reason ?? null,
    tool: raw.tool.name,
    ref: raw.most_recent_instance?.ref ?? '',
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    htmlUrl: raw.html_url,
  };
}

/** Base job ID of an API job name: \`e2e-full (site-e2e)\` -> \`e2e-full\`. */
export function jobBaseId(name: string): string {
  const match = /^([^()]+?)(?:\s+\((.+)\))?$/.exec(name);
  return (match?.[1] ?? name).trim();
}

async function run(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function ghApi<T>(path: string): Promise<T> {
  const result = await run('gh', ['api', '-H', 'Accept: application/vnd.github+json', path]);
  if (result.code !== 0)
    throw new Error(`gh api ${path} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  return JSON.parse(result.stdout) as T;
}

/** \`gh api\` against a resource that may legitimately be absent (404 -> null). */
async function ghApiOptional<T>(path: string): Promise<T | null> {
  const result = await run('gh', ['api', '-H', 'Accept: application/vnd.github+json', path]);
  if (result.code === 0) return JSON.parse(result.stdout) as T;
  const message = `${result.stderr}${result.stdout}`;
  if (/HTTP 404|Not Found/i.test(message)) return null;
  throw new Error(`gh api ${path} failed: ${message.trim()}`);
}

/** Live source: \`gh\` CLI for GitHub, \`npm view\` for dist-tags (read-only). */
export function createGhSource(repository: string): EvidenceSource {
  return {
    origin: `gh api (repository ${repository}) + npm view`,
    async listWorkflowRuns(workflow, sha) {
      const answer = await ghApi<{ workflow_runs: RawRun[] }>(
        `repos/${repository}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`,
      );
      return answer.workflow_runs.map(toRun);
    },
    async getRun(runId) {
      const raw = await ghApiOptional<RawRun>(`repos/${repository}/actions/runs/${runId}`);
      return raw ? toRun(raw) : null;
    },
    async listJobs(runId) {
      const answer = await ghApiOptional<{ total_count: number; jobs: RawJob[] }>(
        `repos/${repository}/actions/runs/${runId}/jobs?per_page=100&filter=latest`,
      );
      return answer ? { totalCount: answer.total_count, jobs: answer.jobs.map(toJob) } : null;
    },
    async listArtifacts(runId) {
      const answer = await ghApiOptional<{ total_count: number; artifacts: RawArtifact[] }>(
        `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
      );
      return answer
        ? { totalCount: answer.total_count, artifacts: answer.artifacts.map(toArtifact) }
        : null;
    },
    async listCodeqlAlerts(ref) {
      // The authoritative list: every page, per alert, never a check-run summary.
      const alerts: CodeqlAlert[] = [];
      for (let page = 1; page <= 20; page += 1) {
        const answer = await ghApi<RawAlert[]>(
          `repos/${repository}/code-scanning/alerts?ref=${encodeURIComponent(ref)}&state=open,dismissed,fixed&per_page=100&page=${page}`,
        );
        alerts.push(...answer.map(toAlert));
        if (answer.length < 100) break;
      }
      return { ref, alerts };
    },
    async getTagSha(tag) {
      const answer = await ghApiOptional<{ object?: { sha?: string; url?: string } }>(
        `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
      );
      if (!answer) return null;
      // Annotated tags point at a tag object; resolve it to the commit.
      const object = answer.object;
      if (!object?.sha) return null;
      if (object.url?.includes('/git/tags/')) {
        const tagObject = await ghApiOptional<{ object?: { sha?: string } }>(
          object.url.replace('https://api.github.com/', ''),
        );
        return tagObject?.object?.sha ?? object.sha;
      }
      return object.sha;
    },
    async getRelease(tag) {
      const answer = await ghApiOptional<{ created_at: string; html_url: string }>(
        `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
      );
      return answer ? { createdAt: answer.created_at, htmlUrl: answer.html_url } : null;
    },
    async npmDistTags(packageName) {
      const result = await run('npm', ['view', packageName, 'dist-tags', '--json']);
      if (result.code !== 0) {
        return {
          name: packageName,
          distTags: {},
          error: result.stderr.trim() || result.stdout.trim(),
        };
      }
      const parsed = JSON.parse(result.stdout) as Record<string, string>;
      return { name: packageName, distTags: parsed };
    },
  };
}

/** Offline source: recorded API answers; a missing key is a loud skip. */
export function createFixtureSource(fixtures: EvidenceFixtures, origin: string): EvidenceSource {
  // Every method returns a Promise by contract; the fixture answers are already
  // in memory, so the values are wrapped instead of marking the methods async
  // with nothing to await (the error path is a rejection for the same reason).
  const missing = (key: string): Promise<never> =>
    Promise.reject(new Error(`fixture-missing: ${key}`));
  return {
    origin,
    listWorkflowRuns() {
      if (!fixtures.runs) return missing('runs');
      return Promise.resolve(fixtures.runs.map(toRun));
    },
    getRun(runId) {
      const raw = fixtures.runDetails?.[String(runId)];
      if (!raw) return missing(`runDetails/${runId}`);
      return Promise.resolve(toRun(raw));
    },
    listJobs(runId) {
      const listing = fixtures.jobs?.[String(runId)];
      if (!listing) return missing(`jobs/${runId}`);
      return Promise.resolve({ totalCount: listing.total_count, jobs: listing.jobs.map(toJob) });
    },
    listArtifacts(runId) {
      const listing = fixtures.artifacts?.[String(runId)];
      if (!listing) return missing(`artifacts/${runId}`);
      return Promise.resolve({
        totalCount: listing.total_count,
        artifacts: listing.artifacts.map(toArtifact),
      });
    },
    listCodeqlAlerts() {
      if (!fixtures.codeql) return missing('codeql');
      if ('error' in fixtures.codeql) return Promise.resolve({ error: fixtures.codeql.error });
      return Promise.resolve({
        ref: fixtures.codeql.ref,
        alerts: fixtures.codeql.alerts.map(toAlert),
      });
    },
    getTagSha(tag) {
      if (!fixtures.tags) return missing('tags');
      return Promise.resolve(fixtures.tags[tag] ?? null);
    },
    getRelease(tag) {
      if (!fixtures.releases) return missing('releases');
      const raw = fixtures.releases[tag];
      return Promise.resolve(raw ? { createdAt: raw.created_at, htmlUrl: raw.html_url } : null);
    },
    npmDistTags(packageName) {
      const entry = fixtures.distTags?.[packageName];
      if (!entry) return missing(`distTags/${packageName}`);
      if ('error' in entry) {
        return Promise.resolve({ name: packageName, distTags: {}, error: entry.error });
      }
      return Promise.resolve({ name: packageName, distTags: entry.distTags });
    },
  };
}

function skipReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('fixture-missing:')) return message;
  if (isOfflineFailure(message)) return `offline: ${message}`;
  return `unavailable: ${message}`;
}

function isSkip(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('fixture-missing:') || isOfflineFailure(message);
}

const FULL_LISTING = CI_RUN_INSTANCES.map((name) => ({ name, conclusion: 'success' }));

/**
 * The same exact names and conclusions the release workflow reads. Empty means
 * the API returned every required instance once, including the SHA guard.
 */
export function contractFailures(jobs: readonly CiJob[], totalCount: number): string[] {
  return listingFailures(jobs, totalCount, FULL_LISTING);
}

function listingFailures(
  jobs: readonly CiJob[],
  totalCount: number,
  expected: readonly { name: string; conclusion: string }[],
): string[] {
  const failures: string[] = [];
  if (totalCount !== jobs.length) {
    failures.push(`CI jobs listing is incomplete (${jobs.length}/${totalCount})`);
  }
  const conclusions = new Map(expected.map(({ name, conclusion }) => [name, conclusion]));
  const counts = new Map<string, number>();
  for (const job of jobs) {
    counts.set(job.name, (counts.get(job.name) ?? 0) + 1);
    const conclusion = conclusions.get(job.name);
    if (conclusion === undefined) {
      failures.push(`CI job '${job.name}' is outside the qualification contract`);
    } else if (job.conclusion !== conclusion) {
      failures.push(
        `required CI job ${job.name} concluded ${job.conclusion ?? job.status}; expected ${conclusion}`,
      );
    }
  }
  for (const { name } of expected) {
    const count = counts.get(name) ?? 0;
    if (count === 0) failures.push(`required CI job instance ${name} is missing`);
    else if (count > 1) failures.push(`required CI job instance ${name} appears ${count} times`);
  }
  return failures;
}

function isMainPush(run: CiRun): boolean {
  return run.event === 'push' && run.headBranch === 'main';
}

function isSuccessful(run: CiRun, sha: string): boolean {
  return run.headSha === sha && run.status === 'completed' && run.conclusion === 'success';
}

function newestFirst(a: CiRun, b: CiRun): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
}

function releaseCandidates(runs: readonly CiRun[], sha: string): CiRun[] {
  return runs
    .filter((run) => run.headSha === sha && (run.event === 'workflow_dispatch' || isMainPush(run)))
    .sort((a, b) => Number(isMainPush(a)) - Number(isMainPush(b)) || newestFirst(a, b));
}

function releaseRunFailure(run: CiRun): string {
  return `CI run ${run.id} concluded ${run.conclusion ?? run.status} before Full release qualification`;
}

function releaseSelectionFailures(document: EvidenceDocument, qualification: CiRun): string[] {
  const sha = document.candidate.sha;
  const candidates = releaseCandidates(document.ci.runs, sha);
  const selection = candidates.findIndex((run) => run.id === qualification.id);
  if (selection < 0) {
    return [
      `qualification run ${qualification.id} must be a same-SHA workflow_dispatch or push/main run for release`,
    ];
  }
  const failures: string[] = [];
  for (const run of candidates.slice(0, selection)) {
    if (!isSuccessful(run, sha)) {
      failures.push(releaseRunFailure(run));
      continue;
    }
    const proof = document.ci.skippedBaseRuns?.find((base) => base.runId === run.id);
    if (!proof) {
      failures.push(
        `CI run ${run.id} precedes the Full release run without a verified Base listing`,
      );
      continue;
    }
    for (const failure of listingFailures(proof.jobs, proof.jobListingTotal, CI_BASE_LISTING)) {
      failures.push(`CI run ${run.id}: ${failure}`);
    }
  }
  return failures;
}

function mainPushFailures(document: EvidenceDocument, qualification: CiRun): string[] {
  // The Full listing and outcome of this run are already checked separately.
  if (isMainPush(qualification)) return [];
  const proof = document.ci.mainPush;
  const sha = document.candidate.sha;
  const push = proof && document.ci.runs.find((run) => run.id === proof.runId);
  if (!proof || !push || !isMainPush(push) || !isSuccessful(push, sha)) {
    return [`no successful push/main CI evidence recorded for ${sha}`];
  }
  const base = listingFailures(proof.jobs, proof.jobListingTotal, CI_BASE_LISTING);
  const full = contractFailures(proof.jobs, proof.jobListingTotal);
  if (base.length === 0 || full.length === 0) return [];
  const failures = proof.jobs.some((job) => job.conclusion === 'skipped') ? base : full;
  return failures.map((failure) => `main push ${push.id}: ${failure}`);
}

function artifactListingFailures(ci: EvidenceDocument['ci'], runId: number): string[] {
  const { artifacts, artifactListingTotal } = ci;
  if (artifactListingTotal == null)
    return [`CI artifacts for qualification run ${runId} are unverified`];
  if (artifactListingTotal !== artifacts.length) {
    return [`CI artifacts listing is incomplete (${artifacts.length}/${artifactListingTotal})`];
  }
  return [];
}

/** Collect the full evidence document for one candidate SHA. */
export async function collectEvidence(options: {
  source: EvidenceSource;
  sha: string;
  repository: string;
  pullRequest: number | null;
  tag: string;
  packages: readonly string[];
  /** Require a same-SHA Base or Full main push as well as Full qualification. */
  requireMainPush?: boolean;
  /** Separate source for the CodeQL alerts (fork candidate, base-repo PR ref). */
  codeqlSource?: EvidenceSource;
  now: string;
}): Promise<{ document: EvidenceDocument; verdict: EvidenceVerdict }> {
  const { source, sha, repository, pullRequest, tag, packages, now } = options;
  const requireMainPush = options.requireMainPush ?? false;
  const codeqlSource = options.codeqlSource ?? source;
  const refusals: string[] = [];
  const skips: string[] = [];
  const notes: string[] = [];

  const document: EvidenceDocument = {
    schemaVersion: 1,
    collectedAt: now,
    candidate: {
      sha,
      repository,
      pullRequest,
      tag,
      packages,
      workflow: EVIDENCE_WORKFLOW,
      requireMainPush,
    },
    ci: {
      origin: source.origin,
      runs: [],
      qualificationRunId: null,
      mainPush: null,
      skippedBaseRuns: [],
      selectionBasis: null,
      rejectedRuns: [],
      jobs: [],
      jobListingTotal: null,
      artifacts: [],
      artifactListingTotal: null,
    },
    codeql: { origin: codeqlSource.origin, ref: '', queriedAt: null, alerts: [], error: null },
    registry: { origin: source.origin, queriedAt: null, packages: [], error: null },
    git: {
      origin: source.origin,
      tag: { name: tag, sha: null, exists: false },
      release: { tag, exists: false, createdAt: null, htmlUrl: null },
    },
  };

  // ── CI runs and the qualification selection ─────────────────────────────
  let qualificationRun: CiRun | null = null;
  try {
    const runs = await source.listWorkflowRuns(EVIDENCE_WORKFLOW, sha);
    document.ci.runs = runs;
    for (const run of runs) {
      if (run.headSha !== sha) {
        refusals.push(
          `CI run ${run.id} is bound to ${run.headSha}, not the candidate ${sha}; refused`,
        );
      }
    }
    const candidates = requireMainPush
      ? releaseCandidates(runs, sha)
      : runs.filter((run) => isSuccessful(run, sha)).sort(newestFirst);
    for (const run of candidates) {
      if (qualificationRun && !isMainPush(run)) continue;
      const selectingReleaseRun = requireMainPush && !qualificationRun;
      if (!isSuccessful(run, sha)) {
        if (!selectingReleaseRun) continue;
        refusals.push(releaseRunFailure(run));
        break;
      }
      const listing = await source.listJobs(run.id);
      if (!listing) {
        document.ci.rejectedRuns.push({ id: run.id, reason: 'job listing unavailable' });
        if (selectingReleaseRun) break;
        continue;
      }
      const failures = contractFailures(listing.jobs, listing.totalCount);
      const full = failures.length === 0;
      const base =
        !full && listingFailures(listing.jobs, listing.totalCount, CI_BASE_LISTING).length === 0;
      if (!full && !base) {
        document.ci.rejectedRuns.push({ id: run.id, reason: failures.join('; ') });
        if (selectingReleaseRun) break;
        continue;
      }
      const proof = { runId: run.id, jobs: listing.jobs, jobListingTotal: listing.totalCount };
      if (base && selectingReleaseRun) document.ci.skippedBaseRuns!.push(proof);
      if (full && !qualificationRun) {
        qualificationRun = run;
        document.ci.jobs = listing.jobs;
        document.ci.jobListingTotal = listing.totalCount;
        document.ci.selectionBasis =
          `run ${run.id} (${run.event}/${run.headBranch ?? '-'}) attempt ${run.attempt}: all ` +
          `${CI_RUN_INSTANCES.length} required job instances succeeded`;
      }
      if (
        requireMainPush &&
        isMainPush(run) &&
        qualificationRun?.id !== run.id &&
        !document.ci.mainPush
      ) {
        document.ci.mainPush = proof;
      }
      if (
        qualificationRun &&
        (!requireMainPush || isMainPush(qualificationRun) || document.ci.mainPush)
      )
        break;
    }
    if (qualificationRun) {
      document.ci.qualificationRunId = qualificationRun.id;
      if (requireMainPush) refusals.push(...mainPushFailures(document, qualificationRun));
      if (qualificationRun.attempt > 1) {
        notes.push(
          `qualification run ${qualificationRun.id} qualified on attempt ${qualificationRun.attempt}`,
        );
      }
    } else {
      const shapes = runs
        .filter((run) => run.headSha === sha)
        .map(
          (run) =>
            `${run.id} (${run.event}/${run.headBranch ?? '-'}) ${run.conclusion ?? run.status}`,
        );
      const rejected = document.ci.rejectedRuns
        .map((entry) => `${entry.id} (${entry.reason})`)
        .join('; ');
      refusals.push(
        shapes.length > 0
          ? `no ${EVIDENCE_WORKFLOW} run for ${sha} satisfies the qualification contract; runs seen: ${shapes.join(', ')}${rejected ? `; rejected: ${rejected}` : ''}`
          : `no ${EVIDENCE_WORKFLOW} run found for ${sha}; a cancelled or missing run is never qualification`,
      );
    }
  } catch (error) {
    const reason = skipReason(error);
    if (isSkip(error)) skips.push(`CI runs: ${reason}`);
    else refusals.push(`CI runs: ${reason}`);
  }

  // ── Artifacts of the qualification run (job instances were listed during
  //     selection; a missing listing there already refused or skipped) ───────
  if (qualificationRun) {
    // ── Artifacts ─────────────────────────────────────────────────────────
    try {
      const listing = await source.listArtifacts(qualificationRun.id);
      if (listing) {
        document.ci.artifacts = listing.artifacts;
        document.ci.artifactListingTotal = listing.totalCount;
      }
      refusals.push(...artifactListingFailures(document.ci, qualificationRun.id));
    } catch (error) {
      const reason = skipReason(error);
      if (isSkip(error)) skips.push(`CI artifacts: ${reason}`);
      else refusals.push(`CI artifacts: ${reason}`);
    }
  }

  // ── CodeQL (authoritative list for the merge ref) ───────────────────────
  const codeqlRef = pullRequest ? `refs/pull/${pullRequest}/merge` : 'refs/heads/main';
  document.codeql.ref = codeqlRef;
  document.codeql.queriedAt = now;
  try {
    const answer = await codeqlSource.listCodeqlAlerts(codeqlRef);
    if ('error' in answer) {
      document.codeql.error = answer.error;
      if (isOfflineFailure(answer.error)) skips.push(`CodeQL alerts: offline: ${answer.error}`);
      else refusals.push(`CodeQL alerts: ${answer.error}`);
    } else {
      if (answer.ref !== codeqlRef) {
        const reason = `CodeQL answer is for ${answer.ref}, not the requested ${codeqlRef}`;
        document.codeql.error = reason;
        refusals.push(reason);
      }
      document.codeql.alerts = answer.alerts;
      const open = answer.alerts.filter((alert) => alert.state === 'open');
      if (open.length > 0) {
        notes.push(
          `${open.length} open CodeQL alert(s) on ${codeqlRef}: ${open
            .map((alert) => `#${alert.number} (${alertSeverity(alert)}, ${alert.ruleId})`)
            .join(', ')} — a disposition for each is required (REL-02)`,
        );
      }
    }
  } catch (error) {
    const reason = skipReason(error);
    document.codeql.error = reason;
    if (isSkip(error)) skips.push(`CodeQL alerts: ${reason}`);
    else refusals.push(`CodeQL alerts: ${reason}`);
  }

  // ── npm dist-tags ───────────────────────────────────────────────────────
  document.registry.queriedAt = now;
  for (const packageName of packages) {
    try {
      const evidence = await source.npmDistTags(packageName);
      document.registry.packages.push(evidence);
      if (evidence.error) {
        if (isOfflineFailure(evidence.error)) {
          skips.push(`dist-tags ${packageName}: offline: ${evidence.error}`);
        } else {
          refusals.push(`dist-tags ${packageName}: ${evidence.error}`);
        }
      }
    } catch (error) {
      const reason = skipReason(error);
      if (isSkip(error)) skips.push(`dist-tags ${packageName}: ${reason}`);
      else refusals.push(`dist-tags ${packageName}: ${reason}`);
    }
  }

  // ── tag / Release ───────────────────────────────────────────────────────
  try {
    const tagSha = await source.getTagSha(tag);
    document.git.tag = { name: tag, sha: tagSha, exists: tagSha !== null };
    if (tagSha && tagSha !== sha) {
      refusals.push(`tag ${tag} points at ${tagSha}, not the candidate ${sha}`);
    }
  } catch (error) {
    const reason = skipReason(error);
    document.git.tag.error = reason;
    if (isSkip(error)) skips.push(`tag ${tag}: ${reason}`);
    else refusals.push(`tag ${tag}: ${reason}`);
  }
  try {
    const release = await source.getRelease(tag);
    document.git.release = release
      ? { tag, exists: true, createdAt: release.createdAt, htmlUrl: release.htmlUrl }
      : { tag, exists: false, createdAt: null, htmlUrl: null };
    if (release && !document.git.tag.exists) {
      notes.push(`GitHub Release ${tag} exists while the Git tag is absent — verify before citing`);
    }
  } catch (error) {
    const reason = skipReason(error);
    document.git.release.error = reason;
    if (isSkip(error)) skips.push(`Release ${tag}: ${reason}`);
    else refusals.push(`Release ${tag}: ${reason}`);
  }

  return {
    document,
    verdict: { qualified: refusals.length === 0 && skips.length === 0, refusals, skips, notes },
  };
}

/**
 * Re-evaluate an already collected document. This is what \`--check\` runs, so a
 * recorded evidence block can be refused offline when its own contents do not
 * satisfy the contract (a cancelled run cited as qualification, a job instance
 * that is not success, a SHA mismatch).
 */
export function evaluateDocument(
  document: EvidenceDocument,
  expectSha: string | null,
  requireMainPush = document.candidate.requireMainPush,
): EvidenceVerdict {
  const refusals: string[] = [];
  const skips: string[] = [];
  const notes: string[] = [];
  const { sha } = document.candidate;
  if (expectSha && sha !== expectSha) {
    refusals.push(`evidence is bound to ${sha}, not the expected candidate ${expectSha}`);
  }
  for (const candidate of document.ci.runs) {
    if (candidate.headSha !== sha) {
      refusals.push(`CI run ${candidate.id} is bound to ${candidate.headSha}, not ${sha}`);
    }
  }
  const qualification = document.ci.runs.find((r) => r.id === document.ci.qualificationRunId);
  if (!qualification) {
    refusals.push(
      `no qualification run recorded for ${sha}; a cancelled or missing run is never qualification`,
    );
  } else {
    if (qualification.headSha !== sha) {
      refusals.push(
        `qualification run ${qualification.id} is bound to ${qualification.headSha}, not ${sha}`,
      );
    }
    if (requireMainPush) refusals.push(...releaseSelectionFailures(document, qualification));
    if (qualification.conclusion !== 'success' || qualification.status !== 'completed') {
      refusals.push(
        `qualification run ${qualification.id} concluded ${qualification.conclusion ?? qualification.status}; a non-success run is never qualification`,
      );
    }
    if (qualification.attempt > 1) {
      notes.push(
        `qualification run ${qualification.id} qualified on attempt ${qualification.attempt}`,
      );
    }
    if (document.ci.jobListingTotal === null || document.ci.jobs.length === 0) {
      refusals.push(`job instances of qualification run ${qualification.id} are not recorded`);
    } else {
      for (const failure of contractFailures(document.ci.jobs, document.ci.jobListingTotal)) {
        refusals.push(`run ${qualification.id}: ${failure}`);
      }
    }
    refusals.push(...artifactListingFailures(document.ci, qualification.id));
    if (requireMainPush) refusals.push(...mainPushFailures(document, qualification));
  }
  if (document.codeql.error) {
    if (isSkip(document.codeql.error)) skips.push(`CodeQL alerts: ${document.codeql.error}`);
    else refusals.push(`CodeQL alerts: ${document.codeql.error}`);
  } else if (document.codeql.alerts.length === 0 && document.codeql.queriedAt === null) {
    skips.push('CodeQL alerts: not queried');
  } else {
    const wrongRef = document.codeql.alerts.filter(
      (alert) => alert.ref && alert.ref !== document.codeql.ref,
    );
    if (wrongRef.length > 0) {
      refusals.push(`${wrongRef.length} CodeQL alert(s) are not on ${document.codeql.ref}`);
    }
    const open = document.codeql.alerts.filter((alert) => alert.state === 'open');
    if (open.length > 0) {
      notes.push(
        `${open.length} open CodeQL alert(s) on ${document.codeql.ref}: ${open
          .map((alert) => `#${alert.number} (${alert.severity}, ${alert.ruleId})`)
          .join(', ')} — a disposition for each is required (REL-02)`,
      );
    }
  }
  if (document.registry.packages.length !== document.candidate.packages.length) {
    refusals.push(
      `dist-tags recorded for ${document.registry.packages.length}/${document.candidate.packages.length} package(s)`,
    );
  }
  for (const pkg of document.registry.packages) {
    if (pkg.error) {
      if (isOfflineFailure(pkg.error)) skips.push(`dist-tags ${pkg.name}: offline`);
      else refusals.push(`dist-tags ${pkg.name}: ${pkg.error}`);
    }
  }
  if (document.git.tag.error) {
    const findings = isSkip(document.git.tag.error) ? skips : refusals;
    findings.push(`tag ${document.git.tag.name}: ${document.git.tag.error}`);
  } else if (document.git.tag.exists) {
    if (document.git.tag.sha !== sha) {
      refusals.push(`tag ${document.git.tag.name} points at ${document.git.tag.sha}, not ${sha}`);
    }
  } else {
    notes.push(
      `tag ${document.git.tag.name}: absent (expected before the owner's publish approval)`,
    );
  }
  if (document.git.release.error) {
    const findings = isSkip(document.git.release.error) ? skips : refusals;
    findings.push(`Release ${document.git.release.tag}: ${document.git.release.error}`);
  } else if (!document.git.release.exists) {
    notes.push(
      `GitHub Release ${document.git.release.tag}: absent (expected before the owner's publish approval)`,
    );
  }
  return { qualified: refusals.length === 0 && skips.length === 0, refusals, skips, notes };
}

function formatTimestamp(value: string): string {
  return value.replace('T', ' ').replace('Z', ' UTC');
}

/** Render the PR/release checklist snippet. No numbers are authored here. */
export function renderChecklist(document: EvidenceDocument, verdict: EvidenceVerdict): string {
  const { candidate } = document;
  const lines: string[] = [];
  lines.push(`## Release evidence — \`${candidate.sha}\``);
  lines.push('');
  lines.push(
    `Generated by \`tools/release/evidence-bind.ts\` at ${formatTimestamp(document.collectedAt)} from ${document.ci.origin}.`,
  );
  lines.push('');
  lines.push(`- Repository: \`${candidate.repository}\`; workflow \`${candidate.workflow}\`.`);
  lines.push(
    candidate.pullRequest
      ? `- Pull request: #${candidate.pullRequest} (CodeQL ref \`${document.codeql.ref}\`).`
      : `- CodeQL ref: \`${document.codeql.ref}\`.`,
  );
  lines.push('');

  const qualification = document.ci.runs.find((r) => r.id === document.ci.qualificationRunId);
  lines.push('### Qualification CI (never a cancelled or failed run)');
  if (qualification) {
    lines.push(
      `- Run [${qualification.id}](${qualification.htmlUrl}) attempt ${qualification.attempt} — \`${qualification.conclusion}\` — ${qualification.event}/${qualification.headBranch ?? '-'} — head_sha \`${qualification.headSha}\` — ${formatTimestamp(qualification.createdAt)}.`,
    );
    if (document.ci.selectionBasis) {
      lines.push(`- Selection basis: ${document.ci.selectionBasis}.`);
    }
    if (document.ci.rejectedRuns.length > 0) {
      lines.push(
        `- Successful runs rejected by the contract: ${document.ci.rejectedRuns
          .map((entry) => `${entry.id} (${entry.reason})`)
          .join('; ')}.`,
      );
    }
    const byJob = CI_QUALIFICATION_JOBS.map((required) => {
      const instances = document.ci.jobs.filter((job) => jobBaseId(job.name) === required.id);
      const label = instances
        .map(
          (instance) =>
            `${instance.instance ?? 'default'}: ${instance.conclusion ?? instance.status}`,
        )
        .join(', ');
      return `  - \`${required.id}\` (${instances.length}/${required.instances.length}) — ${label || 'missing'}`;
    });
    const guard = document.ci.jobs.find((job) => job.name === CI_GUARD_JOB);
    lines.push(`- Required job instances (${document.ci.jobs.length} listed):`);
    lines.push(
      `  - \`${CI_GUARD_JOB}\` (binding guard) — ${guard?.conclusion ?? guard?.status ?? 'missing'}`,
    );
    lines.push(...byJob);
  } else {
    lines.push('- **none recorded** — this candidate has no successful Full qualification run.');
  }
  const mainPush = document.ci.runs.find((r) => r.id === document.ci.mainPush?.runId);
  if (mainPush && mainPush.id !== qualification?.id) {
    lines.push(
      `- Main push [${mainPush.id}](${mainPush.htmlUrl}) attempt ${mainPush.attempt} — \`${mainPush.conclusion}\` — head_sha \`${mainPush.headSha}\`.`,
    );
  }
  const history = document.ci.runs.filter(
    (r) => r.id !== document.ci.qualificationRunId && r.id !== mainPush?.id,
  );
  if (history.length > 0) {
    lines.push('');
    lines.push(
      `History (NOT qualification): ${history
        .map(
          (r) =>
            `[${r.id}](${r.htmlUrl}) ${r.event}/${r.headBranch ?? '-'} attempt ${r.attempt} \`${r.conclusion ?? r.status}\``,
        )
        .join('; ')}`,
    );
  }
  lines.push('');
  lines.push('### Run artifacts');
  if (document.ci.artifacts.length > 0) {
    for (const artifact of document.ci.artifacts) {
      lines.push(
        `- \`${artifact.name}\` — ${artifact.sizeInBytes} B — expired: ${artifact.expired} — ${formatTimestamp(artifact.createdAt)}`,
      );
    }
  } else {
    lines.push(`- none (listing total: ${document.ci.artifactListingTotal ?? 'not queried'}).`);
  }
  lines.push('');
  lines.push(`### CodeQL on \`${document.codeql.ref}\``);
  if (document.codeql.error) {
    lines.push(`- SKIP — ${document.codeql.error}`);
  } else if (document.codeql.alerts.length === 0) {
    lines.push('- 0 alerts returned by the authoritative list.');
  } else {
    for (const alert of document.codeql.alerts) {
      lines.push(
        `- #${alert.number} — \`${alert.state}\` — ${alertSeverity(alert)} — \`${alert.ruleId}\` — ${alert.tool} — updated ${formatTimestamp(alert.updatedAt)} — ${alert.htmlUrl}`,
      );
    }
  }
  lines.push('');
  lines.push('### npm dist-tags');
  for (const pkg of document.registry.packages) {
    if (pkg.error) {
      lines.push(`- \`${pkg.name}\` — SKIP/REFUSED — ${pkg.error}`);
      continue;
    }
    const tags = Object.entries(pkg.distTags)
      .map(([tag, version]) => `\`${tag}\`=${version}`)
      .join(', ');
    lines.push(`- \`${pkg.name}\` — ${tags || 'no dist-tags returned'}`);
  }
  lines.push('');
  lines.push('### Tag and GitHub Release');
  lines.push(
    document.git.tag.exists
      ? `- tag \`${document.git.tag.name}\` — exists at \`${document.git.tag.sha}\`.`
      : `- tag \`${document.git.tag.name}\` — absent.`,
  );
  lines.push(
    document.git.release.exists
      ? `- GitHub Release \`${document.git.release.tag}\` — exists (${formatTimestamp(document.git.release.createdAt ?? '')}) — ${document.git.release.htmlUrl}.`
      : `- GitHub Release \`${document.git.release.tag}\` — absent.`,
  );
  lines.push('');
  lines.push('### Verdict');
  lines.push(
    verdict.qualified
      ? '- **QUALIFIED** — every dimension was queried and every rule passed. Owner-gated actions (tag, publish, Release) remain explicit approvals.'
      : '- **NOT QUALIFIED** — do not cite this candidate as release-qualified.',
  );
  for (const refusal of verdict.refusals) lines.push(`  - REFUSAL: ${refusal}`);
  for (const skip of verdict.skips) lines.push(`  - SKIP (not evidence of passing): ${skip}`);
  for (const note of verdict.notes) lines.push(`  - NOTE: ${note}`);
  return `${lines.join('\n')}\n`;
}

/** Resolve the candidate version from the tracked release record. */
export async function resolveCandidateVersion(repoRoot: string): Promise<string> {
  const raw = await readFile(join(repoRoot, 'docs/release/release-state.json'), 'utf8');
  const parsed = JSON.parse(raw) as { sourceVersion?: string };
  if (!parsed.sourceVersion) throw new Error('release-state.json carries no sourceVersion');
  return parsed.sourceVersion;
}

interface CliOptions {
  sha: string | null;
  repository: string | null;
  codeqlRepository: string | null;
  requireMainPush: boolean;
  pullRequest: number | null;
  tag: string | null;
  packages: readonly string[];
  fixtures: string | null;
  check: string | null;
  json: boolean;
  out: string | null;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    sha: null,
    repository: null,
    codeqlRepository: null,
    requireMainPush: false,
    pullRequest: null,
    tag: null,
    packages: RELEASE_PACKAGES,
    fixtures: null,
    check: null,
    json: false,
    out: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    switch (arg) {
      case '--sha':
        options.sha = value();
        break;
      case '--repo':
        options.repository = value();
        break;
      case '--codeql-repo':
        options.codeqlRepository = value();
        break;
      case '--require-main-push':
        options.requireMainPush = true;
        break;
      case '--pr':
        options.pullRequest = Number(value());
        break;
      case '--tag':
        options.tag = value();
        break;
      case '--packages':
        options.packages = value()
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
        break;
      case '--fixtures':
        options.fixtures = value();
        break;
      case '--check':
        options.check = value();
        break;
      case '--out':
        options.out = value();
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const USAGE = `usage: node tools/release/evidence-bind.ts --sha <sha> [--pr <n>] [--repo owner/name]
       [--codeql-repo owner/name] [--tag v<version>] [--require-main-push]
       [--fixtures <file> | --check <file>] [--json] [--out <file>]

Collects the exact-SHA release evidence (CI runs/job instances/artifacts, CodeQL
alerts for the merge ref, npm dist-tags, tag/Release presence) and prints the
PR/release checklist snippet. Refuses (exit 1) on a SHA mismatch, a cancelled or
failed run cited as qualification, a missing/non-success required job instance, or
an unqueried dimension. Full qualification requires every job instance, including
sha-guard, to succeed. --require-main-push demands a same-SHA Full dispatch and a
successful Base or Full main push, or a historical Full main push. --fixtures
evaluates recorded API answers offline; --check re-evaluates an evidence document
written by a previous run. --out writes the same format as stdout (Markdown or
--json). --repo is the repository whose runs/tag/Release are
read (a fork for an unmerged candidate); --codeql-repo is the repository whose
PR merge ref carries the alerts (the base repository).`;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (options.check) {
    const document = parseEvidenceDocument(await readFile(options.check, 'utf8'));
    const verdict = evaluateDocument(
      document,
      options.sha,
      options.requireMainPush || document.candidate.requireMainPush,
    );
    await emitEvidence(document, verdict, options);
    return;
  }

  const sha = options.sha ?? (await gitHead());
  const repository = options.repository ?? (await defaultRepository());
  const tag = options.tag ?? `v${await resolveCandidateVersion(repoRoot)}`;
  const fixtures = options.fixtures
    ? (JSON.parse(await readFile(options.fixtures, 'utf8')) as EvidenceFixtures)
    : null;
  const source = fixtures
    ? createFixtureSource(fixtures, `fixtures ${options.fixtures}`)
    : createGhSource(repository);
  const codeqlSource =
    !fixtures && options.codeqlRepository && options.codeqlRepository !== repository
      ? createGhSource(options.codeqlRepository)
      : source;
  const { document, verdict } = await collectEvidence({
    source,
    codeqlSource,
    requireMainPush: options.requireMainPush,
    sha,
    repository,
    pullRequest: options.pullRequest,
    tag,
    packages: options.packages,
    now: new Date().toISOString(),
  });
  await emitEvidence(document, verdict, options);
}

async function emitEvidence(
  document: EvidenceDocument,
  verdict: EvidenceVerdict,
  options: Pick<CliOptions, 'json' | 'out'>,
): Promise<void> {
  const output = options.json
    ? `${JSON.stringify({ document, verdict }, null, 2)}\n`
    : renderChecklist(document, verdict);
  if (options.out) {
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, output, 'utf8');
  }
  process.stdout.write(output);
  if (!verdict.qualified) process.exitCode = 1;
}

async function gitHead(): Promise<string> {
  const result = await run('git', ['rev-parse', 'HEAD']);
  if (result.code !== 0) throw new Error(`git rev-parse HEAD failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function defaultRepository(): Promise<string> {
  const result = await run('gh', [
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ]);
  if (result.code !== 0) throw new Error(`gh repo view failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export { USAGE };

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`evidence-bind: ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE);
    process.exit(2);
  }
}
