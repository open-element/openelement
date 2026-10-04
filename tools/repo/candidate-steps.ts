/**
 * Canonical candidate job/step contract (schema v4 — the vp task-dispatch
 * surface; v3 was the direct pnpm invocation surface, v2 the Deno task
 * graph). A v3 or older record names a different execution contract, so the
 * version bump makes legacy evidence fail validation instead of passing as
 * equivalent.
 *
 * One source of truth for what each candidate job must run and from which
 * directory. The producers (candidate-evidence-record.ts for the workspace
 * lanes, candidate-evidence-fresh-clone.ts for the fresh-clone lane) emit
 * these argv values and the validator matches received evidence against the
 * same contracts, so a
 * step name can never be paired with a different command, and a fresh-clone
 * step can never claim a directory it did not run in.
 *
 * Every gate/generator task dispatches through vp (tools/repo/vp-dispatch.ts
 * builds the argv, so producer and validator cannot drift). Matching
 * normalizes exactly two operationally irrelevant details:
 *   - an absolute executable path whose basename is `node`, `vp`, or `git`;
 *   - absolute workspace/clone/temp paths, which are recorded under the shared
 *     roles `$SOURCE`, `$CLONE`, and `$TEMP` via one mapping.
 * Every other argv element, flag, task name, cwd, and argument position is
 * compared byte-for-byte.
 */

import { vpTaskArgv } from './vp-dispatch.ts';

export const CANDIDATE_EVIDENCE_SCHEMA_VERSION = 4;

export type JobName = 'fast-checks' | 'source-matrix' | 'packed' | 'fresh-clone';

export const JOB_NAMES: readonly JobName[] = [
  'fast-checks',
  'source-matrix',
  'packed',
  'fresh-clone',
];

/** Shared path roles; the producer maps real absolute paths onto these. */
export const EVIDENCE_ROLES = {
  source: '$SOURCE',
  clone: '$CLONE',
  temp: '$TEMP',
} as const;

export type EvidenceRole = (typeof EVIDENCE_ROLES)[keyof typeof EVIDENCE_ROLES];

/** Ordered [absolutePrefix, role] pairs; longest prefix wins. */
export type PathRoleMapping = ReadonlyArray<readonly [string, string]>;

function hasBoundary(value: string, prefix: string): boolean {
  return value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}\\`);
}

/** Replace one shared role prefix with its real absolute path (inverse of
 * normalizeEvidencePath). */
export function materializeEvidencePath(path: string, mapping: PathRoleMapping): string {
  for (const [real, role] of mapping) {
    if (path === role) return real;
    if (path.startsWith(`${role}/`)) return `${real}${path.slice(role.length)}`;
  }
  return path;
}

/** Replace one absolute path prefix with its shared role. */
export function normalizeEvidencePath(path: string, mapping: PathRoleMapping): string {
  let best: readonly [string, string] | undefined;
  for (const entry of mapping) {
    if (hasBoundary(path, entry[0]) && (!best || entry[0].length > best[0].length)) {
      best = entry;
    }
  }
  if (!best) return path;
  return `${best[1]}${path.slice(best[0].length).replaceAll('\\', '/')}`;
}

export interface StepMatchContext {
  sha: string;
  tree: string;
}

export interface StepContract {
  name: string;
  /** The role of the directory the step must execute in. */
  cwd: EvidenceRole;
  /** Returns a failure description, or null when argv matches exactly. */
  match: (argv: readonly string[], context: StepMatchContext) => string | null;
}

/** Normalize an absolute node/vp/git executable path to its pinned basename. */
export function normalizeArgv(argv: readonly string[]): string[] {
  if (argv.length === 0) return [];
  const basename = argv[0].split('/').pop() ?? argv[0];
  const executable = ['node', 'vp', 'git'].includes(basename) ? basename : argv[0];
  return [executable, ...argv.slice(1)];
}

/** Context-free argv matcher; callers that need the context wrap it. */
type ArgvMatcher = (argv: readonly string[]) => string | null;

function exact(expected: readonly string[]): ArgvMatcher {
  return (argv) => {
    const normalized = normalizeArgv(argv);
    if (normalized.length !== expected.length) {
      return (
        `expected argv ${JSON.stringify(expected)} (${expected.length} elements), ` +
        `got ${JSON.stringify(argv)}`
      );
    }
    for (let index = 0; index < expected.length; index++) {
      if (normalized[index] !== expected[index]) {
        return (
          `argv[${index}] must be ${JSON.stringify(expected[index])}, ` +
          `got ${JSON.stringify(normalized[index])}`
        );
      }
    }
    return null;
  };
}

/** `clean-proof.ts` invocation that binds a job to a clean exact SHA/tree. */
export function cleanProofArgv(sha: string, tree: string, phase: 'before' | 'after'): string[] {
  return ['node', 'tools/repo/clean-proof.ts', '--sha', sha, '--tree', tree, '--phase', phase];
}

/** Canonical line a clean-proof log must contain for that phase. */
export function cleanProofLine(sha: string, tree: string, phase: 'before' | 'after'): string {
  return `clean-proof PASS phase=${phase} sha=${sha} tree=${tree}`;
}

function cleanProof(phase: 'before' | 'after', cwd: EvidenceRole): StepContract {
  return {
    name: `workspace-clean-${phase}`,
    cwd,
    match: (argv, context) => {
      const expected = cleanProofArgv(context.sha, context.tree, phase);
      return exact(expected)(argv);
    },
  };
}

/**
 * Static job commands: every workspace lane runs its steps through the vp
 * dispatch (package-qualified, fail-closed, no cache). `pnpm` appears only
 * where pnpm is the tool under test — the fresh-clone `install`, which proves
 * the workspace installs with one frozen lockfile.
 */
export const STATIC_JOB_STEPS: Record<
  Exclude<JobName, 'fresh-clone'>,
  readonly { name: string; command: readonly string[] }[]
> = {
  'fast-checks': [
    { name: 'fmt-check', command: vpTaskArgv('openelement', 'fmt:check') },
    { name: 'lint', command: vpTaskArgv('openelement', 'lint') },
    { name: 'markdown', command: vpTaskArgv('@openelement/tools-repo', 'lint:markdown') },
    { name: 'typecheck', command: vpTaskArgv('openelement', 'typecheck') },
  ],
  'source-matrix': [
    { name: 'gate-source', command: vpTaskArgv('@openelement/tools-repo', 'gate:source') },
  ],
  packed: [
    {
      name: 'gate-packed',
      command: vpTaskArgv('@openelement/tools-release', 'gate:packed'),
    },
    {
      name: 'publish-npm-dry-run',
      command: vpTaskArgv('@openelement/tools-release', 'publish:npm:dry-run'),
    },
  ],
};

/**
 * Fresh-clone argv builders using shared roles; the producer maps paths. The
 * clone's own installed vp shim (`$CLONE/node_modules/.bin/vp`, materialized
 * at spawn time) dispatches its tasks, so the recorded executable normalizes
 * to `vp` exactly like the workspace lanes.
 */
export const freshCloneCommands = {
  clone: (): string[] => [
    'git',
    'clone',
    '--no-hardlinks',
    EVIDENCE_ROLES.source,
    EVIDENCE_ROLES.clone,
  ],
  checkout: (sha: string): string[] => ['git', '-C', EVIDENCE_ROLES.clone, 'checkout', sha],
  install: (): string[] => ['pnpm', 'install', '--frozen-lockfile'],
  check: (): string[] => cloneVpTask('openelement', 'check'),
  gateSource: (): string[] => cloneVpTask('@openelement/tools-repo', 'gate:source'),
  gatePacked: (): string[] => cloneVpTask('@openelement/tools-release', 'gate:packed'),
  siteBuild: (): string[] => cloneVpTask('openelement', 'site:build'),
  siteE2e: (): string[] => cloneVpTask('@openelement/www', 'e2e:browsers'),
} as const;

/** The clone's installed vp shim dispatched against one of its tasks. */
function cloneVpTask(pkg: string, task: string): string[] {
  return [`${EVIDENCE_ROLES.clone}/node_modules/.bin/vp`, ...vpTaskArgv(pkg, task).slice(1)];
}

export const FRESH_CLONE_STEPS: readonly StepContract[] = [
  {
    name: 'clone',
    cwd: EVIDENCE_ROLES.temp,
    match: (argv) =>
      exact(['git', 'clone', '--no-hardlinks', EVIDENCE_ROLES.source, EVIDENCE_ROLES.clone])(argv),
  },
  {
    name: 'git-checkout',
    cwd: EVIDENCE_ROLES.temp,
    match: (argv, context) => {
      const normalized = normalizeArgv(argv);
      if (
        normalized.length !== 5 ||
        normalized[0] !== 'git' ||
        normalized[1] !== '-C' ||
        normalized[3] !== 'checkout'
      ) {
        return `expected 'git -C ${EVIDENCE_ROLES.clone} checkout <sha>', got ${JSON.stringify(
          argv,
        )}`;
      }
      if (normalized[2] !== EVIDENCE_ROLES.clone) {
        return `git-checkout must run against ${EVIDENCE_ROLES.clone}, got ${JSON.stringify(
          normalized[2],
        )}`;
      }
      if (normalized[4] !== context.sha) {
        return `git-checkout target ${normalized[4]} != evidence sha ${context.sha}`;
      }
      return null;
    },
  },
  cleanProof('before', EVIDENCE_ROLES.clone),
  {
    name: 'install',
    cwd: EVIDENCE_ROLES.clone,
    match: exact(['pnpm', 'install', '--frozen-lockfile']),
  },
  // The task contracts are the freshCloneCommands builders themselves
  // (normalized to the recorded executable basename), so a dispatch change
  // cannot update one side and leave the other behind.
  {
    name: 'task-check',
    cwd: EVIDENCE_ROLES.clone,
    match: exact(normalizeArgv(freshCloneCommands.check())),
  },
  {
    name: 'task-gate-source',
    cwd: EVIDENCE_ROLES.clone,
    match: exact(normalizeArgv(freshCloneCommands.gateSource())),
  },
  {
    // The fresh clone proves the source gate and, separately, the packed gate
    // with cold pnpm/npm caches. Source must not nest packed qualification.
    // The release train still belongs to release:check.
    name: 'task-gate-packed',
    cwd: EVIDENCE_ROLES.clone,
    match: exact(normalizeArgv(freshCloneCommands.gatePacked())),
  },
  // Site E2E owns the candidate's Site proof (the trimmed source gate no
  // longer runs it), so the lane that records the sidecar must run the real
  // built-site suite: build the Site, then drive the official Playwright
  // suite. Both steps are pinned here so a lane cannot claim the Site proof
  // from a build the clone never made.
  {
    name: 'task-site-build',
    cwd: EVIDENCE_ROLES.clone,
    match: exact(normalizeArgv(freshCloneCommands.siteBuild())),
  },
  {
    name: 'task-site-e2e',
    cwd: EVIDENCE_ROLES.clone,
    match: exact(normalizeArgv(freshCloneCommands.siteE2e())),
  },
  cleanProof('after', EVIDENCE_ROLES.clone),
];

/** The one canonical job/step contract table. */
export const JOB_CONTRACTS: Record<JobName, readonly StepContract[]> = {
  'fast-checks': [
    cleanProof('before', EVIDENCE_ROLES.source),
    ...STATIC_JOB_STEPS['fast-checks'].map((step) => ({
      name: step.name,
      cwd: EVIDENCE_ROLES.source,
      match: exact(step.command),
    })),
    cleanProof('after', EVIDENCE_ROLES.source),
  ],
  'source-matrix': [
    cleanProof('before', EVIDENCE_ROLES.source),
    ...STATIC_JOB_STEPS['source-matrix'].map((step) => ({
      name: step.name,
      cwd: EVIDENCE_ROLES.source,
      match: exact(step.command),
    })),
    cleanProof('after', EVIDENCE_ROLES.source),
  ],
  packed: [
    cleanProof('before', EVIDENCE_ROLES.source),
    ...STATIC_JOB_STEPS.packed.map((step) => ({
      name: step.name,
      cwd: EVIDENCE_ROLES.source,
      match: exact(step.command),
    })),
    cleanProof('after', EVIDENCE_ROLES.source),
  ],
  'fresh-clone': FRESH_CLONE_STEPS,
};

/** Step names required per job, derived from the contracts. */
export const REQUIRED_STEPS: Record<JobName, readonly string[]> = Object.fromEntries(
  JOB_NAMES.map((job) => [job, JOB_CONTRACTS[job].map((step) => step.name)]),
) as unknown as Record<JobName, readonly string[]>;

export function findStepContract(job: JobName, name: unknown): StepContract | undefined {
  if (typeof name !== 'string') return undefined;
  return JOB_CONTRACTS[job].find((step) => step.name === name);
}

/** Validate a step's argv and cwd against the canonical contract. */
export function auditStep(
  job: JobName,
  name: string,
  argv: unknown,
  cwd: unknown,
  context: StepMatchContext,
): string[] {
  const contract = findStepContract(job, name);
  if (!contract) return [`unknown step '${name}' for job ${job}`];
  const failures: string[] = [];
  if (typeof cwd !== 'string' || cwd === '') {
    failures.push('cwd must be a non-empty string');
  } else if (cwd !== contract.cwd) {
    failures.push(`cwd must be ${contract.cwd}, got ${JSON.stringify(cwd)}`);
  }
  if (!Array.isArray(argv) || argv.length === 0) {
    return [...failures, 'command (argv) must be a non-empty array of strings'];
  }
  for (const [index, element] of argv.entries()) {
    if (typeof element !== 'string' || element === '') {
      failures.push(`argv[${index}] must be a non-empty string`);
    }
  }
  const mismatch = contract.match(argv as string[], context);
  if (mismatch) failures.push(mismatch);
  return failures;
}

/** Exact isolation disclosure the fresh-clone job must record. */
export const FRESH_CLONE_ISOLATION = {
  sourceRepo: EVIDENCE_ROLES.source,
  cloneDir: EVIDENCE_ROLES.clone,
  pnpmStore: `${EVIDENCE_ROLES.temp}/pnpm-store`,
  npmCache: `${EVIDENCE_ROLES.temp}/npm-cache`,
  copiedFromWorkspace: 'none (no node_modules, dist, tgz, coverage, or .artifacts)',
  sharedBrowserCache: 'HOME Playwright browser binaries only (no module resolution impact)',
} as const;

export function auditFreshCloneIsolation(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['fresh-clone isolation disclosure missing or malformed'];
  }
  const record = value as Record<string, unknown>;
  const failures: string[] = [];
  for (const [key, expected] of Object.entries(FRESH_CLONE_ISOLATION)) {
    if (record[key] !== expected) {
      failures.push(
        `fresh-clone isolation ${key} must be ${JSON.stringify(expected)}, ` +
          `got ${JSON.stringify(record[key])}`,
      );
    }
  }
  const extra = Object.keys(record).filter((key) => !(key in FRESH_CLONE_ISOLATION));
  if (extra.length > 0) {
    failures.push(`fresh-clone isolation has unknown fields: ${extra.join(', ')}`);
  }
  return failures;
}

/** Canonical toolchain shape shared by the bundle and every job. */
export interface EvidenceToolVersions {
  node: string;
  pnpm: string;
  v8: string;
  typescript: string;
  npm: string;
  os: string;
  playwrightBrowsers: Record<string, string>;
}

export function auditToolVersions(value: unknown, label: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${label}: toolVersions must be an object`];
  }
  const record = value as Record<string, unknown>;
  const failures: string[] = [];
  for (const key of ['node', 'pnpm', 'v8', 'typescript', 'npm', 'os', 'playwrightBrowsers']) {
    if (!(key in record)) failures.push(`${label}: toolVersions missing ${key}`);
  }
  for (const key of ['node', 'pnpm', 'v8', 'typescript', 'npm', 'os']) {
    const entry = record[key];
    if (typeof entry !== 'string' || entry === '') {
      failures.push(`${label}: toolVersions.${key} must be a non-empty string`);
    }
  }
  const browsers = record.playwrightBrowsers;
  if (!browsers || typeof browsers !== 'object' || Array.isArray(browsers)) {
    failures.push(`${label}: toolVersions.playwrightBrowsers must be an object`);
  } else {
    const browserRecord = browsers as Record<string, unknown>;
    for (const browser of ['chromium', 'firefox', 'webkit']) {
      const version = browserRecord[browser];
      if (typeof version !== 'string' || version === '') {
        failures.push(
          `${label}: toolVersions.playwrightBrowsers.${browser} must be a non-empty string`,
        );
      }
    }
  }
  return failures;
}
