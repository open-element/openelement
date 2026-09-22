/**
 * Tree-SHA evidence reuse (#1425 follow-up).
 *
 * A green candidate evidence package proves a **tree**, not a commit: every
 * job record carries `tree`, every log is bound to that tree by the
 * clean-proof line, and every tarball is byte-hashed. Two commits with the
 * same tree have byte-identical content, so a package that proved tree T is
 * valid proof for any commit whose tree is T — a squash sync, a rebase, or an
 * amend that changed only the commit message.
 *
 * This tool finds such a package and turns the four producer lanes into
 * verified no-ops:
 *
 *   resolve  Emit `reused=true` + the source run id when a successful run of
 *            this workflow recorded the same tree with a different commit and
 *            carries the lane's `evidence-*` artifact. Every step is
 *            fail-closed: no token, no runs, an API error, a tree that cannot
 *            be resolved, or a missing artifact all resolve to `reused=false`
 *            and the lane runs the real gate.
 *   claim    After the lane downloads the source artifact, verify it binds
 *            THIS tree and stamp `reused: { runId, sha }` into its
 *            `result.json`, which is what the aggregate accepts a differing
 *            `sha` on. A tree mismatch is refused, never stamped.
 *
 * The reuse key is deliberately the tree SHA and never the commit SHA: the
 * whole point is that a new commit with identical content reuses the old
 * proof. Reuse is chained-safe — a claim records the ORIGIN run — and the
 * aggregate's own age window still bounds how long a package stays reusable.
 *
 * Everything the network answers is untrusted: `resolveReuse` re-derives the
 * tree of every candidate through `resolveTree` and requires the lane's
 * artifact to exist before it reports a source.
 */

import { join, resolve } from '@std/path';
import { JOB_NAMES, type JobName } from './candidate-steps.ts';

/** Artifact name prefix every producer lane uploads under. */
export const EVIDENCE_ARTIFACT_PREFIX = 'evidence-';

/** The artifact a lane's reuse must be able to download. */
export function evidenceArtifactName(job: JobName): string {
  return `${EVIDENCE_ARTIFACT_PREFIX}${job}`;
}

/** One workflow run as the resolver needs to see it. */
export interface RunSummary {
  runId: number;
  headSha: string;
  conclusion: string;
  /** ISO-8601 creation time; the resolver bounds reuse by artifact retention. */
  createdAt: string;
}

export interface ReuseDecision {
  reused: boolean;
  sourceRunId?: number;
  sourceSha?: string;
  /** Human-readable justification, printed and put in the step summary. */
  reason: string;
}

export interface ResolveReuseOptions {
  currentSha: string;
  currentTree: string;
  /**
   * Lanes that must all be replayable from the same source run. One source
   * run has to carry every lane's artifact: a partially reusable package
   * would splice records from two runs into one bundle, and the aggregate's
   * single-tree identity check is the only thing that would notice.
   */
  jobs: readonly JobName[];
  /** Newest-first successful runs; the caller applies the API filter. */
  listRuns: () => Promise<RunSummary[]>;
  /** Tree SHA of one commit, or null when it cannot be resolved. */
  resolveTree: (sha: string) => Promise<string | null>;
  /** Artifact names carried by one run. */
  listArtifacts: (runId: number) => Promise<string[]>;
  /** Bound on how many candidate runs are inspected. */
  maxCandidates?: number;
  /**
   * Oldest run the resolver will reuse from, in days. Defaults to the
   * evidence artifact retention window: a package GitHub has already expired
   * cannot be downloaded, so it must not be reported as a source.
   */
  maxAgeDays?: number;
  /** Injectable clock for tests. */
  now?: number;
}

const DEFAULT_MAX_CANDIDATES = 20;
const DEFAULT_MAX_AGE_DAYS = 14;

/**
 * Pick the newest successful run that proved the same tree with a different
 * commit and carries every lane's evidence artifact. Returns a `reused: false`
 * decision (never throws) for every other outcome.
 */
export async function resolveReuse(options: ResolveReuseOptions): Promise<ReuseDecision> {
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const maxAgeMs = (options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
  const now = options.now ?? Date.now();
  const artifactNames = options.jobs.map(evidenceArtifactName);
  let runs: RunSummary[];
  try {
    runs = await options.listRuns();
  } catch (cause) {
    return { reused: false, reason: `could not list runs: ${String(cause)}` };
  }
  // Newest first, and never the commit we are on: reusing our own run would
  // skip the gate for the exact commit that is supposed to prove it.
  const candidates = runs
    .filter((run) => run.conclusion === 'success' && run.headSha !== options.currentSha)
    .filter((run) => {
      const created = Date.parse(run.createdAt);
      return !Number.isNaN(created) && now - created <= maxAgeMs;
    })
    .slice(0, maxCandidates);
  let inspected = 0;
  for (const run of candidates) {
    const tree = await options.resolveTree(run.headSha).catch(() => null);
    if (tree === null) continue;
    inspected++;
    if (tree !== options.currentTree) continue;
    let artifacts: string[];
    try {
      artifacts = await options.listArtifacts(run.runId);
    } catch (cause) {
      return {
        reused: false,
        reason: `run ${run.runId} proved tree ${tree} but its artifacts could not be listed: ${
          String(cause)
        }`,
      };
    }
    const missing = artifactNames.filter((name) => !artifacts.includes(name));
    if (missing.length > 0) continue;
    return {
      reused: true,
      sourceRunId: run.runId,
      sourceSha: run.headSha,
      reason: `run ${run.runId} (commit ${run.headSha}) proved tree ${tree} and carries ` +
        artifactNames.join(', '),
    };
  }
  return {
    reused: false,
    reason:
      `no successful run in the ${inspected} inspected candidate(s) proved tree ${options.currentTree} while carrying ${
        artifactNames.join(', ')
      }`,
  };
}

/** The reuse stamp a claimed job record carries. */
export interface ReusedStamp {
  runId: number;
  sha: string;
}

/**
 * Stamp one lane's downloaded `result.json` as reused.
 *
 * The record must already bind the tree this run is proving — that is the
 * whole safety condition, so a mismatch is refused instead of stamped. The
 * source commit is recorded as the stamp's `sha`, and the record's own `sha`
 * is left untouched: the evidence keeps claiming the commit that actually ran
 * the suite, and the aggregate accepts the difference on the strength of the
 * tree match plus this stamp.
 */
export function claimReusedResult(
  result: Record<string, unknown>,
  options: { job: JobName; currentTree: string; sourceRunId: number; sourceSha: string },
): { claimed: Record<string, unknown>; failures: string[] } {
  const failures: string[] = [];
  if (result.job !== options.job) {
    failures.push(
      `reused artifact is for job ${JSON.stringify(result.job)}, not ${options.job}`,
    );
  }
  if (result.tree !== options.currentTree) {
    failures.push(
      `reused artifact proved tree ${
        JSON.stringify(result.tree)
      }, not the checked-out tree ${options.currentTree}`,
    );
  }
  if (result.sha !== options.sourceSha) {
    failures.push(
      `reused artifact was produced by ${
        JSON.stringify(result.sha)
      }, not the resolved source ${options.sourceSha}`,
    );
  }
  if (result.result !== 'PASS') {
    failures.push(`reused artifact result must be PASS, got ${JSON.stringify(result.result)}`);
  }
  if (failures.length > 0) return { claimed: result, failures };
  // Carry the ORIGIN of the proof forward: a re-reused package reports the run
  // that actually executed the gate, not the run that forwarded it.
  const previous = result.reused;
  const stamp: ReusedStamp = {
    runId: existingStampRunId(previous) ?? options.sourceRunId,
    sha: existingStampSha(previous) ?? options.sourceSha,
  };
  // Key order matters: `reused` is appended so a re-claim is byte-stable
  // against the record it replaces.
  return { claimed: { ...result, reused: stamp }, failures };
}

function existingStampRunId(previous: unknown): number | undefined {
  if (typeof previous !== 'object' || previous === null) return undefined;
  const runId = (previous as Record<string, unknown>).runId;
  return typeof runId === 'number' && Number.isSafeInteger(runId) ? runId : undefined;
}

function existingStampSha(previous: unknown): string | undefined {
  if (typeof previous !== 'object' || previous === null) return undefined;
  const sha = (previous as Record<string, unknown>).sha;
  return typeof sha === 'string' && /^[0-9a-f]{40}$/u.test(sha) ? sha : undefined;
}

/** Audit one `reused` field, shared by the job and bundle validators. */
export function auditReusedStamp(value: unknown): string[] {
  if (!isRecord(value)) return ['reused must be an object'];
  const failures: string[] = [];
  const extra = Object.keys(value).filter((key) => key !== 'runId' && key !== 'sha');
  if (extra.length > 0) failures.push(`reused has unknown fields: ${extra.join(', ')}`);
  if (!Number.isSafeInteger(value.runId) || (value.runId as number) <= 0) {
    failures.push(`reused.runId must be a positive integer, got ${JSON.stringify(value.runId)}`);
  }
  if (typeof value.sha !== 'string' || !/^[0-9a-f]{40}$/u.test(value.sha)) {
    failures.push(`reused.sha must be a 40-char hex commit, got ${JSON.stringify(value.sha)}`);
  }
  return failures;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ─── CLI ─────────────────────────────────────────────────────────────

/**
 * The repository the tool inspects. Module-relative by default (the repo
 * convention for tasks: the tool always measures the checkout it ships in).
 * `--repo-root` exists so the reuse decision and claim can be exercised
 * against ANOTHER checkout — the live smoke for the "found a source" path
 * needs a worktree whose tree matches a run that already exists.
 */
function repoRootArg(): string {
  const override = flagValue('repo-root');
  return override === undefined ? resolve(import.meta.dirname!, '../..') : resolve(override);
}

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = Deno.args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = Deno.args.indexOf(`--${name}`);
  return index >= 0 ? Deno.args[index + 1] : undefined;
}

async function git(args: string[], cwd: string = repoRootArg()): Promise<string> {
  const result = await new Deno.Command('git', {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (!result.success) {
    throw new Error(`git ${args.join(' ')} failed: ${new TextDecoder().decode(result.stderr)}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

if (import.meta.main) {
  if (Deno.args.includes('--resolve')) await resolveCommand();
  else if (Deno.args.includes('--claim')) await claimCommand();
  else {
    console.error(
      'usage: evidence-reuse.ts --resolve [--github-output <path>]\n' +
        '                        [--current-sha <sha>] [--current-tree <tree>]\n' +
        '       evidence-reuse.ts --claim --job <name> --source-run-id <id> --source-sha <sha> ' +
        '[--out <dir>]\n' +
        '       both accept --repo-root <dir> (default: the checkout this tool ships in)',
    );
    Deno.exit(2);
  }
}

/** Run `gh` and return its raw stdout (for `--jq` expressions). */
async function ghText(args: string[]): Promise<string> {
  const result = await new Deno.Command('gh', {
    args,
    cwd: repoRootArg(),
    stdout: 'piped',
    stderr: 'piped',
    env: { ...Deno.env.toObject(), GH_PROMPT_DISABLED: '1' },
  }).output();
  if (!result.success) {
    throw new Error(
      `gh ${args.join(' ')} failed: ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(result.stdout).trim();
}

/** Run `gh --json` and parse the payload. */
async function ghJson(args: string[]): Promise<unknown> {
  return JSON.parse(await ghText(args));
}

/** Append `key=value` lines to a GitHub step output file. */
async function writeOutputs(
  path: string | undefined,
  values: Record<string, string>,
): Promise<void> {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  if (path === undefined) {
    console.log(lines.trimEnd());
    return;
  }
  await Deno.writeTextFile(path, lines, { append: true, create: true });
}

async function listWorkflowRuns(limit: number): Promise<RunSummary[]> {
  const payload = await ghJson([
    'run',
    'list',
    '--limit',
    String(limit),
    '--json',
    'databaseId,headSha,conclusion,createdAt',
  ]) as Array<{ databaseId: number; headSha: string; conclusion: string; createdAt: string }>;
  return payload.map((run) => ({
    runId: run.databaseId,
    headSha: run.headSha,
    conclusion: run.conclusion,
    createdAt: run.createdAt,
  }));
}

async function resolveTreeViaGh(sha: string): Promise<string | null> {
  try {
    // `--jq` prints the bare value: read text, not JSON.
    const tree = await ghText([
      'api',
      `repos/{owner}/{repo}/git/commits/${sha}`,
      '--jq',
      '.tree.sha',
    ]);
    return /^[0-9a-f]{40}$/u.test(tree) ? tree : null;
  } catch {
    return null;
  }
}

async function listArtifactsViaGh(runId: number): Promise<string[]> {
  const names = await ghText([
    'api',
    `repos/{owner}/{repo}/actions/runs/${runId}/artifacts?per_page=100`,
    '--jq',
    '.artifacts[].name',
  ]);
  return names.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

async function resolveCommand(): Promise<void> {
  const [sha, tree] = [await git(['rev-parse', 'HEAD']), await git(['rev-parse', 'HEAD^{tree}'])];
  // `--current-sha`/`--current-tree` re-run the decision as if the candidate
  // were another commit/tree. They exist for the resolver's own live smoke:
  // pointing them at a tree that already has a green run exercises the "found
  // a source" path end-to-end, which the fail-closed unit tests can only fake.
  const currentSha = flagValue('current-sha') ?? sha;
  const currentTree = flagValue('current-tree') ?? tree;
  for (const [name, value] of [['--current-sha', currentSha], ['--current-tree', currentTree]]) {
    if (!/^[0-9a-f]{40}$/u.test(value)) {
      throw new Error(`${name} must be a 40-char hex object id, got ${value}`);
    }
  }
  const decision = await resolveReuse({
    currentSha,
    currentTree,
    jobs: JOB_NAMES,
    listRuns: () => listWorkflowRuns(50),
    resolveTree: resolveTreeViaGh,
    listArtifacts: listArtifactsViaGh,
  });
  console.log(
    `reuse tree=${currentTree}: ${decision.reused ? 'REUSE' : 'full run'} — ${decision.reason}`,
  );
  await writeOutputs(flagValue('github-output'), {
    reused: decision.reused ? 'true' : 'false',
    source_run_id: decision.sourceRunId === undefined ? '' : String(decision.sourceRunId),
    source_sha: decision.sourceSha ?? '',
    tree: currentTree,
  });
}

async function claimCommand(): Promise<void> {
  const outDir = flagValue('out') ?? join(repoRootArg(), '.artifacts/ci');
  const jobArg = flagValue('job');
  const job = (jobArg ?? '') as JobName;
  if (!JOB_NAMES.includes(job)) {
    throw new Error(`--job must be one of ${JOB_NAMES.join(', ')}, got ${JSON.stringify(jobArg)}`);
  }
  const sourceRunId = Number(flagValue('source-run-id'));
  const sourceSha = flagValue('source-sha') ?? '';
  if (!Number.isSafeInteger(sourceRunId) || sourceRunId <= 0) {
    throw new Error('--source-run-id must be a positive integer');
  }
  const tree = await git(['rev-parse', 'HEAD^{tree}']);
  const resultPath = join(outDir, job, 'result.json');
  const raw = JSON.parse(await Deno.readTextFile(resultPath)) as Record<string, unknown>;
  const { claimed, failures } = claimReusedResult(raw, {
    job,
    currentTree: tree,
    sourceRunId,
    sourceSha,
  });
  if (failures.length > 0) {
    throw new Error(`refusing to stamp reused evidence:\n- ${failures.join('\n- ')}`);
  }
  await Deno.writeTextFile(resultPath, JSON.stringify(claimed, null, 2) + '\n');
  console.log(
    `reuse[${job}]: stamped result.json as reused from run ${sourceRunId} (commit ${sourceSha}) ` +
      `for tree ${tree}`,
  );
}
