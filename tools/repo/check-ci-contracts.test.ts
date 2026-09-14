/**
 * check-ci-contracts.test.ts — CI required/optional contract tripwire.
 *
 * Bun is a non-blocking compatibility signal, never a gate: if a workflow
 * edit drops `continue-on-error` from bun-serve-smoke (or promotes it into
 * the required set), this test fails before the policy silently changes.
 * Conversely the required jobs (autoflow-ci, node-serve-smoke,
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

Deno.test('ci contract: bun-serve-smoke is explicitly non-blocking', () => {
  const block = jobBlock(workflow, 'bun-serve-smoke');
  assert(
    /continue-on-error:\s*true/.test(block),
    'bun-serve-smoke must carry job-level continue-on-error: true (Bun is optional, never a gate)',
  );
});

Deno.test('ci contract: required jobs stay blocking', () => {
  for (const job of ['autoflow-ci', 'node-serve-smoke', 'packed-consumer-matrix']) {
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
      '.artifacts/fresh-clone-manifest.json',
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

Deno.test('ci contract: packed-consumer matrix pins all three release OSes', () => {
  const block = jobBlock(workflow, 'packed-consumer-matrix');
  assert(
    /ubuntu-latest/.test(block) && /macos-latest/.test(block) && /windows-latest/.test(block),
    'packed-consumer-matrix must stay Linux/macOS/Windows required',
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

Deno.test('ci contract: release docs never present Bun as required', () => {
  const flat = releasing.replace(/\s+/g, ' ');
  assert(
    /bun-serve-smoke[^.]{0,200}optional\/non-blocking/i.test(flat) ||
      /optional\/non-blocking[^.]{0,200}bun-serve-smoke/i.test(flat),
    'releasing.md must mark bun-serve-smoke optional/non-blocking',
  );
  const requiredLine = releasing.split('\n').find((line) => line.includes('branch protection'));
  assertEquals(
    requiredLine?.includes('bun-serve-smoke'),
    false,
    'bun-serve-smoke must not appear in the required branch-protection list',
  );
});
