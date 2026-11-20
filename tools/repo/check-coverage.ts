#!/usr/bin/env node
/**
 * Run repository tests and enforce production-package LCOV thresholds.
 *
 * Form: structural derived guard (permanent — no retirement condition). The
 * thresholds are the gate's own contract and the coverage data is derived
 * from the test run; there is no temporary mechanism to retire.
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { emitSummary, reportPathArg } from './checker-io.ts';
import {
  addUncoveredFiles,
  countCoverableElements,
  type CoverableCounts,
  type CoverageMetric,
  enumerateCoverageFiles,
  isPackageSource,
  isToolsLibSource,
  isWwwToolsSource,
  lcovFilePaths,
  normalizeLcovSourcePaths,
  parseLcov,
} from './coverage-summary.ts';
import { spawnCommand } from './node-command.ts';

function getNumberArg(flag: string, fallback: number): number {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  const value = Number(index >= 0 ? args[index + 1] : fallback);
  if (!Number.isFinite(value)) throw new Error(`${flag} must be a number`);
  return value;
}

// Issue #1278 (deno-test era): the coverage subprocess repeatedly died by
// native crash (observed exit 139 = SIGSEGV, rolldown/workerd class) with no
// test assertion failure. Signal-terminated processes surface as exit code
// 128 + signal number; only those are retryable. Any exit code below the
// floor — including 1, the test assertion-failure code — is a real failure
// and must fail the gate immediately, never retried. The retry harness stays
// on the vitest runner: a runner-level crash remains distinguishable from a
// test failure by the same exit-code class.
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
  for (let attempt = 1; ; attempt++) {
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

/**
 * The vitest node projects whose runs feed the coverage denominator. This
 * list is a SECONDARY COPY of the project axis declared in the root
 * `vitest.config.ts` — the project-axis drift guard below holds it to that
 * source (#1566 split the compiler out of `element` and this list silently
 * missed the new project until it was caught by hand).
 */
export const COVERAGE_PROJECTS = [
  'element',
  'compiler',
  'router',
  'create',
  'ui',
  'saas',
  'www',
  'tools',
  'tests',
  'benchmarks',
] as const;

/** The config file the project axis is derived from. */
export const VITEST_CONFIG_PATH = 'vitest.config.ts';
/** This checker's own repository-relative path (for naming drift findings). */
export const COVERAGE_CHECKER_PATH = 'tools/repo/check-coverage.ts';

/** One parsed project entry from the root vitest config. */
export interface VitestProjectRef {
  name: string;
  /** 1-based line of the project's `name:` entry in vitest.config.ts. */
  line: number;
  /** True when the project block enables vitest browser mode. */
  browserEnabled: boolean;
}

/**
 * Extract the vitest project axis from the root config's source text, with
 * line numbers, so drift findings can name the exact side. The parser
 * understands this config's shape — a flat `projects:` array of
 * `{ test: { name: '...' } }` entries; a project's name is the first
 * `name: '...'` after its `test: {`, and a project enables browser mode when
 * its block declares `browser:` with `enabled: true`. A config the parser
 * cannot read yields zero projects, which the drift guard refuses (fail
 * closed, never a vacuous green).
 */
export function extractVitestProjects(text: string): VitestProjectRef[] {
  const lines = text.split('\n');
  const projectsMarker = lines.findIndex((line) => /^\s*projects:\s*\[/.test(line));
  if (projectsMarker === -1) return [];
  const refs: VitestProjectRef[] = [];
  // First pass: the line indices of every `test: {` after the projects
  // marker — each opens one project's test block.
  const blockStarts: number[] = [];
  for (let index = projectsMarker; index < lines.length; index++) {
    if (/\btest:\s*\{/.test(lines[index]!)) blockStarts.push(index);
  }
  for (let position = 0; position < blockStarts.length; position++) {
    const start = blockStarts[position]!;
    // A project's block extends to the next `test: {` (or end of file).
    const end = position + 1 < blockStarts.length ? blockStarts[position + 1]! : lines.length;
    let name: string | undefined;
    let browserEnabled = false;
    for (let index = start; index < end; index++) {
      const line = lines[index]!;
      if (name === undefined) {
        const nameMatch = line.match(/\bname:\s*'([^']+)'/);
        if (nameMatch) name = nameMatch[1]!;
      }
      // `browser: {` and its `enabled: true` sit on different lines; once the
      // browser block opens inside this project, its enabled flag decides.
      if (/\bbrowser:\s*\{/.test(line)) {
        browserEnabled = lines.slice(index, end).some((rest) => /\benabled:\s*true/.test(rest));
      }
    }
    if (name !== undefined) {
      // The name line is reported, not the `test: {` line: findings point at
      // the identifier a maintainer edits.
      const nameLine =
        start + lines.slice(start, end).findIndex((line) => /\bname:\s*'/.test(line)) + 1;
      refs.push({ name, line: nameLine, browserEnabled });
    }
  }
  return refs;
}

/**
 * The project-axis drift: COVERAGE_PROJECTS must equal the set of vitest
 * NODE projects exactly. Browser-mode projects are excluded by a derived
 * rule (a project block that enables `browser:`), not by a name list — they
 * are gated separately and none of them contributes to the production-source
 * denominator. Every finding names both files, the line, and the direction
 * of the difference.
 */
export function coverageProjectDrift(
  projects: readonly VitestProjectRef[],
  coverageLines: ReadonlyMap<string, number>,
): string[] {
  const findings: string[] = [];
  if (projects.length === 0) {
    findings.push(
      `${VITEST_CONFIG_PATH}: no vitest projects could be parsed — refusing to let the ` +
        'coverage project axis pass vacuously.',
    );
    return findings;
  }
  const nodeProjects = projects.filter((project) => !project.browserEnabled);
  if (nodeProjects.length === 0) {
    findings.push(
      `${VITEST_CONFIG_PATH}: every parsed project is browser-mode — refusing to let the ` +
        'coverage project axis pass vacuously.',
    );
    return findings;
  }
  const declared = new Set<string>(COVERAGE_PROJECTS);
  for (const project of nodeProjects) {
    if (!declared.has(project.name)) {
      findings.push(
        `${VITEST_CONFIG_PATH}:${project.line}: vitest node project '${project.name}' is missing ` +
          `from ${COVERAGE_CHECKER_PATH} COVERAGE_PROJECTS — the coverage gate runs without it and ` +
          'its sources silently leave the denominator (the #1566 compiler-split drift class).',
      );
    }
  }
  const vitestNodeNames = new Set(nodeProjects.map((project) => project.name));
  for (const name of COVERAGE_PROJECTS) {
    if (!vitestNodeNames.has(name)) {
      const line = coverageLines.get(name);
      findings.push(
        `${COVERAGE_CHECKER_PATH}:${line ?? '?'}: COVERAGE_PROJECTS entry '${name}' matches no ` +
          `${VITEST_CONFIG_PATH} node project — the gate passes a --project flag that selects nothing.`,
      );
    }
  }
  return findings;
}

/**
 * Line numbers of the COVERAGE_PROJECTS entries, read from this checker's own
 * source so every drift finding can name both sides precisely.
 */
export async function coverageProjectLines(selfPath: string): Promise<Map<string, number>> {
  const text = await readFile(selfPath, 'utf8');
  const start = text.indexOf('const COVERAGE_PROJECTS');
  const end = text.indexOf('] as const', start);
  const lines = new Map<string, number>();
  if (start === -1 || end === -1) return lines;
  const before = text.slice(0, start).split('\n').length - 1;
  for (const name of COVERAGE_PROJECTS) {
    const index = text.indexOf(`'${name}',`, start);
    if (index === -1 || index > end) continue;
    lines.set(name, before + text.slice(start, index).split('\n').length);
  }
  return lines;
}

/** Instrumentation roots: exactly the three threshold scopes. */
export const COVERAGE_INCLUDES = [
  // Wildcard on purpose: the scope's denominator predicate (isPackageSource)
  // counts every `packages/<name>/src` source, so a per-package include list
  // drifts the moment a package is added or split. Protocol and compiler were
  // counted by the denominator but absent here, so vitest never profiled them
  // and the gate folded 41 files (3276 estimated lines) in at 0%. The
  // wildcard makes the include set structurally unable to diverge from the
  // predicate; check-coverage.test.ts pins that.
  'packages/*/src/**',
  'tools/lib/**',
  'www/tools/lib/**',
] as const;

async function runCoverage(crashRetries: number): Promise<string> {
  const coverageDir = '.coverage-check';
  try {
    const { crashes } = await runTestSuiteWithCrashRetry(
      async () => {
        // A crashed attempt can leave partial coverage profiles behind; each
        // attempt starts from a clean dir.
        await rm(coverageDir, { recursive: true }).catch(() => undefined);
        // The vitest node projects carry the denominator. element-browser
        // (browser mode) is gated separately (packages/element#browser:gate);
        // tests/fixtures fixtures run their own gates and none of the
        // excluded surfaces contributes to the production-source denominator.
        const projectArgs = COVERAGE_PROJECTS.flatMap((project) => ['--project', project]);
        const includeArgs = COVERAGE_INCLUDES.map((include) => `--coverage.include=${include}`);
        return await spawnCommand('pnpm', {
          args: [
            'exec',
            'vitest',
            'run',
            ...projectArgs,
            '--coverage',
            '--coverage.provider=v8',
            '--coverage.reporter=lcov',
            `--coverage.reportsDirectory=${coverageDir}`,
            ...includeArgs,
          ],
          stdout: 'inherit',
          stderr: 'inherit',
        });
      },
      {
        maxAttempts: crashRetries + 1,
        onCrash: ({ attempt, maxAttempts, code }) => {
          console.error(
            `\n[check-coverage] NATIVE CRASH: the coverage run terminated by ${describeNativeCrash(
              code,
            )} ` +
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

    return await readFile(join(coverageDir, 'lcov.info'), 'utf8');
  } finally {
    await rm(coverageDir, { recursive: true }).catch(() => undefined);
  }
}

function formatMetric(name: string, metric: CoverageMetric, threshold: number): string {
  return `${name}: ${metric.covered}/${metric.total} ${metric.percentage.toFixed(
    2,
  )}% (minimum ${threshold}%)`;
}

async function main(): Promise<void> {
  // Bounded crash retry for #1278: one clean run plus `--crash-retries`
  // retries that only fire on native-crash exits (>= 128 + signal), never on
  // assertion failures. Loud by design: every crash prints to stderr.
  const crashRetries = getNumberArg('--crash-retries', 2);
  // The per-scope detail report (denominators, not-exercised files, metric
  // lines) is a file artifact, not stdout content; parse the flag up front so
  // a malformed value fails before the expensive test run.
  const reportPath = reportPathArg(process.argv.slice(2));
  // vitest's lcov reporter writes SF paths relative to the vitest root; the
  // summarizer and scope predicates match absolute paths. Normalize once at
  // the read boundary — without it every in-scope file lands in the "never
  // loaded" bucket and every scope reads 0%.
  // Project-axis drift guard FIRST: it is cheap, and a drifted COVERAGE_PROJECTS
  // list invalidates the denominator the whole expensive run would measure.
  const projects = extractVitestProjects(
    await readFile(join(process.cwd(), VITEST_CONFIG_PATH), 'utf8'),
  );
  const drift = coverageProjectDrift(projects, await coverageProjectLines(import.meta.filename!));
  if (drift.length > 0) {
    console.error(
      `coverage: the vitest project axis drifted from COVERAGE_PROJECTS ` +
        `(${VITEST_CONFIG_PATH} vs ${COVERAGE_CHECKER_PATH}) — fix one side or the other; ` +
        'a drifted list silently changes the coverage denominator:',
    );
    for (const finding of drift) console.error(`  ${finding}`);
    process.exit(1);
  }
  const lcov = normalizeLcovSourcePaths(await runCoverage(crashRetries), process.cwd());
  const profiledFiles = lcovFilePaths(lcov);

  // Threshold baselines, measured with the full-denominator logic below on a
  // local `pnpm --dir tools/repo run test:coverage:check` run. Each scope
  // lists its last measured values, their date, and its thresholds; the three
  // must agree. Threshold changes must be explicit in the changing PR — state
  // the old value, the new value, and why — and must never be lowered silently
  // to make a red run pass.
  //   packages/*/src: measured 2026-08-04 (v0.42.0-alpha.14 cycle): lines
  //     81.46%, branches 85.24%, functions 87.66%; thresholds 80/80/80 until
  //     2026-07-15 (5bfe75d1d lowered lines to 69), 69/81/72 until 2026-07-24
  //     (da13c4911 raised to 73/82/77), 80/84/86 from the deno-era floor
  //     raise. RE-BASELINED 2026-10-03 (this PR): the vitest port's lcov SF
  //     paths went unmatched (normalizeLcovSourcePaths fix), so the gate had
  //     reported 0.00% since B1b/B3 and the deno-era numbers were the last
  //     real ones. First true vitest-era measurement: lines 82.96%, branches
  //     75.52%, functions 82.70% — branches/functions sit under the deno-era
  //     floors because v8 block coverage counts branches at finer
  //     granularity than deno coverage did and the B1-B5 train landed
  //     runtime code under unit-test floors. Floors set one point under the
  //     measured values (81/74/81); raise them only after re-measuring.
  //   tools/lib: measured 2026-08-04: lines 72.97%, branches 83.47%,
  //     functions 70.31%; thresholds 72/82/69. RE-BASELINED 2026-10-03
  //     (same cause): measured lines 78.36%, branches 62.99%, functions
  //     75.00%; floors one point under (77/61/74).
  //   www/tools/lib: measured 2026-10-03 (full-denominator logic, after the
  //     vitest-era lcov path fix): lines 60.42%, branches 70.52%, functions
  //     60.00%; floors one point under (59/69/59).
  const scopes: Array<{
    label: string;
    include: (path: string) => boolean;
    thresholds: { lines: number; branches: number; functions: number };
  }> = [
    {
      label: 'packages/*/src',
      include: isPackageSource,
      thresholds: {
        lines: getNumberArg('--threshold', 81),
        branches: getNumberArg('--branch-threshold', 74),
        functions: getNumberArg('--function-threshold', 81),
      },
    },
    {
      label: 'tools/lib',
      include: isToolsLibSource,
      thresholds: {
        lines: getNumberArg('--tools-threshold', 77),
        branches: getNumberArg('--tools-branch-threshold', 61),
        functions: getNumberArg('--tools-function-threshold', 74),
      },
    },
    {
      // Site tooling moved out of tools/lib; it carries its own scope so
      // neither directory's threshold is diluted by the other. Baseline:
      // measured 2026-10-03 (full-denominator logic, after the vitest-era
      // lcov path fix) at lines 60.42%, branches 70.52%, functions 60.00% —
      // thresholds 59/69/59 sit one point under. The IO-bound half of the
      // site-retired library is exercised by the gate runs, not unit tests,
      // which is why the line/function floors differ from tools/lib.
      label: 'www/tools/lib',
      include: isWwwToolsSource,
      thresholds: {
        // Floors sit one point under the measured values (60.42 / 70.52 /
        // 60.00, 2026-10-03); raise them when the measured values rise,
        // never lower them to make a red run pass.
        lines: getNumberArg('--site-tools-threshold', 59),
        branches: getNumberArg('--site-tools-branch-threshold', 69),
        functions: getNumberArg('--site-tools-function-threshold', 59),
      },
    },
  ];

  const failures: string[] = [];
  const reportLines: string[] = [];
  const scopeResults: string[] = [];
  for (const scope of scopes) {
    if (reportLines.length > 0) reportLines.push('');
    reportLines.push(`Coverage scope: ${scope.label}`);
    // Full denominator: every in-scope source file counts, even when no test
    // loaded it (the coverage provider only profiles imported modules). Unloaded files are
    // folded in as fully uncovered via an AST estimate of their coverable
    // elements.
    const treeFiles = await enumerateCoverageFiles(process.cwd(), scope.include);
    const uncovered: CoverableCounts[] = [];
    const missing: string[] = [];
    for (const path of treeFiles) {
      if (profiledFiles.has(path)) continue;
      missing.push(path);
      uncovered.push(countCoverableElements(await readFile(path, 'utf8'), path));
    }
    reportLines.push(
      `Denominator: ${treeFiles.length} source files ` +
        `(${missing.length} never loaded by any test, counted at 0%).`,
    );
    for (const path of missing) reportLines.push(`  not exercised: ${path}`);
    const summary = addUncoveredFiles(parseLcov(lcov, scope.include), uncovered);
    const measured: string[] = [];
    for (const name of ['lines', 'branches', 'functions'] as const) {
      reportLines.push(formatMetric(name, summary[name], scope.thresholds[name]));
      measured.push(`${name} ${summary[name].percentage.toFixed(2)}%`);
      if (summary[name].percentage < scope.thresholds[name]) {
        failures.push(
          `${scope.label} ${name} ${summary[name].percentage.toFixed(2)}% < minimum ` +
            `${scope.thresholds[name]}%`,
        );
      }
    }
    scopeResults.push(`${scope.label} ${measured.join(', ')}`);
  }

  if (reportPath !== undefined) {
    await writeFile(reportPath, `${reportLines.join('\n')}\n`, 'utf8');
  }

  if (failures.length) {
    throw new Error(`coverage threshold failed: ${failures.join(', ')}`);
  }
  emitSummary(
    `coverage: gate passed — ${scopeResults.join('; ')} ` +
      '(per-scope denominators and floors in the --report artifact).',
  );
}

if (import.meta.main) await main();
