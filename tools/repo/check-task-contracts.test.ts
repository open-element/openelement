/**
 * check-task-contracts.test.ts — root gate-task contract tripwire.
 *
 * `verify` (local) and `gate:ci` (what the CI candidate run executes) are
 * two definitions of "the full gate" and must stay parallel truth: a green
 * local `verify` certifies exactly what CI runs only while its step set
 * covers `gate:ci`. `gate:ci` is pinned to the source gate plus the packed
 * gate; `verify` must run that same step set plus only the documented
 * local-only extras (fmt/lint via `check`, the unit-test suite via `test`,
 * and the SaaS lanes). Drift on either side fails here before the two
 * definitions silently diverge.
 *
 * The two-tier gate model (CI trim) is pinned here too: `gate:source` is the
 * fast PR-layer subset, and every step trimmed out of it must be reachable
 * from `gate:release` — the release train that `release:check` runs before
 * anything is published. A step that vanished from both gates is the failure
 * this pair of contracts exists to catch.
 */

import { assert, assertEquals } from '@std/assert';
import { dirname, join } from '@std/path';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const rootConfig = JSON.parse(
  await Deno.readTextFile(join(repoRoot, 'deno.json')),
) as { tasks: Record<string, string> };
const repoConfig = JSON.parse(
  await Deno.readTextFile(join(repoRoot, 'tools/repo/deno.json')),
) as { tasks: Record<string, string> };
const releaseConfig = JSON.parse(
  await Deno.readTextFile(join(repoRoot, 'tools/release/deno.json')),
) as { tasks: Record<string, string> };

const GATE_RUNNER = 'deno run --allow-run tools/repo/gate.ts ';

/** The ordered step list a root task hands to the gate coordinator. */
function gateSteps(task: string): string[] {
  const command = rootConfig.tasks[task];
  assert(typeof command === 'string', `root task missing: ${task}`);
  assert(
    command.startsWith(GATE_RUNNER),
    `root task ${task} must delegate to the gate coordinator ('${GATE_RUNNER.trim()} ...'), got: ${command}`,
  );
  return command.slice(GATE_RUNNER.length).trim().split(/\s+/);
}

/** The ordered step list a tools/repo gate task hands to the coordinator. */
function repoSplitSteps(task: string): string[] {
  const command = repoConfig.tasks[task];
  assert(typeof command === 'string', `tools/repo task missing: ${task}`);
  const prefix = 'deno run --allow-run ./gate.ts ';
  assert(
    command.startsWith(prefix),
    `tools/repo task ${task} must delegate to the gate coordinator ('${prefix.trim()} ...'), got: ${command}`,
  );
  return command.slice(prefix.length).trim().split(/\s+/);
}

const gateCiSteps = gateSteps('gate:ci');

Deno.test('task contract: gate:ci stays the source gate plus the packed gate', () => {
  assertEquals(
    gateCiSteps,
    ['tools/repo#gate:source', 'tools/release#gate:packed'],
    'gate:ci defines what CI certifies; changing its step set requires updating this contract',
  );
});

Deno.test('task contract: verify runs every gate:ci step', () => {
  const verifySteps = gateSteps('verify');
  for (const step of gateCiSteps) {
    assert(
      verifySteps.includes(step),
      `verify must run the gate:ci step '${step}' — a green local verify must certify what CI runs`,
    );
  }
});

Deno.test('task contract: verify adds only the documented local-only steps', () => {
  const extras = gateSteps('verify').filter((step) => !gateCiSteps.includes(step)).sort();
  assertEquals(
    extras,
    ['check', 'saas:verify', 'saas:workers', 'test'],
    'verify may only add fmt/lint (check), the unit-test suite (test) and the SaaS lanes on top of gate:ci',
  );
});

Deno.test('task contract: gate:source is the fast PR-layer step set', () => {
  assertEquals(
    repoSplitSteps('gate:source'),
    [
      'tools/repo#generate:all',
      'tools/repo#typecheck',
      'packages/element#test',
      'packages/router#test',
      'tools/repo#lint:markdown',
      'www#check:content-dates',
      'tools/repo#interface:snapshot',
      'tests/fixtures/router-request-time#gate',
      'packages/element#browser:gate',
    ],
    'gate:source is what every pull request runs; adding a step to the PR layer needs this contract updated (and a reason it cannot wait for the release train)',
  );
});

Deno.test('task contract: packed qualification runs separately from the source gate', () => {
  assert(
    !repoSplitSteps('gate:source').includes('tools/release#gate:packed'),
    'the source producer must not duplicate the independent packed producer',
  );
  assert(
    gateCiSteps.includes('tools/release#gate:packed'),
    'the local CI equivalent must retain packed qualification',
  );
});

Deno.test('task contract: artifact scan consumes the packed gate tarballs exactly once', () => {
  const packed = releaseConfig.tasks['gate:packed'].split(/\s+/);
  const packIndex = packed.indexOf('tools/release#pack:dry-run');
  const scanIndex = packed.indexOf('tools/release#package-artifacts:check:prepacked');
  assert(packIndex >= 0 && scanIndex === packIndex + 1);
  assert(
    !packed.includes('tools/release#package-artifacts:check'),
    'the standalone scanner repacks and must not run inside gate:packed',
  );
  assert(
    releaseConfig.tasks['package-artifacts:check:prepacked'].endsWith(
      'tools/release/check-package-artifacts.ts --prepacked',
    ),
  );
  assert(
    releaseConfig.tasks['package-artifacts:check'].endsWith(
      'tools/release/check-package-artifacts.ts',
    ),
    'the standalone scanner still builds its own tarballs',
  );
});

Deno.test('task contract: gate:release carries the steps trimmed out of the PR layer', () => {
  const release = repoSplitSteps('gate:release');
  const source = repoSplitSteps('gate:source');
  // Every trimmed step must land in the release train, or the two-tier split
  // silently drops coverage instead of deferring it.
  const required = [
    // Site build and every www check except the content-dates timing trap
    // (which stays in the PR layer: it is cheap and catches a ritual mistake).
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
    // Boundary/provenance scans.
    'tools/repo#esm:boundary-check',
    'tools/repo#deno-api:check',
    'tools/repo#validation:boundary-check',
    'tools/repo#signals:check-protocol-boundary',
    'tools/repo#assets:check-provenance',
    'tools/repo#fixtures:locks:check',
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
    assert(
      release.includes(step),
      `gate:release must run '${step}': it was trimmed out of the PR layer and must not vanish`,
    );
  }
  for (const step of release) {
    // Both layers generate first: gate:release's www checks import the
    // generated data, so the generator entrypoint is the one documented
    // shared step — everything else must stay in exactly one layer.
    if (step === 'tools/repo#generate:all') continue;
    assert(
      !source.includes(step),
      `'${step}' appears in both gates; the PR layer must stay the fast subset`,
    );
  }
});

Deno.test('task contract: release:check is the release train plus the packed gate', () => {
  assertEquals(
    gateSteps('release:check'),
    [
      'tools/repo#release:registry-check',
      'tools/repo#gate:release',
      'tools/release#gate:packed',
      'tools/release#publish:npm:dry-run',
    ],
    'release:check is what qualifies a release candidate; it must include the trimmed gate:release steps',
  );
});
