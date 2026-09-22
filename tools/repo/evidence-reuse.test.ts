/**
 * evidence-reuse.test.ts — the tree-SHA reuse contract (#1425 follow-up).
 *
 * Reuse is a fail-closed optimization with one safety condition: the reused
 * package must have proved the SAME TREE. These tests pin both directions —
 * the resolver must find a legitimate source and must refuse every near miss
 * (a different tree, an own-commit run, an expired run, a missing artifact, an
 * API failure), and the claim must stamp only a record that binds this tree.
 */
import { assertEquals } from '@std/assert';
import {
  auditReusedStamp,
  claimReusedResult,
  evidenceArtifactName,
  resolveReuse,
  type RunSummary,
} from './evidence-reuse.ts';

const TREE = 'b'.repeat(40);
const OTHER_TREE = 'd'.repeat(40);
const SHA = 'a'.repeat(40);
const SOURCE_SHA = 'e'.repeat(40);

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
      Promise.resolve(options.runs.map((run) => ({
        conclusion: run.conclusion ?? 'success',
        createdAt: run.createdAt ?? fresh(DAY),
        ...run,
      }))),
    resolveTree: (sha: string) => Promise.resolve(options.trees[sha] ?? null),
    listArtifacts: (runId: number) => {
      if (options.failArtifacts) return Promise.reject(new Error('api down'));
      return Promise.resolve(options.artifacts[runId] ?? []);
    },
  };
}

async function resolve(
  options: {
    runs: Array<Partial<RunSummary> & { runId: number; headSha: string }>;
    trees: Record<string, string>;
    artifacts: Record<number, string[]>;
    failArtifacts?: boolean;
  },
) {
  return await resolveReuse({
    currentSha: SHA,
    currentTree: TREE,
    jobs: ['packed'],
    now: NOW,
    ...world(options),
  });
}

Deno.test('reuse resolver: a tree-identical successful run with the artifact is reused', async () => {
  const decision = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA }],
    trees: { [SOURCE_SHA]: TREE },
    artifacts: { 42: [evidenceArtifactName('packed')] },
  });
  assertEquals(decision.reused, true);
  assertEquals(decision.sourceRunId, 42);
  assertEquals(decision.sourceSha, SOURCE_SHA);
});

Deno.test('reuse resolver: a different tree is never a source', async () => {
  const decision = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA }],
    trees: { [SOURCE_SHA]: OTHER_TREE },
    artifacts: { 42: [evidenceArtifactName('packed')] },
  });
  assertEquals(decision.reused, false);
  assertEquals(decision.sourceRunId, undefined);
});

Deno.test('reuse resolver: the candidate commit and failed runs are skipped', async () => {
  // Same tree, but the only carriers are our own commit and a failed run.
  const decision = await resolve({
    runs: [
      { runId: 43, headSha: SHA },
      { runId: 44, headSha: SOURCE_SHA, conclusion: 'failure' },
    ],
    trees: { [SHA]: TREE, [SOURCE_SHA]: TREE },
    artifacts: { 43: [evidenceArtifactName('packed')], 44: [evidenceArtifactName('packed')] },
  });
  assertEquals(decision.reused, false);
});

Deno.test('reuse resolver: a successful run without the lane artifact is skipped', async () => {
  const decision = await resolve({
    runs: [
      { runId: 45, headSha: 'f'.repeat(40) },
      { runId: 42, headSha: SOURCE_SHA },
    ],
    trees: { ['f'.repeat(40)]: TREE, [SOURCE_SHA]: TREE },
    // The newer run proved the tree but carries only another lane's artifact.
    artifacts: { 45: [evidenceArtifactName('fast-checks')], 42: [evidenceArtifactName('packed')] },
  });
  assertEquals(decision.reused, true);
  assertEquals(decision.sourceRunId, 42);
});

Deno.test('reuse resolver: an artifact listing failure is fail-closed', async () => {
  const decision = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA }],
    trees: { [SOURCE_SHA]: TREE },
    artifacts: {},
    failArtifacts: true,
  });
  assertEquals(decision.reused, false);
  assertEquals(decision.reason.includes('could not be listed'), true);
});

Deno.test('reuse resolver: runs past the artifact retention window are not sources', async () => {
  const decision = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA, createdAt: fresh(15 * DAY) }],
    trees: { [SOURCE_SHA]: TREE },
    artifacts: { 42: [evidenceArtifactName('packed')] },
  });
  assertEquals(decision.reused, false);
  // The boundary itself still counts: 13 days is inside a 14-day window.
  const inside = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA, createdAt: fresh(13 * DAY) }],
    trees: { [SOURCE_SHA]: TREE },
    artifacts: { 42: [evidenceArtifactName('packed')] },
  });
  assertEquals(inside.reused, true);
});

Deno.test('reuse resolver: an unparsable createdAt is not reused from', async () => {
  const decision = await resolve({
    runs: [{ runId: 42, headSha: SOURCE_SHA, createdAt: 'not-a-date' }],
    trees: { [SOURCE_SHA]: TREE },
    artifacts: { 42: [evidenceArtifactName('packed')] },
  });
  assertEquals(decision.reused, false);
});

Deno.test('reuse resolver: an unresolvable commit is skipped, not guessed', async () => {
  const decision = await resolve({
    runs: [
      { runId: 41, headSha: '1'.repeat(40) },
      { runId: 42, headSha: SOURCE_SHA },
    ],
    // The newer candidate's commit is gone (force-push), so its tree is null.
    trees: { [SOURCE_SHA]: TREE },
    artifacts: { 41: [evidenceArtifactName('packed')], 42: [evidenceArtifactName('packed')] },
  });
  assertEquals(decision.reused, true);
  assertEquals(decision.sourceRunId, 42);
});

Deno.test('reuse resolver: a run-list failure is fail-closed', async () => {
  const decision = await resolveReuse({
    currentSha: SHA,
    currentTree: TREE,
    jobs: ['packed'],
    now: NOW,
    listRuns: () => Promise.reject(new Error('no token')),
    resolveTree: () => Promise.resolve(TREE),
    listArtifacts: () => Promise.resolve([evidenceArtifactName('packed')]),
  });
  assertEquals(decision.reused, false);
  assertEquals(decision.reason.includes('could not list runs'), true);
});

Deno.test('reuse resolver: every lane must come from the SAME source run', async () => {
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
  assertEquals(partial.reused, false);

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
  assertEquals(complete.reused, true);
  assertEquals(complete.sourceRunId, 42);
});

Deno.test('reuse claim: stamps a record that binds this tree and source', () => {
  const record = {
    schemaVersion: 2,
    job: 'packed',
    sha: SOURCE_SHA,
    tree: TREE,
    trackedClean: true,
    result: 'PASS',
    steps: [],
  };
  const { claimed, failures } = claimReusedResult(record, {
    job: 'packed',
    currentTree: TREE,
    sourceRunId: 42,
    sourceSha: SOURCE_SHA,
  });
  assertEquals(failures, []);
  assertEquals(claimed.reused, { runId: 42, sha: SOURCE_SHA });
  assertEquals(auditReusedStamp(claimed.reused), []);
  // The record keeps claiming the commit that actually ran the gate.
  assertEquals(claimed.sha, SOURCE_SHA);
});

Deno.test('reuse claim: refuses a tree mismatch instead of stamping it', () => {
  const record = {
    job: 'packed',
    sha: SOURCE_SHA,
    tree: OTHER_TREE,
    result: 'PASS',
  };
  const { claimed, failures } = claimReusedResult(record, {
    job: 'packed',
    currentTree: TREE,
    sourceRunId: 42,
    sourceSha: SOURCE_SHA,
  });
  assertEquals(failures.length, 1);
  assertEquals(failures[0].includes('not the checked-out tree'), true);
  assertEquals(claimed.reused, undefined);
});

Deno.test('reuse claim: refuses a mismatched job, source, or non-PASS record', () => {
  const base = { job: 'packed', sha: SOURCE_SHA, tree: TREE, result: 'PASS' };
  assertEquals(
    claimReusedResult({ ...base, job: 'fresh-clone' }, {
      job: 'packed',
      currentTree: TREE,
      sourceRunId: 42,
      sourceSha: SOURCE_SHA,
    }).failures.length,
    1,
  );
  assertEquals(
    claimReusedResult({ ...base, sha: '9'.repeat(40) }, {
      job: 'packed',
      currentTree: TREE,
      sourceRunId: 42,
      sourceSha: SOURCE_SHA,
    }).failures.length,
    1,
  );
  assertEquals(
    claimReusedResult({ ...base, result: 'FAIL' }, {
      job: 'packed',
      currentTree: TREE,
      sourceRunId: 42,
      sourceSha: SOURCE_SHA,
    }).failures.length,
    1,
  );
});

Deno.test('reuse claim: a re-claim keeps the ORIGIN run, not the forwarder', () => {
  // A package already claimed from run 7 is re-used by run 9; the stamp must
  // still name run 7, or the provenance chain would point at a no-op.
  const record = {
    job: 'packed',
    sha: SOURCE_SHA,
    tree: TREE,
    result: 'PASS',
    reused: { runId: 7, sha: SOURCE_SHA },
  };
  const { claimed, failures } = claimReusedResult(record, {
    job: 'packed',
    currentTree: TREE,
    sourceRunId: 9,
    sourceSha: 'c'.repeat(40),
  });
  // The forwarder's sha does not match the record's sha, so this is refused:
  // the record always describes the run that executed the gate.
  assertEquals(failures.length, 1);
  assertEquals(claimed.reused, { runId: 7, sha: SOURCE_SHA });
});

Deno.test('reuse stamp audit rejects malformed stamps', () => {
  assertEquals(auditReusedStamp({ runId: 1, sha: SHA }), []);
  assertEquals(auditReusedStamp(undefined).length, 1);
  assertEquals(auditReusedStamp({ runId: 0, sha: SHA }).length, 1);
  assertEquals(auditReusedStamp({ runId: 1.5, sha: SHA }).length, 1);
  assertEquals(auditReusedStamp({ runId: 1, sha: 'short' }).length, 1);
  assertEquals(auditReusedStamp({ runId: 1, sha: SHA, extra: true }).length, 1);
});
