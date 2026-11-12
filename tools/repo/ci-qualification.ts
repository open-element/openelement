/**
 * The one qualification definition shared by the release workflow and the
 * explicit-release-intent harness.
 *
 * `autoflow-ci.yml` is the source of truth for what "full qualification" means:
 * ten logical jobs (the `sha-guard` binding job plus nine qualification job
 * IDs) that expand to thirteen GitHub job instances. The release workflow must
 * verify the exact identity of those instances — an expected instance missing,
 * a duplicated instance, an unexpected instance, or a non-success conclusion is
 * a refusal — and the harness must generate its negative matrix from the same
 * definition. Keeping a second hand-written job list in either place is how the
 * two drift apart.
 *
 * The same definition also owns the Base CI shape, which is NOT a Full run with
 * its heavy legs skipped. The four base jobs (lint, test, e2e, pack) run and
 * succeed; the five heavy jobs are skipped by their job-level `if:` and GitHub
 * reports each ONCE by its bare job ID without expanding its matrix. A real
 * Base run therefore lists ten instances (five success + five skipped:
 * `e2e-full`, `bfcache`, `node-serve-smoke`, `packed-consumer-matrix`,
 * `fresh-install`), not thirteen. The release path may skip that exact shape as
 * non-evidence; every other listing is malformed and is refused.
 *
 * The literal instance names below are the default GitHub job names for the
 * workflow's jobs and matrix legs (`<job id> (<matrix value>)`). A test and the
 * harness re-derive them from `autoflow-ci.yml`'s `jobs` block and fail when the
 * workflow adds/removes a job, changes a matrix, or introduces a custom `name:`
 * this definition cannot express. That keeps the literal a checked projection
 * of the workflow, not a second source of truth.
 *
 * Why not parse YAML here: the release `ci-evidence` job runs this file with
 * plain Node before any dependency install, so the module deliberately imports
 * only Node built-ins. Parsing the workflow at gate time belongs to the tools
 * tests (which have the `yaml` dependency) and to the harness scenario.
 *
 * CLI:
 *   node tools/repo/ci-qualification.ts --json       # machine contract
 *   node tools/repo/ci-qualification.ts --names      # one instance per line
 *   node tools/repo/ci-qualification.ts --help
 */

/**
 * Which CI tier a qualification job belongs to. The lane is also what makes a
 * Base run's job listing a different shape from a Full run's: a heavy job that
 * is skipped by its job-level `if:` is listed ONCE by its bare job ID and its
 * matrix never expands.
 */
export type CiQualificationLane = 'base' | 'heavy';

export interface CiQualificationJob {
  /** The job ID in autoflow-ci.yml. */
  readonly id: string;
  /** Base jobs run on every push/PR; heavy jobs run only in a full dispatch. */
  readonly lane: CiQualificationLane;
  /** Every GitHub job-instance name that job expands to, in matrix order. */
  readonly instances: readonly string[];
}

/**
 * The run-binding guard. It is not one of the nine qualification job IDs, but
 * its conclusion is still part of the evidence contract (every qualification
 * job needs it, and CI's header counts it among the thirteen instances).
 */
export const CI_GUARD_JOB = 'sha-guard';

/** The nine qualification job IDs and their twelve matrix instances. */
export const CI_QUALIFICATION_JOBS: readonly CiQualificationJob[] = [
  { id: 'lint', lane: 'base', instances: ['lint'] },
  { id: 'test', lane: 'base', instances: ['test'] },
  { id: 'e2e', lane: 'base', instances: ['e2e'] },
  { id: 'pack', lane: 'base', instances: ['pack'] },
  {
    id: 'e2e-full',
    lane: 'heavy',
    instances: ['e2e-full (site-e2e)', 'e2e-full (fixture-gates)'],
  },
  { id: 'bfcache', lane: 'heavy', instances: ['bfcache'] },
  {
    id: 'node-serve-smoke',
    lane: 'heavy',
    instances: ['node-serve-smoke (24)', 'node-serve-smoke (26)'],
  },
  {
    id: 'packed-consumer-matrix',
    lane: 'heavy',
    instances: ['packed-consumer-matrix (ubuntu-24.04)', 'packed-consumer-matrix (macos-latest)'],
  },
  { id: 'fresh-install', lane: 'heavy', instances: ['fresh-install'] },
];

/** The twelve qualification instances, without the guard. */
export const CI_QUALIFICATION_INSTANCES: readonly string[] = CI_QUALIFICATION_JOBS.flatMap(
  (job) => job.instances,
);

/** The four base qualification jobs (lint, test, e2e, pack). */
export const CI_BASE_QUALIFICATION_JOBS: readonly CiQualificationJob[] =
  CI_QUALIFICATION_JOBS.filter((job) => job.lane === 'base');

/** The five heavy qualification jobs (dispatch-only since W4b). */
export const CI_HEAVY_QUALIFICATION_JOBS: readonly CiQualificationJob[] =
  CI_QUALIFICATION_JOBS.filter((job) => job.lane === 'heavy');

/** The base qualification job IDs. */
export const CI_BASE_JOB_IDS: readonly string[] = CI_BASE_QUALIFICATION_JOBS.map((job) => job.id);

/** The heavy qualification job IDs. */
export const CI_HEAVY_JOB_IDS: readonly string[] = CI_HEAVY_QUALIFICATION_JOBS.map((job) => job.id);

/**
 * The instances a Base run lists with a `success` conclusion: the guard plus
 * the four base job instances. The heavy jobs do not appear in this shape.
 */
export const CI_BASE_SUCCESS_INSTANCES: readonly string[] = [
  CI_GUARD_JOB,
  ...CI_BASE_QUALIFICATION_JOBS.flatMap((job) => job.instances),
];

/**
 * The instances a Base run lists with a `skipped` conclusion. A job skipped by
 * its job-level `if:` is reported ONCE by its bare job ID: GitHub never expands
 * the matrix of a job that did not run. These are the five heavy job IDs — not
 * their eight matrix legs. A real Base run therefore lists TEN job instances
 * (five success + five skipped), not the thirteen of a Full run with eight
 * expanded legs marked skipped.
 */
export const CI_BASE_SKIPPED_INSTANCES: readonly string[] = CI_HEAVY_JOB_IDS;

/** Every instance name a real Base run lists: five success + five skipped. */
export const CI_BASE_RUN_INSTANCES: readonly string[] = [
  ...CI_BASE_SUCCESS_INSTANCES,
  ...CI_BASE_SKIPPED_INSTANCES,
];

/** A Base run lists ten instances; a Full run lists thirteen. */
export const CI_BASE_TOTAL_RUN_INSTANCES = CI_BASE_RUN_INSTANCES.length;

export interface CiBaseListingEntry {
  readonly name: string;
  readonly conclusion: 'success' | 'skipped';
}

/**
 * The exact jobs listing a legal Base run returns. The release workflow skips a
 * candidate only when the listing equals this shape; any other listing — a
 * missing, duplicated or unexpected job, a base job skipped, a heavy job named
 * by a matrix leg — is malformed and must be refused, never skipped.
 */
export const CI_BASE_LISTING: readonly CiBaseListingEntry[] = [
  ...CI_BASE_SUCCESS_INSTANCES.map((name) => ({ name, conclusion: 'success' as const })),
  ...CI_BASE_SKIPPED_INSTANCES.map((name) => ({ name, conclusion: 'skipped' as const })),
];

/**
 * The thirteen instances whose conclusions the release evidence requires: the
 * guard plus the twelve qualification instances. `sha-guard` is first because
 * it is the job every qualification instance depends on.
 */
export const CI_RUN_INSTANCES: readonly string[] = [CI_GUARD_JOB, ...CI_QUALIFICATION_INSTANCES];

export const CI_TOTAL_RUN_INSTANCES = CI_RUN_INSTANCES.length;

export interface CiQualificationContract {
  guard: string;
  qualificationJobs: readonly CiQualificationJob[];
  qualificationInstances: readonly string[];
  /** Every required instance (guard included), in contract order. */
  instances: readonly string[];
  totalInstances: number;
  /**
   * The distinct Base CI listing. It is derived from the same job/lane
   * classification, never from a hand-written parallel list: the guard + four
   * base instances success, the five heavy job IDs skipped (matrix unexpanded).
   */
  base: {
    jobIds: readonly string[];
    heavyJobIds: readonly string[];
    successInstances: readonly string[];
    skippedInstances: readonly string[];
    runInstances: readonly string[];
    listing: readonly CiBaseListingEntry[];
    totalInstances: number;
  };
}

/** The machine-readable contract the release workflow consumes. */
export const CI_QUALIFICATION_CONTRACT: CiQualificationContract = {
  guard: CI_GUARD_JOB,
  qualificationJobs: CI_QUALIFICATION_JOBS,
  qualificationInstances: CI_QUALIFICATION_INSTANCES,
  instances: CI_RUN_INSTANCES,
  totalInstances: CI_TOTAL_RUN_INSTANCES,
  base: {
    jobIds: CI_BASE_JOB_IDS,
    heavyJobIds: CI_HEAVY_JOB_IDS,
    successInstances: CI_BASE_SUCCESS_INSTANCES,
    skippedInstances: CI_BASE_SKIPPED_INSTANCES,
    runInstances: CI_BASE_RUN_INSTANCES,
    listing: CI_BASE_LISTING,
    totalInstances: CI_BASE_TOTAL_RUN_INSTANCES,
  },
};

/** The subset of a parsed workflow job this derivation reads. */
export interface WorkflowJobShape {
  name?: unknown;
  strategy?: unknown;
  uses?: unknown;
}

/** Values GitHub substitutes into the default matrix job name. */
type MatrixValue = string | number | boolean;

function matrixValues(value: unknown, jobId: string, problems: string[]): MatrixValue[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push(`${jobId}: matrix value is not a non-empty literal array`);
    return null;
  }
  for (const entry of value) {
    if (typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean') {
      problems.push(`${jobId}: matrix value ${JSON.stringify(entry)} is not a literal`);
      return null;
    }
  }
  return value as MatrixValue[];
}

/**
 * Derive the default GitHub job-instance names from a parsed workflow `jobs`
 * block. Only the forms `autoflow-ci.yml` uses are accepted (no custom `name:`,
 * no matrix `include`/`exclude`, literal arrays); anything else is a finding so
 * the checked projection fails closed instead of silently missing a leg.
 */
export function deriveRunInstanceNames(jobs: Record<string, WorkflowJobShape>): {
  instances: string[];
  problems: string[];
} {
  const instances: string[] = [];
  const problems: string[] = [];
  for (const [jobId, job] of Object.entries(jobs)) {
    if (job.name !== undefined) {
      problems.push(`${jobId}: custom job name '${String(job.name)}' cannot be derived`);
      continue;
    }
    const strategy = job.strategy as { matrix?: unknown } | undefined;
    if (strategy?.matrix === undefined) {
      instances.push(jobId);
      continue;
    }
    if (typeof strategy.matrix !== 'object' || strategy.matrix === null) {
      problems.push(`${jobId}: strategy.matrix is not a mapping`);
      continue;
    }
    const dimensions = Object.entries(strategy.matrix as Record<string, unknown>);
    if (dimensions.length !== 1) {
      problems.push(
        `${jobId}: matrix has ${dimensions.length} dimensions; this derivation supports exactly one`,
      );
      continue;
    }
    const [dimension, rawValues] = dimensions[0]!;
    if (dimension === 'include' || dimension === 'exclude') {
      problems.push(`${jobId}: matrix '${dimension}' entries are not supported`);
      continue;
    }
    const values = matrixValues(rawValues, jobId, problems);
    if (values === null) continue;
    for (const value of values) instances.push(`${jobId} (${String(value)})`);
  }
  return { instances, problems };
}

function printHelp(): void {
  process.stdout.write(
    'usage: node tools/repo/ci-qualification.ts [--json|--names|--help]\n\n' +
      'The shared qualification definition (autoflow-ci.yml): ten logical jobs /\n' +
      'thirteen instances — sha-guard plus nine qualification job IDs / twelve\n' +
      'qualification instances. Base CI lists ten instances: guard + four base\n' +
      'jobs success, five heavy job IDs skipped (matrix unexpanded).\n',
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    printHelp();
    return;
  }
  const unknown = argv.filter((arg) => arg !== '--json' && arg !== '--names');
  if (unknown.length > 0) {
    console.error(`ci-qualification: unknown argument(s): ${unknown.join(', ')}`);
    process.exit(2);
  }
  if (argv.includes('--names')) {
    for (const name of CI_RUN_INSTANCES) process.stdout.write(`${name}\n`);
    return;
  }
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(CI_QUALIFICATION_CONTRACT, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `qualification contract: ${CI_TOTAL_RUN_INSTANCES} instances ` +
      `(${CI_GUARD_JOB} + ${CI_QUALIFICATION_JOBS.length} qualification job IDs / ` +
      `${CI_QUALIFICATION_INSTANCES.length} instances)\n`,
  );
  for (const name of CI_RUN_INSTANCES) process.stdout.write(`- ${name}\n`);
  process.stdout.write(
    `base listing: ${CI_BASE_TOTAL_RUN_INSTANCES} instances (${CI_BASE_SUCCESS_INSTANCES.length} ` +
      `success + ${CI_BASE_SKIPPED_INSTANCES.length} skipped heavy job IDs; matrix unexpanded)\n`,
  );
  for (const entry of CI_BASE_LISTING) {
    process.stdout.write(`- ${entry.name} (${entry.conclusion})\n`);
  }
}

if (import.meta.main) main();
