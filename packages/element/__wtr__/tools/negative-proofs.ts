/**
 * WTR pilot negative proofs (#1333, Beta.2.2): each config below must make the
 * runner exit NON-ZERO — a failing assertion, a missing browser binary, a
 * broken transform, a zero-test run (zero-tests-guard reporter), and a files
 * glob that matches nothing are all run failures, never a silent pass.
 *
 * (Written as a script because deno-task shell has no for-loops.)
 *
 * Run from the repo root: deno task wtr:pilot:negative
 */
const WTR_DIR = new URL('..', import.meta.url).pathname;
const CONFIGS = [
  'failing-assertion',
  'missing-browser',
  'broken-transform',
  'zero-tests',
  'no-matching-files',
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
    console.error(`NEGATIVE PROOF BROKEN: ${name} exited 0 (expected non-zero)`);
  } else {
    console.log(`negative proof ok (exit ${status.code}): ${name}`);
  }
}
if (failed > 0) {
  console.error(`${failed} negative proof(s) broken`);
  Deno.exit(1);
}
console.log(`all ${CONFIGS.length} negative proofs held`);
