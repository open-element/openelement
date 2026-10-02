/**
 * Fail-closed configuration smoke for the element browser suite: the configs
 * below must make the runner exit NON-ZERO. It proves the suite's own wiring
 * — the zero-tests-guard reporter in web-test-runner.config.js, which encodes
 * the OpenElement exit contract that a run executing zero tests is a failure,
 * never a silent pass.
 *
 * (Written as a script because deno-task shell has no for-loops.)
 *
 * Run from the repo root: deno task --cwd packages/element browser:negative
 */
const WTR_DIR = new URL('..', import.meta.url).pathname;
import { commandOutput } from '../../../../tools/repo/node-command.ts';
import process from 'node:process';

const CONFIGS = [
  'failing-assertion',
  'missing-browser',
  'broken-transform',
  'zero-tests',
  'no-matching-files',
];

let failed = 0;
for (const name of CONFIGS) {
  const status = await commandOutput('npx', {
    args: ['web-test-runner', '--config', `negative/${name}.config.js`],
    cwd: WTR_DIR,
    stdout: 'piped',
    stderr: 'piped',
  });
  if (status.code === 0) {
    failed += 1;
    console.error(`FAIL-CLOSED SMOKE BROKEN: ${name} exited 0 (expected non-zero)`);
  } else {
    console.log(`fail-closed smoke ok (exit ${status.code}): ${name}`);
  }
}
if (failed > 0) {
  console.error(`${failed} fail-closed smoke(s) broken`);
  process.exit(1);
}
console.log(`all ${CONFIGS.length} fail-closed smoke(s) held`);
