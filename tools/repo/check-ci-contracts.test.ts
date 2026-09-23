/**
 * check-ci-contracts.test.ts — CI required/optional contract tripwire.
 *
 * The required jobs (autoflow-ci, node-serve-smoke,
 * packed-consumer-matrix) must stay blocking, and the packed-consumer
 * matrix must install all three packed-gate browsers.
 */

import { assert, assertEquals } from '@std/assert';
import { dirname, join } from '@std/path';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const workflow = await Deno.readTextFile(join(repoRoot, '.github/workflows/autoflow-ci.yml'));
const releasing = await Deno.readTextFile(join(repoRoot, 'docs/maintainers/releasing.md'));
const dependencyAudit = await Deno.readTextFile(
  join(repoRoot, '.github/workflows/dependency-audit.yml'),
);

/** Extract one top-level job block (two-space `name:` jobs) by job key. */
function jobBlock(text: string, job: string): string {
  const start = text.indexOf(`\n  ${job}:`);
  assert(start >= 0, `workflow job missing: ${job}`);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

Deno.test('ci contract: required jobs stay blocking', () => {
  for (
    const job of ['autoflow-ci', 'node-serve-smoke', 'packed-consumer-matrix', 'bfcache-chrome']
  ) {
    const block = jobBlock(workflow, job);
    assert(
      !/continue-on-error:\s*true/.test(block),
      `required job ${job} must not carry continue-on-error: true`,
    );
  }
});

Deno.test('ci contract: packed-consumer matrix installs all three packed-gate browsers', () => {
  const block = jobBlock(workflow, 'packed-consumer-matrix');
  assert(
    /playwright install[^\n]*chromium[^\n]*firefox[^\n]*webkit/.test(block),
    'packed-consumer-matrix must install chromium+firefox+webkit for the packed gates',
  );
});

Deno.test('ci contract: dependency-review runs on pull requests', () => {
  assert(
    /pull_request:/.test(workflow),
    'autoflow-ci must trigger on pull_request for dependency review',
  );
  const block = jobBlock(workflow, 'dependency-review');
  assert(
    /github\.event_name\s*==\s*['"]pull_request['"]/.test(block),
    'dependency-review must be gated to pull_request events',
  );
  assert(
    /dependency-review-action@/.test(block),
    'dependency-review must run the dependency review action',
  );
});

Deno.test('ci contract: node serve smoke pins the required Node matrix', () => {
  const block = jobBlock(workflow, 'node-serve-smoke');
  assert(
    /'24'/.test(block) && /'26'/.test(block),
    'node-serve-smoke must pin the required Node 24/26 matrix',
  );
});

Deno.test('ci contract: execution jobs are separate from evidence aggregation', () => {
  const producers: Array<[string, RegExp]> = [
    ['fast-checks', /candidate:evidence:fast/],
    ['source-matrix', /candidate:evidence:source/],
    ['packed-consumers', /candidate:evidence:packed/],
    ['fresh-clone', /candidate:evidence:fresh/],
  ];
  for (const [job, command] of producers) {
    const block = jobBlock(workflow, job);
    assert(command.test(block), `${job} must run its own evidence slice`);
    assert(
      /actions\/upload-artifact@/.test(block),
      `${job} must upload its result + logs artifact`,
    );
  }
  const aggregate = jobBlock(workflow, 'autoflow-ci');
  assert(
    /needs:\s*\[[^\]]*fast-checks[^\]]*source-matrix[^\]]*packed-consumers[^\]]*fresh-clone/.test(
      aggregate,
    ),
    'autoflow-ci must depend on every producer job',
  );
  assert(
    /candidate:evidence:aggregate/.test(aggregate) && /candidate:evidence:validate/.test(aggregate),
    'autoflow-ci must aggregate and validate, never recompute',
  );
  const rerunForbidden = aggregate
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  for (const rerun of ['gate:source', 'gate:packed', 'publish:npm:dry-run', 'deno task check']) {
    assert(
      !rerunForbidden.includes(rerun),
      `autoflow-ci aggregation must not re-run the suite: found ${rerun}`,
    );
  }
  assert(
    /actions\/download-artifact@/.test(aggregate),
    'autoflow-ci must read the producer artifacts',
  );
});

Deno.test('ci contract: every evidence producer installs the recorded browsers', () => {
  for (const job of ['fast-checks', 'source-matrix', 'packed-consumers', 'fresh-clone']) {
    const block = jobBlock(workflow, job);
    assert(
      /playwright install[^\n]*chromium[^\n]*firefox[^\n]*webkit/.test(block),
      `${job} must install chromium+firefox+webkit before recording toolVersions`,
    );
  }
});

Deno.test('ci contract: candidate evidence bundle ships JSON and every log/manifest', () => {
  const aggregate = jobBlock(workflow, 'autoflow-ci');
  assert(
    /name:\s*candidate-evidence-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/.test(
      aggregate,
    ),
    'the candidate artifact name must stay SHA/run-bound',
  );
  for (
    const path of [
      '.artifacts/candidate-evidence.json',
      '.artifacts/tarball-manifest.json',
      '.artifacts/pack-diagnostics.json',
      '.artifacts/tarballs',
      '.artifacts/ci',
    ]
  ) {
    assert(aggregate.includes(path), `candidate artifact must include ${path}`);
  }
  assert(
    /retention-days:\s*14/.test(aggregate) &&
      /retention-days:\s*14/.test(jobBlock(workflow, 'fresh-clone')),
    'evidence retention must stay 14 days and match the release window',
  );
});

Deno.test('ci contract: release workflow permissions cover its GitHub API use', async () => {
  const releasing = await Deno.readTextFile(
    join(repoRoot, '.github/workflows/autoflow-release.yml'),
  );
  // With an explicit permissions map, unlisted scopes are none. The release
  // job calls `gh run list/view/download`, which needs Actions read.
  assert(
    /actions:\s*read/.test(releasing),
    'release must grant actions: read to read workflow runs and artifacts',
  );
  assert(
    /contents:\s*read/.test(releasing),
    'release must keep contents: read',
  );
  assert(
    /id-token:\s*write/.test(releasing),
    'release must keep id-token: write for npm Trusted Publishing',
  );
  const writeScopes = [...releasing.matchAll(/^\s{6}([a-z-]+):\s*write\s*$/gm)].map((m) => m[1]);
  assertEquals(
    writeScopes.sort(),
    ['id-token'],
    'only id-token may be a write scope in the release job',
  );
  assert(
    /gh run list/.test(releasing) && /gh run download/.test(releasing),
    'the API-scope contract test assumes the release job reads runs/artifacts',
  );
});

Deno.test('ci contract: release consumes the bound, non-expired CI artifact', async () => {
  const releasingWorkflow = await Deno.readTextFile(
    join(repoRoot, '.github/workflows/autoflow-release.yml'),
  );
  assert(
    /gh run list[^]*--commit "\$CANDIDATE_SHA"[^]*--status success/.test(releasingWorkflow),
    'release must require a successful CI run for the exact candidate SHA',
  );
  assert(
    /gh run download[^]*--pattern 'candidate-evidence-\*'/.test(releasingWorkflow),
    'release must download the candidate evidence artifact',
  );
  assert(
    /candidate-evidence\.ts[^]*--validate/.test(releasingWorkflow),
    'release must validate the downloaded evidence by recomputing hashes',
  );
  assert(
    /age_days[^\n]*14/.test(releasingWorkflow),
    'release must refuse evidence older than the retention window',
  );
  assert(
    !/pull_request_target/.test(releasingWorkflow) && /workflow_dispatch/.test(releasingWorkflow),
    'release stays workflow_dispatch only and never runs on untrusted PR events',
  );
});

Deno.test('ci contract: post-publish consumers are chained, not manual-only', async () => {
  const releasing = await Deno.readTextFile(
    join(repoRoot, '.github/workflows/autoflow-release.yml'),
  );
  const published = await Deno.readTextFile(
    join(repoRoot, '.github/workflows/published-consumers.yml'),
  );
  assert(
    /workflow_call:/.test(published),
    'published-consumers must expose workflow_call so release can chain it',
  );
  const postPublish = jobBlock(releasing, 'post-publish-consumers');
  assert(
    /needs:\s*release/.test(postPublish) && /if:\s*inputs\.publish/.test(postPublish),
    'post-publish-consumers must run after a real publish',
  );
  assert(
    /uses:\s*\.\/\.github\/workflows\/published-consumers\.yml/.test(postPublish),
    'post-publish-consumers must call the published-consumers workflow',
  );
});

Deno.test('ci contract: packed-consumer matrix pins the two release OSes', () => {
  const block = jobBlock(workflow, 'packed-consumer-matrix');
  assert(
    /ubuntu-latest/.test(block) && /macos-latest/.test(block),
    'packed-consumer-matrix must stay Linux/macOS required',
  );
  assert(
    !/windows-latest/.test(block),
    'Windows is out of scope for the candidate: deno pack drops the Router ./vite types condition there (upstream), and the deploy targets are Linux/Workers',
  );
});

Deno.test('ci contract: Deno dependencies are audited, never auto-merged', () => {
  assert(
    /contents:\s*read/.test(dependencyAudit),
    'dependency-audit must stay read-only',
  );
  assert(
    /deno outdated/.test(dependencyAudit) && /deno audit/.test(dependencyAudit),
    'dependency-audit must run the Deno outdated and vulnerability audits',
  );
  assert(
    !/pull_request_target/.test(dependencyAudit) &&
      !/auto-merge|dependabot\[bot\][^\n]*merge/i.test(dependencyAudit),
    'dependency-audit must never auto-merge or run on pull_request_target',
  );
});

Deno.test('ci contract: BFCache runs a blocking Chrome-channel lane', async () => {
  const block = jobBlock(workflow, 'bfcache-chrome');
  assert(block.length > 0, 'bfcache-chrome job must exist');
  assertEquals(
    /continue-on-error:\s*true/.test(block),
    false,
    'the BFCache lane must be blocking, not optional',
  );
  assert(
    block.includes('playwright install chrome'),
    'the BFCache lane must install the Chrome channel',
  );
  assert(
    block.includes('test:bfcache'),
    'the BFCache lane must run the chrome-bfcache project task',
  );
  // The official three-browser Site matrix is a release-train step: it must
  // stay wired into gate:release (the trimmed PR layer no longer builds or
  // drives the Site) and the PR-layer fresh-clone lane must keep producing
  // the Site E2E sidecar that the required candidate evidence requires.
  const repoConfig = JSON.parse(
    await Deno.readTextFile(join(repoRoot, 'tools/repo/deno.json')),
  ) as { tasks: Record<string, string> };
  assert(
    repoConfig.tasks['gate:release'].includes('www#e2e:browsers'),
    'gate:release must run the three-browser Site E2E matrix',
  );
  assert(
    !repoConfig.tasks['gate:source'].includes('www#e2e:browsers'),
    'the PR layer must not run the three-browser Site matrix (it is a release-train step)',
  );
  const freshClone = jobBlock(workflow, 'fresh-clone');
  assert(
    freshClone.includes('candidate:evidence:fresh'),
    'the fresh-clone lane records the candidate Site E2E sidecar',
  );
  const candidateSteps = await Deno.readTextFile(
    join(repoRoot, 'tools/repo/candidate-steps.ts'),
  );
  assert(
    /name:\s*'task-site-e2e'/.test(candidateSteps) &&
      /name:\s*'task-site-build'/.test(candidateSteps),
    'the fresh-clone contract must pin the Site build and Site E2E steps that produce the sidecar',
  );
});

Deno.test('ci contract: Site E2E evidence is owned by the fresh-clone lane', async () => {
  const evidence = await Deno.readTextFile(join(repoRoot, 'tools/repo/candidate-evidence.ts'));
  assert(
    /SITE_E2E_REPORT_BUNDLE_PATH\s*=\s*`ci\/fresh-clone\//.test(evidence),
    'the raw Site E2E report must travel in the fresh-clone evidence tree',
  );
  assert(
    /jobs\.find\(\(\{ job \}\) => job\.job === 'fresh-clone'\)[\s\S]{0,200}siteE2e/.test(evidence),
    'aggregation must read the Site E2E sidecar from the fresh-clone job',
  );
  assert(
    !/job === 'source-matrix'[\s\S]{0,40}sourceExtras/.test(evidence),
    'the source-matrix producer must no longer stage Site E2E evidence',
  );
  // The trimmed PR gate must not lose the Site proof outright: the release
  // train still runs the official suite, and the sidecar is recomputed.
  assert(
    /auditSiteE2e\(rollup\.siteE2e\)/.test(evidence),
    'the Site E2E audit must stay wired into the rollup',
  );
});

Deno.test('ci contract: SaaS is decoupled from the core candidate gate', async () => {
  const repoConfig = JSON.parse(
    await Deno.readTextFile(join(repoRoot, 'tools/repo/deno.json')),
  ) as { tasks: Record<string, string> };
  const gateSource = repoConfig.tasks['gate:source'];
  for (const token of ['saas:verify', 'apps/saas', 'workers:boundary-check']) {
    assert(!gateSource.includes(token), `gate:source must not include SaaS step ${token}`);
  }
  // The framework core still proves deploy output through the Router fixture —
  // on the release train, where the deploy-proof steps now live. It must not
  // be in neither gate.
  const gateRelease = repoConfig.tasks['gate:release'];
  for (
    const step of [
      'tests/fixtures/router-nitro#proof:workers',
      'tests/fixtures/router-nitro#proof:node',
    ]
  ) {
    assert(
      gateRelease.includes(step),
      `the Router deploy proof '${step}' must remain wired into gate:release`,
    );
    assert(!gateSource.includes(step), `'${step}' is a release-train step, not a PR-layer one`);
  }
  for (const gate of [gateSource, gateRelease]) {
    for (const token of ['saas:verify', 'apps/saas', 'workers:boundary-check']) {
      assert(!gate.includes(token), `no candidate gate may include SaaS step ${token}`);
    }
  }

  const rootConfig = JSON.parse(await Deno.readTextFile(join(repoRoot, 'deno.json'))) as {
    tasks: Record<string, string>;
  };
  assert(rootConfig.tasks['verify:core'], 'root verify:core must exist');
  assert(!rootConfig.tasks['verify:core'].toLowerCase().includes('saas'));
  assert(rootConfig.tasks['verify'].includes('saas:verify'), 'full verify keeps SaaS');
});

Deno.test('ci contract: partial publish receipts are persisted as recovery records', async () => {
  const releasing = await Deno.readTextFile(
    join(repoRoot, '.github/workflows/autoflow-release.yml'),
  );
  const block = releasing.slice(releasing.indexOf('Upload release receipt'));
  assert(
    /if:\s*\$\{\{\s*always\(\)\s*&&\s*inputs\.publish\s*\}\}/.test(block),
    'the receipt upload must run on always() when publishing',
  );
  assert(
    /path:\s*\.artifacts\/release-receipt\.json/.test(block),
    'the receipt upload must target exactly .artifacts/release-receipt.json',
  );
  assert(
    !/path:\s*\.artifacts\/?\s*$/m.test(block),
    'the receipt upload must not upload the whole .artifacts tree',
  );
  assert(
    /release-receipt-\$\{\{\s*inputs\.candidate_sha\s*\}\}-\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}/
      .test(block),
    'the receipt artifact name must bind the candidate SHA and run id/attempt',
  );
  assert(
    /if-no-files-found:\s*error/.test(block),
    'a publish run with no receipt must fail closed',
  );

  const publish = await Deno.readTextFile(join(repoRoot, 'tools/release/publish-npm.ts'));
  assert(
    /receipt\.result !== 'published'[\s\S]{0,40}Deno\.exit\(1\)/.test(publish),
    'a partial/failed publish must exit non-zero',
  );
});

Deno.test('ci contract: the requeue companion re-runs a failed CI run exactly once', async () => {
  // #1409: webkit fails deterministically PER RUNNER, so the only retry that
  // can change the outcome is a re-run on fresh runners — and exactly one of
  // them, or a genuine failure would be retried forever.
  const requeue = await Deno.readTextFile(
    join(repoRoot, '.github/workflows/requeue-once.yml'),
  );
  assert(
    /workflow_run:/.test(requeue) && /workflows:\s*\['AutoFlow CI'\]/.test(requeue),
    'the requeue must trigger on the AutoFlow CI workflow_run event',
  );
  assert(
    /types:\s*\[completed\]/.test(requeue),
    'the requeue must wait for completion: an in-progress run cannot be re-run',
  );
  assert(
    /conclusion\s*==\s*'failure'/.test(requeue),
    'only a failed run may be requeued',
  );
  assert(
    /run_attempt\s*==\s*1/.test(requeue),
    'only attempt 1 may be requeued; a second failure is the verdict',
  );
  assert(
    /rerun-failed-jobs/.test(requeue),
    'the requeue must call the rerun-failed-jobs endpoint',
  );
  // Scope discipline: actions: write is the whole point, and nothing else.
  const writeScopes = [...requeue.matchAll(/^\s{4,6}([a-z-]+):\s*write\s*$/gm)].map((m) => m[1]);
  assertEquals(writeScopes, ['actions'], 'only actions may be a write scope');
  assert(requeue.includes('contents: read'), 'the requeue must keep contents: read');
});

Deno.test('ci contract: the nightly JFB workflow measures, never gates', async () => {
  const nightly = await Deno.readTextFile(
    join(repoRoot, '.github/workflows/jfb-nightly.yml'),
  );
  assert(
    /continue-on-error:\s*true/.test(nightly),
    'benchmark numbers move with the runner; a nightly measurement must not gate anything',
  );
  assert(nightly.includes('contents: read'), 'the nightly benchmark workflow is read-only');
  assert(
    /benchmarks\/jfb\/harness\/build\.ts/.test(nightly) &&
      /benchmarks\/jfb\/harness\/run\.ts/.test(nightly),
    'the nightly must run the real harness build and runner',
  );
  assert(
    /actions\/upload-artifact@/.test(nightly) && /jfb-evidence\.json/.test(nightly),
    'the nightly must publish the redacted evidence record as an artifact',
  );
  assert(
    /playwright install[^\n]*chromium/.test(nightly),
    'the nightly must install the browser the harness drives',
  );
  assert(!/pull_request/.test(nightly), 'a nightly measurement never runs on pull requests');
});

Deno.test('ci contract: tree-SHA evidence reuse is fail-closed and single-source', async () => {
  // #1425 follow-up: the four producer lanes may replay a tree-identical
  // package instead of re-running their gates. The safety properties are
  // structural, so they are pinned here rather than left to review.
  const reuse = jobBlock(workflow, 'reuse');
  assert(
    /actions:\s*read/.test(reuse),
    'the resolver needs actions: read to list runs and their artifacts',
  );
  assert(
    !/actions:\s*write/.test(reuse) && !/contents:\s*write/.test(reuse),
    'the resolver must stay read-only',
  );
  for (const output of ['reused', 'source_run_id', 'source_sha', 'tree']) {
    assert(
      new RegExp(`^\\s{6}${output}:`, 'm').test(reuse),
      `the reuse job must expose the '${output}' output the lanes consume`,
    );
  }

  // Every producer lane depends on the decision, and each lane's gate runs
  // unless the claim actually stamped a record. A lane that ran its gate but
  // claimed reused evidence (or vice versa) would fail the aggregate's tree
  // identity check.
  //
  // The claim is deliberately non-fatal and runs BEFORE the gate (#1439): a
  // refused claim means "run the gate", never "fail the lane". The gate is
  // therefore skipped only on `reused == 'true' && claim succeeded`, and every
  // lane must carry a cleanup step that discards the unclaimable download
  // before the fallback gate starts.
  const lanes: Array<[string, string]> = [
    ['fast-checks', 'candidate:evidence:fast'],
    ['source-matrix', 'candidate:evidence:source'],
    ['packed-consumers', 'candidate:evidence:packed'],
    ['fresh-clone', 'candidate:evidence:fresh'],
  ];
  for (const [job, task] of lanes) {
    const block = jobBlock(workflow, job);
    assert(
      /needs:\s*reuse\b/.test(block) || /needs:\s*\[.*\breuse\b.*\]/.test(block),
      `${job} must depend on the reuse decision`,
    );
    const taskIndex = block.indexOf(task);
    assert(taskIndex >= 0, `${job} must run its evidence task`);
    // The gate step's `if:` guard sits between the previous step and the run.
    const head = block.slice(0, taskIndex);
    const lastIf = head.lastIndexOf('if:');
    assert(
      lastIf >= 0 &&
        /needs\.reuse\.outputs\.reused\s*!=\s*'true'\s*\|\|\s*steps\.claim\.outcome\s*!=\s*'success'/
          .test(head.slice(lastIf)),
      `${job}'s gate must run unless the decision AND the claim both succeeded`,
    );
    // The claim is present, guarded to the reused branch, and NON-FATAL: a
    // refusal must fall through to the gate instead of failing the lane.
    assert(
      /claim-reused-evidence/.test(block),
      `${job} must claim the reused artifact in the reuse branch`,
    );
    const claimIndex = block.indexOf('claim-reused-evidence');
    const claimHead = block.slice(0, claimIndex);
    // The step's own keys: from its `- name:` line to its `uses:` line.
    const claimStepStart = claimHead.lastIndexOf('\n      - ');
    const claimStep = claimHead.slice(claimStepStart);
    assert(
      claimStepStart >= 0 && /if:\s*needs\.reuse\.outputs\.reused\s*==\s*'true'/.test(claimStep),
      `${job}'s claim must run only when the decision says reuse`,
    );
    assert(
      /continue-on-error:\s*true/.test(claimStep),
      `${job}'s claim must be non-fatal so a refusal falls back to the gate`,
    );
    assert(
      /id:\s*claim\b/.test(claimStep),
      `${job}'s claim must carry the step id the gate's fallback condition reads`,
    );
    // The rejected download must be removed before the fallback gate runs:
    // otherwise another run's files (or a stale artifact) reach this lane's
    // evidence upload.
    assert(
      /steps\.claim\.outcome\s*!=\s*'success'/.test(block) &&
        /rm -rf \.artifacts\/ci/.test(block),
      `${job} must discard the unclaimable download before its fallback gate`,
    );
  }

  // The claim must download the SOURCE run's artifact and stamp it through the
  // audited tool, never by hand.
  const claim = await Deno.readTextFile(
    join(repoRoot, '.github/actions/claim-reused-evidence/action.yml'),
  );
  assert(
    /run-id:\s*\$\{\{\s*inputs\.source-run-id\s*\}\}/.test(claim),
    'the claim must download from the resolved source run',
  );
  assert(
    /candidate:evidence:reuse:claim/.test(claim),
    'the claim must stamp through the audited tool',
  );

  // The aggregate must wait for the decision rather than race it, and the
  // released bundle keeps proving the tree the package was produced for.
  const aggregate = jobBlock(workflow, 'autoflow-ci');
  assert(
    /needs:\s*\[reuse,/.test(aggregate),
    'the aggregate must wait for the reuse decision instead of racing it',
  );
  assert(
    /candidate:evidence:reuse:resolve/.test(reuse) &&
      /candidate:evidence:reuse:claim/.test(claim),
    'both reuse tasks must be wired to their tools',
  );
  const repoConfig = JSON.parse(
    await Deno.readTextFile(join(repoRoot, 'tools/repo/deno.json')),
  ) as { tasks: Record<string, string> };
  for (const task of ['candidate:evidence:reuse:resolve', 'candidate:evidence:reuse:claim']) {
    assert(repoConfig.tasks[task] !== undefined, `${task} must exist as a task`);
  }
});
