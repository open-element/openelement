import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { resolveReleaseGateSelection, runReleasePrepare } from '../cli.ts';
import {
  type GitHubRunInfo,
  PR_CI_ARTIFACT_PREFIX,
  PR_CI_EVIDENCE_JOB_NAME,
  PR_CI_WORKFLOW_FILE,
  releaseOnlyGateNames,
  REQUIRED_PR_CI_JOBS,
} from '../loop-evidence.ts';
import { selectGates } from '../policy.ts';

const SHA = 'a'.repeat(40);

function record(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 2,
    kind: 'pr-full-ci',
    sha: SHA,
    workflow: PR_CI_WORKFLOW_FILE,
    tier: 'ci',
    conclusion: 'success',
    matrixComplete: true,
    repository: 'open-element/openelement',
    runId: 8123456789,
    runAttempt: 1,
    event: 'pull_request',
    artifactName: `${PR_CI_ARTIFACT_PREFIX}${SHA}`,
    jobs: REQUIRED_PR_CI_JOBS.map((name) => ({ name, conclusion: 'success' })),
    url: 'https://example.invalid/actions/run/1',
    ...overrides,
  });
}

function matchingRun(): GitHubRunInfo {
  return {
    repository: 'open-element/openelement',
    workflowPath: `.github/workflows/${PR_CI_WORKFLOW_FILE}`,
    event: 'pull_request',
    headSha: SHA,
    status: 'completed',
    conclusion: 'success',
    runAttempt: 1,
    jobs: [
      { name: 'dependency-review', status: 'completed', conclusion: 'success' },
      { name: 'autoflow-ci', status: 'completed', conclusion: 'success' },
      { name: 'dist/server Node smoke (Node 20)', status: 'completed', conclusion: 'success' },
      { name: 'dist/server Node smoke (Node 24)', status: 'completed', conclusion: 'success' },
      { name: 'dist/server Bun smoke', status: 'completed', conclusion: 'success' },
      { name: 'workspace-qualification', status: 'completed', conclusion: 'success' },
      { name: PR_CI_EVIDENCE_JOB_NAME, status: 'completed', conclusion: 'success' },
    ],
    artifactNames: [`${PR_CI_ARTIFACT_PREFIX}${SHA}`],
  };
}

const injectedRun = () => Promise.resolve(matchingRun());

async function withEvidenceFile(
  content: string,
  fn: (path: string) => Promise<unknown>,
): Promise<void> {
  const path = await Deno.makeTempFile({ suffix: '.json' });
  try {
    await Deno.writeTextFile(path, content);
    await fn(path);
  } finally {
    await Deno.remove(path);
  }
}

Deno.test('R3: release entry fails closed when the evidence argument is absent', async () => {
  const error = await assertRejects(() => resolveReleaseGateSelection(undefined, SHA, []), Error);
  assertStringIncludes(error.message, '--pr-ci');
});

Deno.test('R3: release entry fails closed when the evidence file does not exist', async () => {
  await assertRejects(() => resolveReleaseGateSelection('does-not-exist.pr-ci.json', SHA, []));
});

Deno.test('R3: stale or mismatched SHA evidence is rejected', async () => {
  await withEvidenceFile(
    record({ sha: 'b'.repeat(40) }),
    (path) =>
      assertRejects(() => resolveReleaseGateSelection(path, SHA, []), Error, 'stale or mismatched'),
  );
});

Deno.test('R3: failing PR CI evidence is rejected', async () => {
  await withEvidenceFile(
    record({ conclusion: 'failure' }),
    (path) => assertRejects(() => resolveReleaseGateSelection(path, SHA, []), Error, 'not green'),
  );
});

Deno.test('R3: weakened (partial matrix) evidence is rejected', async () => {
  await withEvidenceFile(
    record({ matrixComplete: false }),
    (path) => assertRejects(() => resolveReleaseGateSelection(path, SHA, []), Error, 'weakened'),
  );
});

Deno.test('R3: unsupported evidence tier is rejected', async () => {
  await withEvidenceFile(
    record({ tier: 'push' }),
    (path) => assertRejects(() => resolveReleaseGateSelection(path, SHA, []), Error, 'unsupported'),
  );
});

Deno.test('R3: wrong-workflow evidence is rejected', async () => {
  await withEvidenceFile(
    record({ workflow: 'nightly-stress.yml' }),
    (path) => assertRejects(() => resolveReleaseGateSelection(path, SHA, []), Error, 'workflow'),
  );
});

Deno.test('R3: unreadable evidence JSON is rejected loudly', async () => {
  await withEvidenceFile(
    '{not json',
    (path) => assertRejects(() => resolveReleaseGateSelection(path, SHA, [])),
  );
});

Deno.test('R3: matching successful full-matrix evidence selects only complementary release gates', async () => {
  await withEvidenceFile(record(), async (path) => {
    const gates = await resolveReleaseGateSelection(
      path,
      SHA,
      ['docs/current/VERSION_PLAN.md'],
      injectedRun,
    );
    const names = gates.map((gate) => gate.name);
    const ciNames = new Set(selectGates('ci', []).map((gate) => gate.name));
    for (const name of names) {
      assert(!ciNames.has(name), `${name} is already proven by the exact-SHA PR matrix`);
    }
    assertEquals([...names].sort(), [...releaseOnlyGateNames()].sort());
    for (
      const preserved of [
        'release:state-machine:check',
        'nitro:proof:node',
        'nitro:proof:workers',
        'publish:npm:dry-run',
      ]
    ) {
      assert(names.includes(preserved), `${preserved} must stay in the release lane`);
    }
  });
});

Deno.test('R9: preparation refuses PR CI evidence — it prepares the SHA the PR must prove', async () => {
  const error = await assertRejects(
    () => runReleasePrepare('docs/current/VERSION_PLAN.md', '0.44.0-alpha.1', true, 'x.json'),
    Error,
  );
  assertStringIncludes(error.message, 'does not consume');
});

Deno.test('R9: publication refuses evidence recorded for the pre-bump SHA', async () => {
  const preBumpSha = 'c'.repeat(40);
  const bumpSha = 'd'.repeat(40);
  const preBump = JSON.parse(record()) as Record<string, unknown>;
  preBump.sha = preBumpSha;
  preBump.artifactName = `${PR_CI_ARTIFACT_PREFIX}${preBumpSha}`;
  await withEvidenceFile(JSON.stringify(preBump), (path) =>
    assertRejects(
      () => resolveReleaseGateSelection(path, bumpSha, []),
      Error,
      'stale or mismatched',
    ));
});
