#!/usr/bin/env -S deno run --allow-read --allow-run
/** Run repository tests and enforce production-package LCOV thresholds. */

import {
  addUncoveredFiles,
  countCoverableElements,
  type CoverableCounts,
  type CoverageMetric,
  enumerateCoverageFiles,
  isPackageSource,
  isToolsLibSource,
  lcovFilePaths,
  parseLcov,
} from './coverage-summary.ts';

function getNumberArg(flag: string, fallback: number): number {
  const index = Deno.args.indexOf(flag);
  const value = Number(index >= 0 ? Deno.args[index + 1] : fallback);
  if (!Number.isFinite(value)) throw new Error(`${flag} must be a number`);
  return value;
}

// Issue #1278: the `deno test --coverage` subprocess has repeatedly died by
// native crash (observed exit 139 = SIGSEGV, rolldown/workerd class) with no
// test assertion failure. Signal-terminated processes surface as exit code
// 128 + signal number; only those are retryable. Any exit code below the
// floor — including 1, the deno test assertion-failure code — is a real
// failure and must fail the gate immediately, never retried.
const NATIVE_CRASH_FLOOR = 128;

const SIGNAL_NAMES: Record<number, string> = {
  4: 'SIGILL',
  5: 'SIGTRAP',
  6: 'SIGABRT',
  7: 'SIGBUS',
  8: 'SIGFPE',
  11: 'SIGSEGV',
};

export type TestExitKind = 'ok' | 'test-failure' | 'native-crash';

export function classifyTestExit(code: number): TestExitKind {
  if (code === 0) return 'ok';
  return code >= NATIVE_CRASH_FLOOR ? 'native-crash' : 'test-failure';
}

export function describeNativeCrash(code: number): string {
  const signal = code - NATIVE_CRASH_FLOOR;
  const name = SIGNAL_NAMES[signal];
  return name ? `signal ${name} (exit code ${code})` : `signal ${signal} (exit code ${code})`;
}

export interface CrashRetryEvent {
  attempt: number;
  maxAttempts: number;
  code: number;
}

// Runs the coverage test suite with a bounded, fail-loud native-crash retry:
// every crash is reported through onCrash, real test failures abort without
// retry, and exhausting maxAttempts on crashes alone throws. Returns the
// number of crashes observed so the caller can keep recovered flakes visible.
export async function runTestSuiteWithCrashRetry(
  runner: () => Promise<{ code: number }>,
  options: { maxAttempts: number; onCrash?: (event: CrashRetryEvent) => void },
): Promise<{ crashes: number }> {
  const { maxAttempts, onCrash } = options;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer');
  }
  let crashes = 0;
  for (let attempt = 1;; attempt++) {
    const { code } = await runner();
    const kind = classifyTestExit(code);
    if (kind === 'ok') return { crashes };
    if (kind === 'test-failure') throw new Error(`tests failed with code ${code}`);
    crashes++;
    onCrash?.({ attempt, maxAttempts, code });
    if (attempt >= maxAttempts) {
      throw new Error(
        `coverage test run crashed natively (${describeNativeCrash(code)}) on all ` +
          `${maxAttempts} attempts; refusing to pass the gate on repeated native ` +
          'crashes (#1278)',
      );
    }
  }
}

async function runCoverage(crashRetries: number): Promise<string> {
  const coverageDir = '.coverage-check';
  try {
    const { crashes } = await runTestSuiteWithCrashRetry(
      async () => {
        // A crashed attempt can leave partial coverage profiles behind that
        // `deno coverage` would choke on; each attempt starts from a clean dir.
        await Deno.remove(coverageDir, { recursive: true }).catch(() => undefined);
        return await new Deno.Command(Deno.execPath(), {
          args: [
            'test',
            '--no-lock',
            `--coverage=${coverageDir}`,
            // element's WTR browser suite is gated separately
            // (test:element:browser:gate). examples/ and fixtures/ are
            // independent projects with their own deno.json boundaries —
            // the root sweep must not resolve them under the root import
            // map. Each runs under its own config via its own gate
            // (examples:check, fixture:*:gate); none contributes to the
            // root coverage denominator.
            '--ignore=packages/element/__wtr__,examples,fixtures',
            '--allow-read',
            '--allow-write',
            '--allow-env',
            '--allow-net',
            '--allow-run',
            '--allow-ffi',
            '--allow-sys',
          ],
          stdout: 'inherit',
          stderr: 'inherit',
        }).spawn().status;
      },
      {
        maxAttempts: crashRetries + 1,
        onCrash: ({ attempt, maxAttempts, code }) => {
          console.error(
            `\n[check-coverage] NATIVE CRASH: deno test terminated by ${
              describeNativeCrash(code)
            } ` +
              `on attempt ${attempt}/${maxAttempts} with no test assertion failure (#1278). ` +
              (attempt < maxAttempts ? 'Retrying.' : 'No attempts left.'),
          );
        },
      },
    );
    if (crashes > 0) {
      console.error(
        `\n[check-coverage] WARNING: coverage run recovered after ${crashes} native ` +
          `crash(es) (#1278). The gate passed, but the flake stays visible — count ` +
          'these lines in CI logs when trending the crash rate.',
      );
    }

    const report = await new Deno.Command(Deno.execPath(), {
      args: ['coverage', coverageDir, '--lcov'],
      stdout: 'piped',
      stderr: 'inherit',
    }).output();
    if (!report.success) throw new Error(`coverage report failed with code ${report.code}`);
    return new TextDecoder().decode(report.stdout);
  } finally {
    await Deno.remove(coverageDir, { recursive: true }).catch(() => undefined);
  }
}

function formatMetric(name: string, metric: CoverageMetric, threshold: number): string {
  return `${name}: ${metric.covered}/${metric.total} ${
    metric.percentage.toFixed(2)
  }% (minimum ${threshold}%)`;
}

async function main(): Promise<void> {
  // Bounded crash retry for #1278: one clean run plus `--crash-retries`
  // retries that only fire on native-crash exits (>= 128 + signal), never on
  // assertion failures. Loud by design: every crash prints to stderr.
  const crashRetries = getNumberArg('--crash-retries', 2);
  const lcov = await runCoverage(crashRetries);
  const profiledFiles = lcovFilePaths(lcov);

  // Threshold baseline: 2026-08-04 (v0.42.0-alpha.14 cycle), measured with the
  // full-denominator logic below on a local `deno task test:coverage` run:
  //   packages/*/src: lines 81.46%, branches 85.24%, functions 87.66%
  //   tools/lib:      lines 72.97%, branches 83.47%, functions 70.31%
  // Thresholds sit one point under the measured floor to absorb platform
  // variance between local runs and CI. Raise them only after re-measuring.
  const scopes: Array<{
    label: string;
    include: (path: string) => boolean;
    thresholds: { lines: number; branches: number; functions: number };
  }> = [
    {
      label: 'packages/*/src',
      include: isPackageSource,
      thresholds: {
        lines: getNumberArg('--threshold', 73),
        branches: getNumberArg('--branch-threshold', 82),
        functions: getNumberArg('--function-threshold', 77),
      },
    },
    {
      label: 'tools/lib',
      include: isToolsLibSource,
      thresholds: {
        lines: getNumberArg('--tools-threshold', 72),
        branches: getNumberArg('--tools-branch-threshold', 82),
        functions: getNumberArg('--tools-function-threshold', 69),
      },
    },
  ];

  const failures: string[] = [];
  for (const scope of scopes) {
    console.log(`\nCoverage scope: ${scope.label}`);
    // Full denominator: every in-scope source file counts, even when no test
    // loaded it (Deno only profiles imported modules). Unloaded files are
    // folded in as fully uncovered via an AST estimate of their coverable
    // elements.
    const treeFiles = await enumerateCoverageFiles(Deno.cwd(), scope.include);
    const uncovered: CoverableCounts[] = [];
    const missing: string[] = [];
    for (const path of treeFiles) {
      if (profiledFiles.has(path)) continue;
      missing.push(path);
      uncovered.push(countCoverableElements(await Deno.readTextFile(path), path));
    }
    console.log(
      `Denominator: ${treeFiles.length} source files ` +
        `(${missing.length} never loaded by any test, counted at 0%).`,
    );
    for (const path of missing) console.log(`  not exercised: ${path}`);
    const summary = addUncoveredFiles(parseLcov(lcov, scope.include), uncovered);
    for (const name of ['lines', 'branches', 'functions'] as const) {
      console.log(formatMetric(name, summary[name], scope.thresholds[name]));
      if (summary[name].percentage < scope.thresholds[name]) {
        failures.push(`${scope.label} ${name}`);
      }
    }
  }

  if (failures.length) {
    throw new Error(`coverage threshold failed: ${failures.join(', ')}`);
  }
  console.log('\nCoverage gate passed.');
}

if (import.meta.main) await main();
