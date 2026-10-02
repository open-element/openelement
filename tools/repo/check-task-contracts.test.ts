/**
 * check-task-contracts.test.ts — root gate-task contract tripwire.
 *
 * `verify` (full, local) and `verify:core` (the CI-equivalent core) are two
 * definitions of "the full gate" and must stay parallel truth: a green local
 * `verify` certifies exactly what the CI candidate producers run only while
 * its step set covers `verify:core`. `verify:core` is pinned to the source
 * gate plus the packed gate; `verify` must run that same step set plus only
 * the documented local-only extras (fmt/lint via `check`, the unit-test
 * suite via `test`, and the SaaS lanes). Drift on either side fails here
 * before the two definitions silently diverge.
 *
 * The two-tier gate model (CI trim) is pinned here too: `gate:source` is the
 * fast PR-layer subset, and every step trimmed out of it must be reachable
 * from `gate:release` — the release train that `release:check` runs before
 * anything is published. A step that vanished from both gates is the failure
 * this pair of contracts exists to catch.
 */

import { expect, test } from 'vitest';
import { dirname, join } from '@std/path';
import { readFile } from 'node:fs/promises';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');
// The B2 manifest conversion moved the task surface to package.json scripts;
// the gate contracts below read the same three manifests the old deno.json
// files carried.
const rootConfig = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  workspaces?: unknown;
};
const repoConfig = JSON.parse(
  await readFile(join(repoRoot, 'tools/repo/package.json'), 'utf8'),
) as { scripts: Record<string, string> };
const releaseConfig = JSON.parse(
  await readFile(join(repoRoot, 'tools/release/package.json'), 'utf8'),
) as { scripts: Record<string, string> };

const GATE_RUNNER = 'node tools/repo/gate.ts ';

/** The ordered step list a root task hands to the gate coordinator. */
function gateSteps(task: string): string[] {
  const command = rootConfig.scripts[task];
  expect(typeof command === 'string', `root task missing: ${task}`).toBeTruthy();
  expect(
    command.startsWith(GATE_RUNNER),
    `root task ${task} must delegate to the gate coordinator ('${GATE_RUNNER.trim()} ...'), got: ${command}`,
  ).toBeTruthy();
  return command.slice(GATE_RUNNER.length).trim().split(/\s+/);
}

/** The ordered step list a tools/repo gate task hands to the coordinator. */
function repoSplitSteps(task: string): string[] {
  const command = repoConfig.scripts[task];
  expect(typeof command === 'string', `tools/repo task missing: ${task}`).toBeTruthy();
  const prefix = 'node ../../tools/repo/gate.ts ';
  expect(
    command.startsWith(prefix),
    `tools/repo task ${task} must delegate to the gate coordinator ('${prefix.trim()} ...'), got: ${command}`,
  ).toBeTruthy();
  return command.slice(prefix.length).trim().split(/\s+/);
}

const coreSteps = gateSteps('verify:core');

test('task contract: verify:core stays the source gate plus the packed gate', () => {
  expect(
    coreSteps,
    'verify:core is the CI-equivalent core; changing its step set requires updating this contract',
  ).toEqual(['tools/repo#gate:source', 'tools/release#gate:packed']);
});

test('task contract: verify runs every verify:core step', () => {
  const verifySteps = gateSteps('verify');
  for (const step of coreSteps) {
    expect(
      verifySteps.includes(step),
      `verify must run the verify:core step '${step}' — a green local verify must certify the core gate`,
    ).toBeTruthy();
  }
});

test('task contract: verify adds only the documented local-only steps', () => {
  const extras = gateSteps('verify')
    .filter((step) => !coreSteps.includes(step))
    .sort();
  expect(
    extras,
    'verify may only add fmt/lint (check), the unit-test suite (test) and the SaaS lanes on top of verify:core',
  ).toEqual(['check', 'saas:verify', 'saas:workers', 'test']);
});

test('task contract: gate:source is the fast PR-layer step set', () => {
  expect(
    repoSplitSteps('gate:source'),
    'gate:source is what every pull request runs; adding a step to the PR layer needs this contract updated (and a reason it cannot wait for the release train)',
  ).toEqual([
    'tools/repo#generate:all',
    'tools/repo#typecheck',
    'packages/element#test',
    'packages/router#test',
    'tools/repo#lint:markdown',
    'www#check:content-dates',
    'tools/repo#interface:snapshot',
    'tests/fixtures/router-request-time#gate',
    'packages/element#browser:gate',
  ]);
});

test('task contract: packed qualification runs separately from the source gate', () => {
  expect(
    !repoSplitSteps('gate:source').includes('tools/release#gate:packed'),
    'the source producer must not duplicate the independent packed producer',
  ).toBeTruthy();
  expect(
    coreSteps.includes('tools/release#gate:packed'),
    'the local CI equivalent must retain packed qualification',
  ).toBeTruthy();
});

test('task contract: artifact scan consumes the packed gate tarballs exactly once', () => {
  const packed = releaseConfig.scripts['gate:packed'].split(/\s+/);
  const packIndex = packed.indexOf('tools/release#pack:dry-run');
  const scanIndex = packed.indexOf('tools/release#package-artifacts:check:prepacked');
  expect(packIndex >= 0 && scanIndex === packIndex + 1).toBeTruthy();
  expect(
    !packed.includes('tools/release#package-artifacts:check'),
    'the standalone scanner repacks and must not run inside gate:packed',
  ).toBeTruthy();
  expect(
    releaseConfig.scripts['package-artifacts:check:prepacked'].endsWith(
      'tools/release/check-package-artifacts.ts --prepacked',
    ),
  ).toBeTruthy();
  expect(
    releaseConfig.scripts['package-artifacts:check'].endsWith(
      'tools/release/check-package-artifacts.ts',
    ),
    'the standalone scanner still builds its own tarballs',
  ).toBeTruthy();
});

test('task contract: gate:release carries the steps trimmed out of the PR layer', () => {
  const release = repoSplitSteps('gate:release');
  const source = repoSplitSteps('gate:source');
  // Every trimmed step must land in the release train, or the two-tier split
  // silently drops coverage instead of deferring it.
  const required = [
    // Site build and every www check except the content-dates manifest check
    // (which stays in the PR layer: it is cheap and catches an article added
    // without a manifest entry).
    'site:build',
    'www#check:api-reference',
    'www#check:errors',
    'www#check:error-codes',
    'www#check:install-command',
    'www#check:content-data',
    'www#check:article-routes',
    'www#check:nav',
    'www#check:links',
    'www#check:machine-paths',
    'www#check:doc-figures',
    'www#check:theme-tokens',
    'www#check:content',
    'www#check:retired-url',
    'www#e2e:browsers',
    // Coverage.
    'tools/repo#test:coverage:check',
    // Every fixture gate.
    'tests/fixtures/router-static-only#build',
    'tests/fixtures/router-native-framework#gate',
    'tests/fixtures/router-lit-framework#gate',
    'tests/fixtures/router-ui-dogfood#gate',
    'tests/fixtures/site-light-probe#gate',
    'tests/fixtures/web-component-interop#test',
    'tests/e2e/starter-smoke#gate',
    'tests/fixtures/router-nitro#proof:node',
    'tests/fixtures/router-nitro#proof:workers',
    // Boundary/provenance scans. (The former fixtures:locks:check retired
    // with the B2 manifest conversion: one pnpm lock replaced the per-fixture
    // Deno lock universes it guarded.)
    'tools/repo#esm:boundary-check',
    'tools/repo#validation:boundary-check',
    'tools/repo#signals:check-protocol-boundary',
    'tools/repo#assets:check-provenance',
    'tools/repo#workspace:links:check',
    'tools/repo#url-pattern-list:provenance',
    // Retired-api, classification, floor and generator gates.
    'tools/repo#retired-api:check',
    'tools/repo#product:classification:check',
    'tools/repo#deno-floor:check',
    'tools/repo#generator-gates:check',
    // The release train keeps the FULL element browser matrix; the PR layer
    // runs the Chromium subset under the same step name's gate.
    'packages/element#browser:gate:full',
  ];
  for (const step of required) {
    expect(
      release.includes(step),
      `gate:release must run '${step}': it was trimmed out of the PR layer and must not vanish`,
    ).toBeTruthy();
  }
  for (const step of release) {
    // Both layers generate first: gate:release's www checks import the
    // generated data, so the generator entrypoint is the one documented
    // shared step — everything else must stay in exactly one layer.
    if (step === 'tools/repo#generate:all') continue;
    expect(
      !source.includes(step),
      `'${step}' appears in both gates; the PR layer must stay the fast subset`,
    ).toBeTruthy();
  }
});

test('task contract: release:check is the release train plus the packed gate', () => {
  expect(
    gateSteps('release:check'),
    'release:check is what qualifies a release candidate on a clean checkout; ' +
      'it must generate the derived site data the registry check reads, then ' +
      'include the trimmed gate:release steps',
  ).toEqual([
    // First, and explicitly before release:registry-check: that step reads
    // the ignored derived module www/app/data/_generated-release-line.ts
    // (check-release-state-machine.ts), which only generate:all
    // materializes on a clean checkout — the release workflow starts from
    // one, so generating later (or not first) fails the run pre-publish.
    'tools/repo#generate:all',
    'tools/repo#release:registry-check',
    'tools/repo#gate:release',
    'tools/release#gate:packed',
    'tools/release#publish:npm:dry-run',
  ]);
});

test('task contract: fmt/lint run the ox engines and deno fmt/lint stays retired', async () => {
  // The format/lint engine is pinned once, here: fmt:check must stay the
  // check-mode spelling of fmt, and lint must be the oxlint CLI. A change to
  // any of these bodies is an engine swap and must update this contract.
  expect(rootConfig.scripts['fmt'], 'fmt is oxfmt in write mode').toEqual('oxfmt');
  expect(rootConfig.scripts['fmt:check'], 'fmt:check is oxfmt check mode').toEqual('oxfmt --check');
  expect(rootConfig.scripts['lint'], 'lint is the oxlint CLI').toEqual('oxlint');
  // The retired deno fmt/deno lint engines must not survive in any
  // workspace script body: a script silently re-adding them would split the
  // repository across two formatters/linters with diverging style and rules.
  const manifests = [
    join(repoRoot, 'package.json'),
    join(repoRoot, 'tools/repo/package.json'),
    join(repoRoot, 'tools/release/package.json'),
    join(repoRoot, 'packages/element/package.json'),
    join(repoRoot, 'packages/router/package.json'),
    join(repoRoot, 'packages/create/package.json'),
    join(repoRoot, 'packages/ui/package.json'),
    join(repoRoot, 'www/package.json'),
    join(repoRoot, 'apps/saas/package.json'),
  ];
  for (const manifest of manifests) {
    const config = JSON.parse(await readFile(manifest, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    for (const [name, command] of Object.entries(config.scripts ?? {})) {
      expect(
        !/(^|\s)deno (fmt|lint)(\s|'|$)/.test(command),
        `${manifest} script '${name}' shells out to the retired deno fmt/deno lint engine: ${command}`,
      ).toBeTruthy();
    }
  }
});
