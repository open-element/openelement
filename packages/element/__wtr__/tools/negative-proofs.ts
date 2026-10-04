/**
 * Fail-closed configuration smoke for the element browser suite.
 *
 * The OpenElement exit contract: a browser run that executes ZERO tests — or
 * any single failing test, broken transform, empty suite, unmatched filter,
 * or dead browser channel — is a FAILURE, never a silent pass. The contract
 * is proven against the live vitest runner over FIVE distinct contracts,
 * each pinned to its own expected diagnostic so no one failure mode can
 * masquerade as another:
 *
 *   1. failing-assertion      a scratch test that fails         → exit ≠ 0,
 *                             the test name and its AssertionError in the report
 *   2. broken-transform       a scratch file with invalid code  → exit ≠ 0,
 *                             the file collected-and-failed with a SyntaxError
 *   3. no-matched-files       a filter matching no files        → exit ≠ 0,
 *                             the explicit "No test files found" report
 *                             (passWithNoTests stays false)
 *   4. collected-empty        a COLLECTED file registering zero tests →
 *                             exit ≠ 0 with "No test suite found in file"
 *   5. browser-launch-failure the selected browser pointed at a missing
 *                             executable → exit ≠ 0 with the playwright
 *                             launch diagnostic; preceded per engine by a
 *                             launch-sentinel (a passing scratch test under
 *                             normal config) proving that engine launches
 *                             and executes — so the launch failure is
 *                             attributable to the injected bad executable,
 *                             not to a generally broken channel.
 *
 * Falsified behavior this smoke encodes (2026-10-04, vitest 5.0.2 browser
 * mode, both probes against the live runner):
 *   - collected-empty: vitest FAILS such a file natively — probe: a
 *     collected zero-test file exited 1 with "No test suite found in file"
 *     and "Test Files  1 failed" (passWithNoTests defaults false; the
 *     runner's runFiles marks zero-task collected files failed —
 *     node_modules/vitest/dist/chunks/run.C5UmxDPh.js). No extra
 *     zero-tests guard is needed; this case pins that native behavior so a
 *     future vitest upgrade that silently passes empty suites breaks the
 *     gate instead of the suite's guarantees.
 *   - browser-launch-failure: the ONLY working seam is the provider
 *     call site — `playwright({ launchOptions: { executablePath } })` in
 *     vitest.config.ts (the documented @vitest/browser-playwright option).
 *     The CLI/config-tree route is a dead end: `--browser.providerOptions.
 *     launchOptions.executablePath` on a live run launched the real browser
 *     and passed, because resolveLaunchOptions reads only the options passed
 *     to the playwright() factory (node_modules/@vitest/browser-playwright/
 *     dist/index.js), never browser.providerOptions. The launch negative
 *     therefore sets OE_BROWSER_LAUNCH_EXECUTABLE, which vitest.config.ts
 *     forwards into the provider call; unset on every real lane, so normal
 *     launch behavior is untouched. The pinned diagnostic —
 *     "browserType.launch: Failed to launch <engine> because executable
 *     doesn't exist at <path>" — echoes the injected engine-specific path,
 *     which proves the override actually reached the provider (the exact
 *     property the dead CLI route silently lacked).
 *
 * Per-engine attribution: the proofs run EACH engine separately in serial
 * (each vitest spawn pins OE_BROWSER_MATRIX to one engine — single-instance
 * values are part of matrixInstances in vitest.config.ts, unknown values
 * fail closed there and here), so one failing engine can never masquerade
 * as three proven engines; every proof line names its engine.
 *
 * The scratch suites live in an in-repo transient directory the
 * element-browser include covers (the `*.test.js` glob under
 * `packages/element/__wtr__/tests/`), so every case really collects and runs
 * (or genuinely fails to launch), and each case asserts, beyond exit ≠ 0:
 *
 *   a. collection — the scratch suite actually ran: the report shows the
 *      failed files/tests and their names, the sentinel's file line with its
 *      1-passed counts, or for no-matched-files the explicit no-files
 *      signature;
 *   b. the EXPECTED error signature is present — not just any non-zero exit;
 *   c. meta-assertion — "No test files found" on a case that must run tests
 *      fails the smoke, whatever the exit code: that signature is exactly
 *      the false-green vector this script exists to exclude.
 *
 * The matchers run against a CANONICAL report shape. Vitest colorizes its
 * report even when stdout is piped once `CI` is present in the environment
 * (its tinyrainbow colorizer enables color on the bare presence of CI —
 * node_modules/vitest/dist/chunks/tinyrainbow.*.js — so GitHub Actions gets
 * ANSI codes that local pipes never see; PR #1509's red gate was exactly
 * this: `Tests \x1b[22m\x1b[1m\x1b[31m1 failed` never matched
 * /Tests\s+\d+ failed/). Two layers pin the shape, with the assertions
 * above unchanged:
 *
 *   - the spawned vitest runs with NO_COLOR=1 (its colorizer checks
 *     NO_COLOR first, so the run itself is emitted bare on every lane);
 *   - the captured output is ANSI-stripped before matching, so a residual
 *     escape sequence from any future reporter path still cannot sit
 *     between a signature and its match.
 *
 * When a case does break, the normalized output tail is dumped to stderr:
 * without it the CI log shows only the verdict and every new shape
 * divergence costs an artifact download to diagnose.
 *
 * The scratch cases import only vitest, so each spawned run exercises the
 * same browser execution path as the conformance suite, with the same
 * runner/config/version (the element-browser project in vitest.config.ts).
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
 * here are collected, and the directory is removed on every entry and in the
 * finally block, so a leftover scratch can never leak a failing suite into a
 * later `browser:test` run.
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

/** The missing-executable launch path the negative points each engine at. */
function badExecutable(engine: string): string {
  return `/nonexistent/oe-launch-negative/${engine}-browser-binary`;
}

/** The playwright diagnostic when the provider cannot launch the browser. */
const LAUNCH_FAILURE_SIGNATURE = 'browserType.launch: Failed to launch';

/** The passing scratch test the launch contract is anchored on. */
const SENTINEL_TEST = 'launch sentinel passes';

/**
 * ANSI escape sequences (CSI/SGR plus OSC), the pattern the chalk ecosystem
 * standardizes on. Applied before any matcher runs so a colorized reporter
 * path cannot wedge an escape sequence between a signature and its match
 * (belt: the child vitest is pinned to NO_COLOR=1; suspenders: this strip).
 */
const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

interface VitestRun {
  code: number;
  /** decoded stdout + stderr of the vitest run */
  output: string;
}

interface CaseDef {
  name: string;
  /** true for the launch-sentinel anchor (a known-passing run, not a negative). */
  sentinel?: boolean;
  /** write the scratch suite into the include-covered scratch directory. */
  write: (dir: string) => void;
  /** vitest CLI args for the case's negative run. */
  args: (dir: string) => string[];
  /**
   * Extra spawn env on top of NO_COLOR + the per-engine OE_BROWSER_MATRIX.
   * Only the launch negative sets OE_BROWSER_LAUNCH_EXECUTABLE (the
   * vitest.config.ts seam); every other case inherits normal launch config.
   */
  env?: (engine: string) => Record<string, string>;
  /**
   * The fail-closed proof: every reason returned marks the smoke BROKEN.
   * Non-empty means the negative did NOT demonstrably fail for the expected
   * reason (uncollected, wrong error type, or a green exit) — or, for the
   * sentinel, that the known-passing run did not demonstrably pass.
   */
  expect: (run: VitestRun, engine: string) => string[];
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
    name: 'no-matched-files',
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
  {
    name: 'collected-empty',
    write: (dir) => {
      // Collected by the include (matching *.test.js path), but registers no
      // tests. Falsified 2026-10-04 on vitest 5.0.2 browser mode: the runner
      // fails such a file natively ("No test suite found in file", exit 1,
      // passWithNoTests defaults false) — this case pins that behavior so an
      // upgrade that silently passes empty suites fails the gate instead of
      // leaking a false green into browser:test.
      writeFileSync(
        join(dir, 'empty.test.js'),
        "import { test } from 'vitest';\nexport const collectedButEmpty = true;\n",
      );
    },
    args: (dir) => ['run', '--project', 'element-browser', join(dir, 'empty.test.js')],
    expect: ({ code, output }) => {
      const reasons: string[] = [];
      if (code === 0) {
        reasons.push(
          'exited 0 (a collected file with zero tests passed silently — zero-tests guard now REQUIRED)',
        );
      }
      if (output.includes(NO_FILES_SIGNATURE)) {
        reasons.push('file never collected ("No test files found") — a no-files exit must not stand in for the empty-suite proof');
      }
      if (!/Test Files\s+\d+ failed/.test(output)) {
        reasons.push("report does not show 'Test Files  N failed' — the empty file was not failed");
      }
      if (!output.includes('No test suite found in file')) {
        reasons.push(
          "expected the 'No test suite found in file' diagnostic for the zero-test suite",
        );
      }
      return reasons;
    },
  },
  {
    name: 'launch-sentinel',
    // The known-passing anchor of the launch contract, run before the launch
    // negative: it proves the engine launches and executes a real test under
    // normal config, so the next case's failure is attributable to the
    // injected bad executable alone.
    sentinel: true,
    write: (dir) => {
      writeFileSync(
        join(dir, 'sentinel.test.js'),
        `import { expect, test } from 'vitest';\ntest('${SENTINEL_TEST}', () => { expect(1).toBe(1); });\n`,
      );
    },
    args: (dir) => ['run', '--project', 'element-browser', join(dir, 'sentinel.test.js')],
    expect: ({ code, output }) => {
      const reasons: string[] = [];
      if (code !== 0) {
        reasons.push(`exited ${code} (the sentinel must pass to prove the engine launches)`);
      }
      if (output.includes(NO_FILES_SIGNATURE)) {
        reasons.push('scratch suite never collected ("No test files found") — proof is vacuous');
      }
      // vitest's default reporter lists PASSING suites by file path only
      // (failing test names appear in failure details; passing ones do not),
      // so the sentinel's collection evidence is its file line plus the
      // 1-passed counts — not the test name.
      if (!output.includes('sentinel.test.js')) {
        reasons.push('the sentinel file is absent from the report — it never ran');
      }
      if (!/Test Files\s+1 passed/.test(output)) {
        reasons.push("report does not show 'Test Files  1 passed' — the sentinel file did not pass");
      }
      if (!/Tests\s+1 passed/.test(output)) {
        reasons.push("report does not show 'Tests  1 passed' — the sentinel test did not pass");
      }
      return reasons;
    },
  },
  {
    name: 'browser-launch-failure',
    write: (dir) => {
      // The launch sentinel doubles as this case's suite: if the bad
      // executable somehow did not stop the run, this test WOULD run and
      // pass — the expect below treats a green report as the broken reason,
      // so a leaky override can never read as a launch proof.
      writeFileSync(
        join(dir, 'sentinel.test.js'),
        `import { expect, test } from 'vitest';\ntest('${SENTINEL_TEST}', () => { expect(1).toBe(1); });\n`,
      );
    },
    args: (dir) => ['run', '--project', 'element-browser', join(dir, 'sentinel.test.js')],
    env: (engine) => ({ OE_BROWSER_LAUNCH_EXECUTABLE: badExecutable(engine) }),
    expect: ({ code, output }, engine) => {
      const reasons: string[] = [];
      const executable = badExecutable(engine);
      if (code === 0) {
        reasons.push('exited 0 (the missing executable did not fail the run)');
      }
      if (output.includes(NO_FILES_SIGNATURE)) {
        reasons.push('scratch suite never collected ("No test files found") — proof is vacuous');
      }
      if (!output.includes(LAUNCH_FAILURE_SIGNATURE)) {
        reasons.push(
          `expected the '${LAUNCH_FAILURE_SIGNATURE}' diagnostic in the report — the failure was not the launch`,
        );
      }
      if (!output.includes(executable)) {
        reasons.push(
          `the diagnostic does not echo the injected executablePath (${executable}) — the launch override may not have reached the provider`,
        );
      }
      if (/Tests\s+\d+ passed/.test(output)) {
        reasons.push('the sentinel test ran and passed despite the launch failure');
      }
      return reasons;
    },
  },
];

/** Mirror of matrixInstances() in vitest.config.ts (fail closed, same rule). */
function proofEngines(): string[] {
  const matrix = process.env.OE_BROWSER_MATRIX ?? 'chromium';
  switch (matrix) {
    case 'chromium':
    case '':
      return ['chromium'];
    case 'firefox':
      return ['firefox'];
    case 'webkit':
      return ['webkit'];
    case 'full':
      return ['chromium', 'firefox', 'webkit'];
    default:
      throw new Error(`unknown OE_BROWSER_MATRIX: ${matrix} (vitest.config.ts would reject it too)`);
  }
}

let failed = 0;
const engineList = proofEngines();
const totalRuns = engineList.length * CASES.length;
let ran = 0;
console.log(
  `fail-closed proofs: ${CASES.length} contracts × engines [${engineList.join(', ')}] (${totalRuns} vitest runs, serial per engine)`,
);
// Remove any stale scratch first: a leftover from a killed run would leak a
// failing suite into the next `browser:test` conformance run.
rmSync(SCRATCH_DIR, { recursive: true, force: true });
try {
  mkdirSync(SCRATCH_DIR, { recursive: true });
  for (const engine of engineList) {
    for (const { name, sentinel, write, args, env, expect } of CASES) {
      write(SCRATCH_DIR);
      const result = await commandOutput(VITEST, {
        args: args(SCRATCH_DIR),
        cwd: REPO_ROOT,
        // Pin the report shape at the source: vitest colorizes piped output
        // whenever CI is in the environment (tinyrainbow), and its colorizer
        // honors NO_COLOR before that check — see the header note. The
        // per-engine matrix is pinned here so each proof runs exactly one
        // browser instance regardless of the ambient OE_BROWSER_MATRIX.
        env: { NO_COLOR: '1', OE_BROWSER_MATRIX: engine, ...env?.(engine) },
        stdout: 'piped',
        stderr: 'piped',
      });
      const decoder = new TextDecoder();
      const output = stripAnsi(decoder.decode(result.stdout) + decoder.decode(result.stderr));
      const reasons = expect({ code: result.code, output }, engine);
      ran += 1;
      if (reasons.length > 0) {
        failed += 1;
        console.error(`FAIL-CLOSED PROOF BROKEN (engine=${engine}): ${name}\n  - ${reasons.join('\n  - ')}`);
        // Diagnosability: a broken case dumps its normalized report tail so
        // the actual output shape is in the log, not only in a downloaded
        // artifact. Capped — an import-error dump can be huge.
        const lines = output.split('\n');
        const tail = lines.slice(-80).join('\n');
        console.error(`--- ${name} (${engine}): vitest output tail (normalized) ---\n${tail}`);
      } else if (sentinel) {
        console.log(
          `launch sentinel ok — ${engine} launches and executes with normal config (exit ${result.code})`,
        );
      } else {
        console.log(`proof ok (engine=${engine}, exit ${result.code}): ${name}`);
      }
    }
  }
} finally {
  rmSync(SCRATCH_DIR, { recursive: true, force: true });
}
if (failed > 0) {
  console.error(`${failed}/${ran} fail-closed proof(s) broken (engines: ${engineList.join(', ')})`);
  process.exit(1);
}
console.log(
  `all ${ran} fail-closed proof(s) held — 5 contracts proven per engine on [${engineList.join(', ')}]`,
);
