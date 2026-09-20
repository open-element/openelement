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
 */

import { assert, assertEquals } from '@std/assert';
import { dirname, join } from '@std/path';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const rootConfig = JSON.parse(
  await Deno.readTextFile(join(repoRoot, 'deno.json')),
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
