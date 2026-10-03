/**
 * Fail-closed configuration smoke for the element browser suite (B3 port).
 *
 * The OpenElement exit contract: a browser run that executes ZERO tests — or
 * any single failing test, broken transform, or dead browser channel — is a
 * FAILURE, never a silent pass. Under web-test-runner this was proven through
 * the negative/*.config.js fixtures and the zero-tests-guard reporter. Under
 * vitest the same contract is proven against the live runner:
 *
 *   1. failing-assertion   a scratch suite whose test fails   → exit ≠ 0
 *   2. broken-transform    a scratch suite with invalid code  → exit ≠ 0
 *   3. zero-tests          a filter matching no files         → exit ≠ 0
 *                             (vitest passWithNoTests defaults to false)
 *
 * History (P2.4): the first port wrote the scratch suites into the SYSTEM
 * temp dir. The element-browser include (the `*.test.js` glob under
 * `packages/element/__wtr__/tests/`) never matches /tmp paths, so every case
 * died as "No test files found, exiting with code 1" and that exit 1 read as
 * a held proof — no assertion ever ran in any browser (and case 2's
 * `.test.ts` name additionally never matched the .js-only include). The
 * scratch suites now live in an in-repo transient directory the include
 * covers, and each case asserts, beyond exit ≠ 0:
 *
 *   a. collection — the scratch suite actually ran: the vitest report shows
 *      failed files/tests ('Test Files  N failed', the test name — N stays
 *      count-agnostic so one signature holds on the chromium PR lane and the
 *      full three-browser matrix alike), or for zero-tests the explicit
 *      no-files signature;
 *   b. the EXPECTED error signature is present (AssertionError from the
 *      scratch test, SyntaxError from the broken module, the no-files
 *      report) — not just any non-zero exit;
 *   c. meta-assertion — "No test files found" on a case that must run tests
 *      fails the smoke, whatever the exit code: that signature is exactly
 *      the false-green vector this script exists to exclude.
 *
 * The scratch cases import only vitest, so each spawned run exercises the
 * same browser execution path as the conformance suite, and the runs inherit
 * `OE_BROWSER_MATRIX`: browser:gate (default) proves the contract on
 * chromium, browser:gate:full widens the same negatives to the
 * chromium+firefox+webkit matrix, exactly like the retired wtr gate.
 *
 * (Written as a script because package scripts have no for-loops.)
 *
 * Run from the repo root: pnpm --dir packages/element run browser:negative
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { commandOutput } from '../../../../tools/repo/node-command.ts';
import process from 'node:process';

// tools/ → __wtr__ → element → packages → repo root
const REPO_ROOT = resolve(join(new URL('..', import.meta.url).pathname, '..', '..', '..'));
const VITEST = join(REPO_ROOT, 'node_modules', '.bin', 'vitest');

/**
 * In-repo transient scratch directory INSIDE the element-browser include
 * (vitest.config.ts: the `*.test.js` glob under
 * `packages/element/__wtr__/tests/`). Files
 * here are collected — unlike the former /tmp location — and the directory
 * is removed on every entry and in the finally block, so a leftover scratch
 * can never leak a failing suite into a later `browser:test` run.
 */
const SCRATCH_DIR = join(
  REPO_ROOT,
  'packages',
  'element',
  '__wtr__',
  'tests',
  'negative-scratch',
);

/** vitest's report line when nothing matched — the false-green vector. */
const NO_FILES_SIGNATURE = 'No test files found';

interface VitestRun {
  code: number;
  /** decoded stdout + stderr of the vitest run */
  output: string;
}

interface CaseDef {
  name: string;
  /** write the scratch suite into the include-covered scratch directory. */
  write: (dir: string) => void;
  /** vitest CLI args for the case's negative run. */
  args: (dir: string) => string[];
  /**
   * The fail-closed proof: every reason returned marks the smoke BROKEN.
   * Non-empty means the negative did NOT demonstrably fail for the expected
   * reason (uncollected, wrong error type, or a green exit).
   */
  expect: (run: VitestRun) => string[];
}

const CASES: CaseDef[] = [
  {
    name: 'failing-assertion',
    write: (dir) => {
      writeFileSync(
        join(dir, 'failing.test.js'),
        "import { expect, test } from 'vitest';\ntest('must fail', () => { expect(1).toBe(2); });\n",
      );
    },
    args: (dir) => ['run', '--project', 'element-browser', join(dir, 'failing.test.js')],
    expect: ({ code, output }) => {
      const reasons: string[] = [];
      if (code === 0) reasons.push('exited 0 (the failing assertion did not fail the run)');
      if (output.includes(NO_FILES_SIGNATURE)) {
        reasons.push('scratch suite never collected ("No test files found") — proof is vacuous');
      }
      if (!output.includes('must fail')) {
        reasons.push("the 'must fail' test is absent from the report — it never ran");
      }
      if (!/Tests\s+\d+ failed/.test(output)) {
        reasons.push("report does not show 'Tests  N failed' — the failure was not the test run");
      }
      if (!output.includes('AssertionError: expected 1 to be 2')) {
        reasons.push("expected 'AssertionError: expected 1 to be 2' in the report");
      }
      return reasons;
    },
  },
  {
    name: 'broken-transform',
    write: (dir) => {
      // Invalid syntax in a .js module (the include's extension): the file
      // IS collected, then the import fails to parse — a collected-but-
      // broken suite, not a no-files exit.
      writeFileSync(join(dir, 'broken.test.js'), 'const @@ not typescript @@\n');
    },
    args: (dir) => ['run', '--project', 'element-browser', join(dir, 'broken.test.js')],
    expect: ({ code, output }) => {
      const reasons: string[] = [];
      if (code === 0) reasons.push('exited 0 (the broken module did not fail the run)');
      if (output.includes(NO_FILES_SIGNATURE)) {
        reasons.push('scratch suite never collected ("No test files found") — proof is vacuous');
      }
      if (!/Test Files\s+\d+ failed/.test(output)) {
        reasons.push(
          "report does not show 'Test Files  N failed' — the file was not collected",
        );
      }
      if (!output.includes('SyntaxError')) {
        reasons.push("expected the 'SyntaxError' from the broken module in the report");
      }
      return reasons;
    },
  },
  {
    name: 'zero-tests',
    write: () => {
      // Deliberately writes nothing: the filter below names a file that does
      // not exist, so the run collects zero files. This case IS the
      // false-green vector, held open on purpose — vitest must exit non-zero
      // on it (passWithNoTests defaults to false).
    },
    args: (dir) => ['run', '--project', 'element-browser', join(dir, 'does-not-exist.test.js')],
    expect: ({ code, output }) => {
      const reasons: string[] = [];
      if (code === 0) {
        reasons.push('exited 0 (a zero-test run reported success — passWithNoTests is set?)');
      }
      if (!output.includes(NO_FILES_SIGNATURE)) {
        reasons.push(`expected the '${NO_FILES_SIGNATURE}' report for the empty collection`);
      }
      return reasons;
    },
  },
];

let failed = 0;
// Remove any stale scratch first: a leftover from a killed run would leak a
// failing suite into the next `browser:test` conformance run.
rmSync(SCRATCH_DIR, { recursive: true, force: true });
try {
  mkdirSync(SCRATCH_DIR, { recursive: true });
  for (const { name, write, args, expect } of CASES) {
    write(SCRATCH_DIR);
    const result = await commandOutput(VITEST, {
      args: args(SCRATCH_DIR),
      cwd: REPO_ROOT,
      stdout: 'piped',
      stderr: 'piped',
    });
    const decoder = new TextDecoder();
    const output = decoder.decode(result.stdout) + decoder.decode(result.stderr);
    const reasons = expect({ code: result.code, output });
    if (reasons.length > 0) {
      failed += 1;
      console.error(`FAIL-CLOSED SMOKE BROKEN: ${name}\n  - ${reasons.join('\n  - ')}`);
    } else {
      console.log(`fail-closed smoke ok (exit ${result.code}): ${name}`);
    }
  }
} finally {
  rmSync(SCRATCH_DIR, { recursive: true, force: true });
}
if (failed > 0) {
  console.error(`${failed} fail-closed smoke(s) broken`);
  process.exit(1);
}
console.log(`all ${CASES.length} fail-closed smoke(s) held`);
