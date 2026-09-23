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
 * The claim judges the PRODUCER by its tree, not by its commit (#1439). A
 * package can hand its proof forward more than once: run A proves tree T at
 * commit a, run B replays it (stamp names run A and commit a) and uploads its
 * own artifact, and run C replays B's artifact. C's resolved source run is B,
 * whose head commit is b != a, while the record inside the artifact still
 * says `sha: a` — the commit that actually executed the gate. Requiring
 * `record.sha == resolved source sha` there refused a legitimate chain and
 * turned four lanes red. The identity that licenses the reuse is the tree, so
 * the claim keeps requiring `record.tree == checked-out tree` and adds a
 * LOCAL re-derivation of the producer commit's tree (`git rev-parse
 * <record.sha>^{tree}`): it must equal the checked-out tree, and a commit
 * whose tree cannot be resolved is a refusal. The producer commit stays in
 * the stamp as the audit field, never rewritten to the forwarder's commit.
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

const COMMIT_SHA = /^[0-9a-f]{40}$/u;

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

/** Inputs one lane's claim is judged against. */
export interface ClaimReuseOptions {
  job: JobName;
  /** The checked-out candidate commit; a record produced by it is refused. */
  currentSha: string;
  /** Tree of the checked-out candidate commit. */
  currentTree: string;
  /** Run the artifact was downloaded from (the resolved source run). */
  sourceRunId: number;
  /**
   * Tree SHA of one commit, or null when it cannot be resolved. The CLI
   * resolves it with `git rev-parse <sha>^{tree}`; tests inject a stub. A null
   * is a refusal, never a pass.
   */
  resolveTree: (sha: string) => Promise<string | null>;
}

/**
 * Stamp one lane's downloaded `result.json` as reused.
 *
 * Two conditions, both about TREE identity, must hold before a record is
 * stamped: the record itself must already bind the checked-out tree, and the
 * commit that produced it must really carry that tree — re-derived locally
 * through `resolveTree`, never taken from the record's own `tree` field. A
 * record that fails either one is refused instead of stamped, and an
 * unresolvable producer commit is a refusal too. A record produced by the
 * checked-out commit itself is refused for the same reason the aggregate
 * refuses it: that lane would skip the gate that is supposed to prove it.
 *
 * The producer commit is deliberately NOT required to be the resolved source
 * run's head commit (#1439): a reused package stays valid when it is handed
 * forward through another run, and in that chain the record's `sha` names the
 * commit that originally executed the gate. That commit is preserved verbatim
 * as the stamp's audit field, together with the run that first proved the
 * tree, so a reader can always follow the stamp to the run that ran the suite
 * rather than to a forwarding no-op. The record's own `sha` is left untouched
 * for the same reason, and the aggregate accepts the difference on the
 * strength of the tree match plus this stamp.
 */
export async function claimReusedResult(
  result: Record<string, unknown>,
  options: ClaimReuseOptions,
): Promise<{ claimed: Record<string, unknown>; failures: string[] }> {
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
  const producerSha = result.sha;
  if (typeof producerSha !== 'string' || !COMMIT_SHA.test(producerSha)) {
    failures.push(
      `reused artifact's sha must be the 40-char hex commit that produced it, got ${
        JSON.stringify(producerSha)
      }`,
    );
  } else if (producerSha === options.currentSha) {
    // Same refusal the aggregate makes: a lane may not skip its gate for the
    // very commit that was supposed to prove itself.
    failures.push(
      `reused artifact was produced by the checked-out commit ${producerSha}; a reused job must ` +
        `record the source commit it was replayed from`,
    );
  }
  if (result.result !== 'PASS') {
    failures.push(`reused artifact result must be PASS, got ${JSON.stringify(result.result)}`);
  }
  // A record that already failed is never resolved against Git: the refusal is
  // decided by what the artifact says about itself.
  if (failures.length > 0) return { claimed: result, failures };

  // The safety condition. `resolveTree` is the caller's Git lookup, so this
  // cannot degrade into trusting the record's `tree` field.
  const producerTree = await options.resolveTree(producerSha as string);
  if (producerTree === null) {
    return {
      claimed: result,
      failures: [
        `reused artifact was produced by ${producerSha}, whose tree could not be resolved`,
      ],
    };
  }
  if (producerTree !== options.currentTree) {
    return {
      claimed: result,
      failures: [
        `reused artifact was produced by ${producerSha} at tree ${producerTree}, ` +
        `not the checked-out tree ${options.currentTree}`,
      ],
    };
  }

  // Carry the ORIGIN of the proof forward: a re-reused package reports the run
  // that actually executed the gate, not the run that forwarded it. An origin
  // stamp that is malformed, or that names a commit other than this record's
  // producer, is refused — the aggregate would reject it anyway, and refusing
  // here lets the lane fall back to a real run instead of turning the bundle
  // red.
  const previous = result.reused;
  let stamp: ReusedStamp;
  if (previous === undefined) {
    stamp = { runId: options.sourceRunId, sha: producerSha as string };
  } else {
    const stampFailures = auditReusedStamp(previous);
    if (stampFailures.length > 0) {
      return {
        claimed: result,
        failures: stampFailures.map((failure) => `reused artifact carries ${failure}`),
      };
    }
    const origin = previous as ReusedStamp;
    if (origin.sha !== producerSha) {
      return {
        claimed: result,
        failures: [
          `reused artifact carries a stamp for ${origin.sha} but was produced by ${producerSha}`,
        ],
      };
    }
    stamp = { runId: origin.runId, sha: origin.sha };
  }
  // Key order matters: `reused` is appended so a re-claim is byte-stable
  // against the record it replaces.
  return { claimed: { ...result, reused: stamp }, failures };
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
  if (typeof value.sha !== 'string' || !COMMIT_SHA.test(value.sha)) {
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
        '       evidence-reuse.ts --claim --job <name> --source-run-id <id>\n' +
        '                        [--source-sha <sha>] [--out <dir>]\n' +
        "       --source-sha is audit context (the resolved run's head commit), never a\n" +
        '       matching key: the claim compares TREES. Both accept --repo-root <dir>\n' +
        '       (default: the checkout this tool ships in).',
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

/**
 * Tree SHA of a commit in the local checkout. Used by the claim to re-derive
 * the tree of the commit that produced a downloaded record — the record's own
 * `tree` field is never trusted for that. A commit the checkout does not have
 * resolves to null, which the claim refuses on: an unresolvable producer is a
 * reason to run the gate, never a reason to stamp.
 */
async function treeOfLocalCommit(sha: string): Promise<string | null> {
  try {
    const tree = await git(['rev-parse', `${sha}^{tree}`]);
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
  if (sourceSha !== '' && !COMMIT_SHA.test(sourceSha)) {
    throw new Error(`--source-sha must be a 40-char hex commit when given, got ${sourceSha}`);
  }
  const [sha, tree] = [await git(['rev-parse', 'HEAD']), await git(['rev-parse', 'HEAD^{tree}'])];
  const resultPath = join(outDir, job, 'result.json');
  const raw = JSON.parse(await Deno.readTextFile(resultPath)) as Record<string, unknown>;
  const { claimed, failures } = await claimReusedResult(raw, {
    job,
    currentSha: sha,
    currentTree: tree,
    sourceRunId,
    // The producer's tree is re-derived from the LOCAL object store: the
    // record's own `tree` field never answers this question for itself.
    resolveTree: treeOfLocalCommit,
  });
  if (failures.length > 0) {
    throw new Error(`refusing to stamp reused evidence:\n- ${failures.join('\n- ')}`);
  }
  await Deno.writeTextFile(resultPath, JSON.stringify(claimed, null, 2) + '\n');
  // The resolved source commit is printed for the reader; it is deliberately
  // NOT a matching key any more (#1439) — the record's own producer commit and
  // this tree are what the claim verified.
  console.log(
    `reuse[${job}]: stamped result.json as reused from run ${sourceRunId}` +
      (sourceSha === '' ? '' : ` (resolved source commit ${sourceSha})`) +
      `, record produced by ${String(claimed.sha)}, checked-out tree ${tree}`,
  );
}
