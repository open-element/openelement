/**
 * Fail-closed configuration smoke for the element browser suite: the config
 * below must make the runner exit NON-ZERO. It proves the suite's own wiring
 * — the zero-tests-guard reporter in web-test-runner.config.mjs, which encodes
 * the OpenElement exit contract that a run executing zero tests is a failure,
 * never a silent pass.
 *
 * (Written as a script because deno-task shell has no for-loops.)
 *
 * Run from the repo root: deno task test:element:browser:negative
 */
const WTR_DIR = new URL('..', import.meta.url).pathname;
const CONFIGS = [
  'zero-tests',
];

let failed = 0;
for (const name of CONFIGS) {
  const status = await new Deno.Command('npx', {
    args: ['web-test-runner', '--config', `negative/${name}.config.mjs`],
    cwd: WTR_DIR,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (status.code === 0) {
    failed += 1;
    console.error(`FAIL-CLOSED SMOKE BROKEN: ${name} exited 0 (expected non-zero)`);
  } else {
    console.log(`fail-closed smoke ok (exit ${status.code}): ${name}`);
  }
}
if (failed > 0) {
  console.error(`${failed} fail-closed smoke(s) broken`);
  Deno.exit(1);
}
console.log(`all ${CONFIGS.length} fail-closed smoke(s) held`);
