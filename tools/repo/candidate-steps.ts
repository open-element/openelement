/**
 * Canonical candidate job/step contract.
 *
 * One source of truth for what each candidate job must run. The producer
 * (`candidate-evidence.ts`) emits these argv values and the validator matches
 * received evidence against the same contracts, so a step name can never be
 * paired with a different command.
 *
 * Matching normalizes exactly one operationally irrelevant detail: an absolute
 * executable path whose basename is `deno` or `git` (the repository runs the
 * pinned Deno and system git; the basename is the pinned program name). Every
 * other argv element, flag, task name, cwd, and argument position is compared
 * byte-for-byte.
 */

export type JobName = 'fast-checks' | 'source-matrix' | 'packed' | 'fresh-clone';

export const JOB_NAMES: readonly JobName[] = [
  'fast-checks',
  'source-matrix',
  'packed',
  'fresh-clone',
];

export interface StepMatchContext {
  /** The commit the evidence binds to; used to pin the fresh-clone checkout. */
  sha: string;
}

export interface StepContract {
  name: string;
  /** Returns a failure description, or null when argv matches exactly. */
  match: (argv: readonly string[], context: StepMatchContext) => string | null;
}

/** Normalize an absolute deno/git executable path to its pinned basename. */
export function normalizeArgv(argv: readonly string[]): string[] {
  if (argv.length === 0) return [];
  const basename = argv[0].split('/').pop() ?? argv[0];
  const executable = basename === 'deno' || basename === 'git' ? basename : argv[0];
  return [executable, ...argv.slice(1)];
}

function exact(expected: readonly string[]): StepContract['match'] {
  return (argv) => {
    const normalized = normalizeArgv(argv);
    if (normalized.length !== expected.length) {
      return `expected argv ${JSON.stringify(expected)} (${expected.length} elements), ` +
        `got ${JSON.stringify(argv)}`;
    }
    for (let index = 0; index < expected.length; index++) {
      if (normalized[index] !== expected[index]) {
        return `argv[${index}] must be ${JSON.stringify(expected[index])}, ` +
          `got ${JSON.stringify(normalized[index])}`;
      }
    }
    return null;
  };
}

const denyNonArray = (argv: unknown): string | null =>
  Array.isArray(argv) ? null : 'command (argv) must be an array of non-empty strings';

function matchClone(argv: readonly string[]): string | null {
  const normalized = normalizeArgv(argv);
  if (normalized[0] !== 'git' || normalized[1] !== 'clone') {
    return `expected 'git clone --no-hardlinks <source> <dest>', got ${JSON.stringify(argv)}`;
  }
  if (normalized[2] !== '--no-hardlinks') {
    return 'fresh-clone clone must pass --no-hardlinks';
  }
  if (normalized.length !== 5) {
    return `fresh-clone clone must be 'git clone --no-hardlinks <source> <dest>', ` +
      `got ${JSON.stringify(argv)}`;
  }
  if (normalized[3] === '' || normalized[4] === '') {
    return 'fresh-clone clone requires non-empty source and destination';
  }
  if (normalized[3] === normalized[4]) {
    return 'fresh-clone clone destination must differ from the source repository';
  }
  return null;
}

function matchCheckout(boundContext: StepMatchContext): (argv: readonly string[]) => string | null {
  return (argv) => {
    const normalized = normalizeArgv(argv);
    if (
      normalized.length !== 5 || normalized[0] !== 'git' || normalized[1] !== '-C' ||
      normalized[3] !== 'checkout'
    ) {
      return `expected 'git -C <clone> checkout <sha>', got ${JSON.stringify(argv)}`;
    }
    if (normalized[2] === '') return 'fresh-clone checkout requires a clone directory';
    if (!/^[0-9a-f]{40}$/u.test(normalized[4])) {
      return `fresh-clone checkout target must be a 40-character commit, got ${normalized[4]}`;
    }
    if (normalized[4] !== boundContext.sha) {
      return `fresh-clone checkout target ${normalized[4]} != evidence sha ${boundContext.sha}`;
    }
    return null;
  };
}

/** Static job commands (producer argv; validator normalizes the executable). */
export const STATIC_JOB_STEPS: Record<
  Exclude<JobName, 'fresh-clone'>,
  readonly { name: string; command: readonly string[] }[]
> = {
  'fast-checks': [
    { name: 'fmt-check', command: ['deno', 'fmt', '--check'] },
    { name: 'lint', command: ['deno', 'lint'] },
    { name: 'markdown', command: ['deno', 'task', '--cwd', 'tools/repo', 'lint:markdown'] },
    { name: 'typecheck', command: ['deno', 'task', 'typecheck'] },
  ],
  'source-matrix': [
    { name: 'gate-source', command: ['deno', 'task', '--cwd', 'tools/repo', 'gate:source'] },
  ],
  packed: [
    { name: 'gate-packed', command: ['deno', 'task', '--cwd', 'tools/release', 'gate:packed'] },
    {
      name: 'publish-npm-dry-run',
      command: ['deno', 'task', '--cwd', 'tools/release', 'publish:npm:dry-run'],
    },
  ],
};

/** Fresh-clone argv builders — the producer and the validator share these. */
export const freshCloneCommands = {
  clone: (
    source: string,
    dest: string,
  ): string[] => ['git', 'clone', '--no-hardlinks', source, dest],
  checkout: (cloneDir: string, sha: string): string[] => ['git', '-C', cloneDir, 'checkout', sha],
  install: (denoExe: string): string[] => [denoExe, 'install'],
  check: (denoExe: string): string[] => [denoExe, 'task', 'check'],
  gateSource: (
    denoExe: string,
  ): string[] => [denoExe, 'task', '--cwd', 'tools/repo', 'gate:source'],
  releaseCheck: (denoExe: string): string[] => [denoExe, 'task', 'release:check'],
} as const;

export const FRESH_CLONE_STEPS: readonly StepContract[] = [
  { name: 'clone', match: (argv) => matchClone(argv) },
  { name: 'git-checkout', match: (argv, context) => matchCheckout(context)(argv) },
  { name: 'install', match: exact(['deno', 'install']) },
  { name: 'task-check', match: exact(['deno', 'task', 'check']) },
  {
    name: 'task-gate-source',
    match: exact(['deno', 'task', '--cwd', 'tools/repo', 'gate:source']),
  },
  { name: 'task-release-check', match: exact(['deno', 'task', 'release:check']) },
];

const STATIC_CONTRACT = (): Record<JobName, readonly StepContract[]> => ({
  'fast-checks': STATIC_JOB_STEPS['fast-checks'].map((step) => ({
    name: step.name,
    match: exact(step.command),
  })),
  'source-matrix': STATIC_JOB_STEPS['source-matrix'].map((step) => ({
    name: step.name,
    match: exact(step.command),
  })),
  packed: STATIC_JOB_STEPS.packed.map((step) => ({
    name: step.name,
    match: exact(step.command),
  })),
  'fresh-clone': FRESH_CLONE_STEPS,
});

/** The one canonical job/step contract table. */
export const JOB_CONTRACTS: Record<JobName, readonly StepContract[]> = STATIC_CONTRACT();

/** Step names required per job, derived from the contracts. */
export const REQUIRED_STEPS: Record<JobName, readonly string[]> = Object.fromEntries(
  JOB_NAMES.map((job) => [job, JOB_CONTRACTS[job].map((step) => step.name)]),
) as unknown as Record<JobName, readonly string[]>;

export function findStepContract(job: JobName, name: unknown): StepContract | undefined {
  if (typeof name !== 'string') return undefined;
  return JOB_CONTRACTS[job].find((step) => step.name === name);
}

/** Validate a step's argv against the canonical contract. */
export function auditStepCommand(
  job: JobName,
  name: string,
  argv: unknown,
  context: StepMatchContext,
): string[] {
  const failures: string[] = [];
  const nonArray = denyNonArray(argv);
  if (nonArray) return [nonArray];
  const elements = argv as unknown[];
  if (elements.length === 0) return ['command (argv) must not be empty'];
  for (const [index, element] of elements.entries()) {
    if (typeof element !== 'string' || element === '') {
      failures.push(`argv[${index}] must be a non-empty string`);
    }
  }
  if (failures.length > 0) return failures;
  const contract = findStepContract(job, name);
  if (!contract) return [`unknown step '${name}' for job ${job}`];
  const mismatch = contract.match(elements as string[], context);
  if (mismatch) failures.push(mismatch);
  return failures;
}

/**
 * Exact isolation disclosure the fresh-clone job must record. The validator
 * requires deep equality, so a forged or drifting isolation claim fails.
 */
export const FRESH_CLONE_ISOLATION = {
  denoDir: 'fresh, empty at start (removed after the run)',
  npmCache: 'fresh, empty at start (removed after the run)',
  copiedFromWorkspace: 'nothing (no node_modules, dist, tgz, coverage, or .artifacts)',
  cloneProtocol: 'git clone --no-hardlinks <source> <temp-destination>',
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
  const extra = Object.keys(record).filter(
    (key) => !(key in FRESH_CLONE_ISOLATION),
  );
  if (extra.length > 0) {
    failures.push(`fresh-clone isolation has unknown fields: ${extra.join(', ')}`);
  }
  return failures;
}
