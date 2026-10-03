/**
 * evidence-reuse.test.ts — the tree-SHA reuse contract (#1425 follow-up).
 *
 * Reuse is a fail-closed optimization with one safety condition: the reused
 * package must have proved the SAME TREE. These tests pin both directions —
 * the resolver must find a legitimate source and must refuse every near miss
 * (a different tree, an own-commit run, an expired run, a missing artifact, an
 * API failure), and the claim must stamp only a record whose PRODUCER commit
 * resolves to this tree. The chain case (#1439) is pinned explicitly: a
 * package handed forward by another run carries the commit that originally ran
 * the gate, which is not the resolved source run's head — tree identity is
 * what licenses the stamp, and the producer commit survives as its audit
 * field.
 */
import { expect, test } from 'vitest';
import {
  auditReusedStamp,
  claimReusedResult,
  evidenceArtifactName,
  resolveReuse,
  type RunSummary,
  workflowArtifactListArgs,
  workflowRunListArgs,
} from './evidence-reuse.ts';

const TREE = 'b'.repeat(40);
const OTHER_TREE = 'd'.repeat(40);
const SHA = 'a'.repeat(40);
const SOURCE_SHA = 'e'.repeat(40);
/**
 * The commit that ORIGINALLY executed a gate and was handed forward by a later
 * run (#1439): a downloaded record names it, while the run the resolver
 * pointed at has a different head commit.
 */
const ORIGIN_SHA = 'c'.repeat(40);

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-22T12:00:00.000Z');
const fresh = (offsetMs: number): string => new Date(NOW - offsetMs).toISOString();

/** A run list + tree/artifact resolvers over an in-memory world. */
function world(options: {
  runs: Array<Partial<RunSummary> & { runId: number; headSha: string }>;
  trees: Record<string, string>;
  artifacts: Record<number, string[]>;
  failArtifacts?: boolean;
}) {
  return {
    listRuns: () =>
      Promise.resolve(
        options.runs.map((run) => ({
          conclusion: run.conclusion ?? 'success',
          createdAt: run.createdAt ?? fresh(DAY),
          ...run,
        })),
      ),
    resolveTree: (sha: string) => Promise.resolve(options.trees[sha] ?? null),
    listArtifacts: (runId: number) => {
      if (options.failArtifacts) return Promise.reject(new Error('api down'));
      return Promise.resolve(options.artifacts[runId] ?? []);
    },
  };
}

async function resolve(options: {
  runs: Array<Partial<RunSummary> & { runId: number; headSha: string }>;
  trees: Record<string, string>;
  artifacts: Record<number, string[]>;
  failArtifacts?: boolean;
}) {
  return await resolveReuse({
    currentSha: SHA,
    currentTree: TREE,
    jobs: ['packed'],
    now: NOW,
    ...world(options),
  });
}

test('reuse resolver: a tree-identical successful run with the artifact is reused', async () => {
  const decision = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA }],
    trees: { [SOURCE_SHA]: TREE },
    artifacts: { 42: [evidenceArtifactName('packed')] },
  });
  expect(decision.reused).toEqual(true);
  expect(decision.sourceRunId).toEqual(42);
  expect(decision.sourceSha).toEqual(SOURCE_SHA);
});

test('reuse GitHub queries stay scoped and paginate artifact listings', () => {
  expect(workflowRunListArgs(50)).toEqual([
    'run',
    'list',
    '--workflow',
    'autoflow-ci.yml',
    '--limit',
    '50',
    '--json',
    'databaseId,headSha,conclusion,createdAt',
  ]);
  expect(workflowArtifactListArgs(42)).toEqual([
    'api',
    '--paginate',
    'repos/{owner}/{repo}/actions/runs/42/artifacts?per_page=100',
    '--jq',
    '.artifacts[].name',
  ]);
});

test('reuse resolver: a different tree is never a source', async () => {
  const decision = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA }],
    trees: { [SOURCE_SHA]: OTHER_TREE },
    artifacts: { 42: [evidenceArtifactName('packed')] },
  });
  expect(decision.reused).toEqual(false);
  expect(decision.sourceRunId).toEqual(undefined);
});

test('reuse resolver: the candidate commit and failed runs are skipped', async () => {
  // Same tree, but the only carriers are our own commit and a failed run.
  const decision = await resolve({
    runs: [
      { runId: 43, headSha: SHA },
      { runId: 44, headSha: SOURCE_SHA, conclusion: 'failure' },
    ],
    trees: { [SHA]: TREE, [SOURCE_SHA]: TREE },
    artifacts: { 43: [evidenceArtifactName('packed')], 44: [evidenceArtifactName('packed')] },
  });
  expect(decision.reused).toEqual(false);
});

test('reuse resolver: a successful run without the lane artifact is skipped', async () => {
  const decision = await resolve({
    runs: [
      { runId: 45, headSha: 'f'.repeat(40) },
      { runId: 42, headSha: SOURCE_SHA },
    ],
    trees: { ['f'.repeat(40)]: TREE, [SOURCE_SHA]: TREE },
    // The newer run proved the tree but carries only another lane's artifact.
    artifacts: { 45: [evidenceArtifactName('fast-checks')], 42: [evidenceArtifactName('packed')] },
  });
  expect(decision.reused).toEqual(true);
  expect(decision.sourceRunId).toEqual(42);
});

test('reuse resolver: an artifact listing failure is fail-closed', async () => {
  const decision = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA }],
    trees: { [SOURCE_SHA]: TREE },
    artifacts: {},
    failArtifacts: true,
  });
  expect(decision.reused).toEqual(false);
  expect(decision.reason.includes('could not be listed')).toEqual(true);
});

test('reuse resolver: runs past the artifact retention window are not sources', async () => {
  const decision = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA, createdAt: fresh(15 * DAY) }],
    trees: { [SOURCE_SHA]: TREE },
    artifacts: { 42: [evidenceArtifactName('packed')] },
  });
  expect(decision.reused).toEqual(false);
  // The boundary itself still counts: 13 days is inside a 14-day window.
  const inside = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA, createdAt: fresh(13 * DAY) }],
    trees: { [SOURCE_SHA]: TREE },
    artifacts: { 42: [evidenceArtifactName('packed')] },
  });
  expect(inside.reused).toEqual(true);
});

test('reuse resolver: an unparsable createdAt is not reused from', async () => {
  const decision = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA, createdAt: 'not-a-date' }],
    trees: { [SOURCE_SHA]: TREE },
    artifacts: { 42: [evidenceArtifactName('packed')] },
  });
  expect(decision.reused).toEqual(false);
});

test('reuse resolver: an unresolvable commit is skipped, not guessed', async () => {
  const decision = await resolve({
    runs: [
      { runId: 41, headSha: '1'.repeat(40) },
      { runId: 42, headSha: SOURCE_SHA },
    ],
    // The newer candidate's commit is gone (force-push), so its tree is null.
    trees: { [SOURCE_SHA]: TREE },
    artifacts: { 41: [evidenceArtifactName('packed')], 42: [evidenceArtifactName('packed')] },
  });
  expect(decision.reused).toEqual(true);
  expect(decision.sourceRunId).toEqual(42);
});

test('reuse resolver: maxCandidates bounds inspected eligible runs, including unresolved trees', async () => {
  let treeLookups = 0;
  const decision = await resolveReuse({
    currentSha: SHA,
    currentTree: TREE,
    jobs: ['packed'],
    now: NOW,
    maxCandidates: 2,
    listRuns: () =>
      Promise.resolve([
        { runId: 43, headSha: '1'.repeat(40), conclusion: 'success', createdAt: fresh(DAY) },
        { runId: 42, headSha: '2'.repeat(40), conclusion: 'success', createdAt: fresh(DAY) },
        { runId: 41, headSha: SOURCE_SHA, conclusion: 'success', createdAt: fresh(DAY) },
      ]),
    resolveTree: (sha) => {
      treeLookups++;
      return Promise.resolve(sha === SOURCE_SHA ? TREE : null);
    },
    listArtifacts: () => Promise.resolve([evidenceArtifactName('packed')]),
  });
  expect(treeLookups).toEqual(2);
  expect(decision.reused).toEqual(false);
  expect(decision.reason.includes('2 inspected candidate(s)')).toEqual(true);
});

test('reuse resolver: a run-list failure is fail-closed', async () => {
  const decision = await resolveReuse({
    currentSha: SHA,
    currentTree: TREE,
    jobs: ['packed'],
    now: NOW,
    listRuns: () => Promise.reject(new Error('no token')),
    resolveTree: () => Promise.resolve(TREE),
    listArtifacts: () => Promise.resolve([evidenceArtifactName('packed')]),
  });
  expect(decision.reused).toEqual(false);
  expect(decision.reason.includes('could not list runs')).toEqual(true);
});

test('reuse resolver: every lane must come from the SAME source run', async () => {
  // Run 42 carries three of the four lanes, run 41 carries the fourth. A
  // bundle spliced from two runs is what the single-tree identity check exists
  // to prevent, so neither is a source.
  const partial = await resolveReuse({
    currentSha: SHA,
    currentTree: TREE,
    jobs: ['fast-checks', 'source-matrix', 'packed', 'fresh-clone'],
    now: NOW,
    ...world({
      runs: [
        { runId: 42, headSha: SOURCE_SHA, createdAt: fresh(DAY), conclusion: 'success' },
        { runId: 41, headSha: '7'.repeat(40), createdAt: fresh(2 * DAY), conclusion: 'success' },
      ],
      trees: { [SOURCE_SHA]: TREE, ['7'.repeat(40)]: TREE },
      artifacts: {
        42: ['evidence-fast-checks', 'evidence-source-matrix', 'evidence-packed'],
        41: ['evidence-fresh-clone'],
      },
    }),
  });
  expect(partial.reused).toEqual(false);

  // The same four lanes from one run is a source.
  const complete = await resolveReuse({
    currentSha: SHA,
    currentTree: TREE,
    jobs: ['fast-checks', 'source-matrix', 'packed', 'fresh-clone'],
    now: NOW,
    ...world({
      runs: [{ runId: 42, headSha: SOURCE_SHA, createdAt: fresh(DAY), conclusion: 'success' }],
      trees: { [SOURCE_SHA]: TREE },
      artifacts: {
        42: [
          'evidence-fast-checks',
          'evidence-source-matrix',
          'evidence-packed',
          'evidence-fresh-clone',
        ],
      },
    }),
  });
  expect(complete.reused).toEqual(true);
  expect(complete.sourceRunId).toEqual(42);
});

/** A `resolveTree` stub over an explicit commit→tree map (absent = unresolvable). */
function treesFor(map: Record<string, string>) {
  return (sha: string): Promise<string | null> => Promise.resolve(map[sha] ?? null);
}

/**
 * Claim one record with the tree lookup stubbed. `producerTree` is what the
 * stub reports for the record's own `sha`: TREE by default, another tree (or
 * null for "unresolvable") to exercise the refusals.
 */
async function claim(
  record: Record<string, unknown>,
  options: {
    currentSha?: string;
    currentTree?: string;
    sourceRunId?: number;
    producerTree?: string | null;
  } = {},
) {
  const { producerTree = TREE, ...overrides } = options;
  return await claimReusedResult(record, {
    job: 'packed',
    currentSha: SHA,
    currentTree: TREE,
    sourceRunId: 42,
    resolveTree: treesFor(
      producerTree === null || typeof record.sha !== 'string' ? {} : { [record.sha]: producerTree },
    ),
    ...overrides,
  });
}

test('reuse claim: stamps a record that binds this tree and source', async () => {
  const record = {
    schemaVersion: 2,
    job: 'packed',
    sha: SOURCE_SHA,
    tree: TREE,
    trackedClean: true,
    result: 'PASS',
    steps: [],
  };
  const { claimed, failures } = await claim(record);
  expect(failures).toEqual([]);
  expect(claimed.reused).toEqual({ runId: 42, sha: SOURCE_SHA });
  expect(auditReusedStamp(claimed.reused)).toEqual([]);
  // The record keeps claiming the commit that actually ran the gate.
  expect(claimed.sha).toEqual(SOURCE_SHA);
});

test('reuse claim: a chained package is accepted on its PRODUCER tree', async () => {
  // The #1439 regression, exactly: run B (head SOURCE_SHA) replayed a package
  // produced by run A at ORIGIN_SHA and uploaded its own copy. The lane on
  // run C resolves B as its source, and the record inside the downloaded
  // artifact still names the producer commit — a different commit from the
  // resolved source. Tree identity is what licenses the reuse, so this must
  // stamp, and the producer commit must survive as the stamp's audit field.
  const record = {
    schemaVersion: 2,
    job: 'packed',
    sha: ORIGIN_SHA,
    tree: TREE,
    trackedClean: true,
    result: 'PASS',
    steps: [],
  };
  const { claimed, failures } = await claim(record, {
    sourceRunId: 9,
    producerTree: TREE,
  });
  expect(failures).toEqual([]);
  expect(claimed.reused).toEqual({ runId: 9, sha: ORIGIN_SHA });
  expect(claimed.sha, 'the producer commit must not be rewritten').toEqual(ORIGIN_SHA);
});

test('reuse claim: an already-stamped chain keeps its ORIGIN run and sha', async () => {
  // The downloaded record was itself claimed from run 7 (produced by
  // ORIGIN_SHA) and handed forward again. The stamp must still name run 7
  // and the commit that ran the gate: provenance cannot point at a no-op.
  const record = {
    job: 'packed',
    sha: ORIGIN_SHA,
    tree: TREE,
    result: 'PASS',
    reused: { runId: 7, sha: ORIGIN_SHA },
  };
  const { claimed, failures } = await claim(record, {
    sourceRunId: 9,
    producerTree: TREE,
  });
  expect(failures).toEqual([]);
  expect(claimed.reused).toEqual({ runId: 7, sha: ORIGIN_SHA });
  expect(claimed.sha).toEqual(ORIGIN_SHA);
});

test('reuse claim: refuses a tree mismatch instead of stamping it', async () => {
  const record = {
    job: 'packed',
    sha: SOURCE_SHA,
    tree: OTHER_TREE,
    result: 'PASS',
  };
  const { claimed, failures } = await claim(record);
  expect(failures.length).toEqual(1);
  expect(failures[0].includes('not the checked-out tree')).toEqual(true);
  expect(claimed.reused).toEqual(undefined);
});

test('reuse claim: a producer commit with a DIFFERENT tree is refused', async () => {
  // The record claims this tree in its own `tree` field, but the commit that
  // produced it is on another tree. This is the branch that proves the check
  // was not weakened into trusting the record: the second condition is
  // re-derived, not read.
  const record = { job: 'packed', sha: SOURCE_SHA, tree: TREE, result: 'PASS' };
  const { claimed, failures } = await claim(record, { producerTree: OTHER_TREE });
  expect(failures.length).toEqual(1);
  expect(failures[0].includes(`produced by ${SOURCE_SHA}`)).toEqual(true);
  expect(failures[0].includes('not the checked-out tree')).toEqual(true);
  expect(claimed.reused).toEqual(undefined);
});

test('reuse claim: an unresolvable producer commit is refused, not trusted', async () => {
  const record = { job: 'packed', sha: SOURCE_SHA, tree: TREE, result: 'PASS' };
  const { claimed, failures } = await claim(record, { producerTree: null });
  expect(failures.length).toEqual(1);
  expect(failures[0].includes('could not be resolved')).toEqual(true);
  expect(claimed.reused).toEqual(undefined);
});

test('reuse claim: the checked-out commit cannot be its own source', async () => {
  // Reusing a record produced by THIS commit would skip the gate that is
  // supposed to prove it; the aggregate refuses that shape, so the claim does.
  const record = { job: 'packed', sha: SHA, tree: TREE, result: 'PASS' };
  const { claimed, failures } = await claim(record);
  expect(failures.length).toEqual(1);
  expect(failures[0].includes('the checked-out commit')).toEqual(true);
  expect(claimed.reused).toEqual(undefined);
});

test('reuse claim: a malformed producer sha is refused', async () => {
  for (const sha of [undefined, '', 'short', 42]) {
    const { failures } = await claim({ job: 'packed', sha, tree: TREE, result: 'PASS' });
    expect(failures.length, `sha ${JSON.stringify(sha)} must be refused`).toEqual(1);
  }
});

test('reuse claim: refuses a mismatched job or non-PASS record', async () => {
  const base = { job: 'packed', sha: SOURCE_SHA, tree: TREE, result: 'PASS' };
  expect((await claim({ ...base, job: 'fresh-clone' })).failures.length).toEqual(1);
  expect((await claim({ ...base, result: 'FAIL' })).failures.length).toEqual(1);
});

test('reuse claim: a carried stamp that contradicts the record is refused', async () => {
  const base = { job: 'packed', sha: SOURCE_SHA, tree: TREE, result: 'PASS' };
  // Malformed: the shape audit the aggregate runs would reject it.
  const malformed = await claim({ ...base, reused: { runId: 0, sha: SOURCE_SHA } });
  expect(malformed.failures.length).toEqual(1);
  expect(malformed.failures[0].includes('reused.runId')).toEqual(true);
  // Names a commit the record was not produced by: provenance would lie.
  const contradictory = await claim({
    ...base,
    reused: { runId: 7, sha: ORIGIN_SHA },
  });
  expect(contradictory.failures.length).toEqual(1);
  expect(contradictory.failures[0].includes('carries a stamp for')).toEqual(true);
});

test('reuse stamp audit rejects malformed stamps', () => {
  expect(auditReusedStamp({ runId: 1, sha: SHA })).toEqual([]);
  expect(auditReusedStamp(undefined).length).toEqual(1);
  expect(auditReusedStamp({ runId: 0, sha: SHA }).length).toEqual(1);
  expect(auditReusedStamp({ runId: 1.5, sha: SHA }).length).toEqual(1);
  expect(auditReusedStamp({ runId: 1, sha: 'short' }).length).toEqual(1);
  expect(auditReusedStamp({ runId: 1, sha: SHA, extra: true }).length).toEqual(1);
});
