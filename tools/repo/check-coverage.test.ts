import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRejectsIncludes } from '../../tests/lib/vitest-asserts.ts';
import {
  classifyTestExit,
  COVERAGE_CHECKER_PATH,
  COVERAGE_INCLUDES,
  COVERAGE_PROJECTS,
  coverageProjectDrift,
  coverageProjectLines,
  describeNativeCrash,
  extractVitestProjects,
  runTestSuiteWithCrashRetry,
  VITEST_CONFIG_PATH,
} from './check-coverage.ts';
import {
  enumerateCoverageFiles,
  isPackageSource,
  isToolsLibSource,
  isWwwToolsSource,
} from './coverage-summary.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Picomatch-shaped match for the two wildcards the include set uses. */
function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*');
  return new RegExp(`^${pattern}$`);
}

function scriptedRunner(codes: number[]): {
  runner: () => Promise<{ code: number }>;
  calls: () => number;
} {
  let calls = 0;
  return {
    runner: () => {
      const code = codes[Math.min(calls, codes.length - 1)];
      calls++;
      return Promise.resolve({ code });
    },
    calls: () => calls,
  };
}

test('classifyTestExit separates real failures from native crashes (#1278)', () => {
  expect(classifyTestExit(0)).toEqual('ok');
  // vitest reports assertion failures as exit code 1; usage and spawn
  // errors stay below the 128 + signal floor. None of these may be retried.
  expect(classifyTestExit(1)).toEqual('test-failure');
  expect(classifyTestExit(2)).toEqual('test-failure');
  expect(classifyTestExit(127)).toEqual('test-failure');
  // Signal-terminated processes surface as 128 + signal number.
  expect(classifyTestExit(128)).toEqual('native-crash');
  expect(classifyTestExit(132)).toEqual('native-crash'); // SIGILL
  expect(classifyTestExit(134)).toEqual('native-crash'); // SIGABRT
  expect(classifyTestExit(139)).toEqual('native-crash'); // SIGSEGV
});

test('describeNativeCrash names known signals and stays explicit for unknown ones', () => {
  expect(describeNativeCrash(139)).toContain('SIGSEGV');
  expect(describeNativeCrash(139)).toContain('139');
  expect(describeNativeCrash(134)).toContain('SIGABRT');
  expect(describeNativeCrash(200)).toContain('signal 72');
  expect(describeNativeCrash(200)).toContain('200');
});

test('a crash without any assertion failure is retried and can recover', async () => {
  const { runner, calls } = scriptedRunner([139, 139, 0]);
  const crashes: number[] = [];

  const result = await runTestSuiteWithCrashRetry(runner, {
    maxAttempts: 3,
    onCrash: ({ attempt }) => crashes.push(attempt),
  });

  expect(result).toEqual({ crashes: 2 });
  expect(calls()).toEqual(3);
  // Every crash is reported loudly, in order, so flakes stay countable.
  expect(crashes).toEqual([1, 2]);
});

test('a real assertion failure fails immediately without any retry', async () => {
  const { runner, calls } = scriptedRunner([1, 0]);
  let crashes = 0;

  const error = await assertRejectsIncludes(
    () => runTestSuiteWithCrashRetry(runner, { maxAttempts: 3, onCrash: () => crashes++ }),
    Error,
  );

  expect(error.message).toContain('tests failed with code 1');
  expect(calls()).toEqual(1);
  expect(crashes).toEqual(0);
});

test('crash exhaustion fails loudly after the bounded attempt count', async () => {
  const { runner, calls } = scriptedRunner([139]);
  const crashes: Array<{ attempt: number; maxAttempts: number; code: number }> = [];

  const error = await assertRejectsIncludes(
    () =>
      runTestSuiteWithCrashRetry(runner, {
        maxAttempts: 3,
        onCrash: (event) => crashes.push(event),
      }),
    Error,
  );

  expect(calls()).toEqual(3);
  expect(error.message).toContain('crashed natively');
  expect(error.message).toContain('SIGSEGV');
  expect(error.message).toContain('3');
  expect(crashes).toEqual([
    { attempt: 1, maxAttempts: 3, code: 139 },
    { attempt: 2, maxAttempts: 3, code: 139 },
    { attempt: 3, maxAttempts: 3, code: 139 },
  ]);
});

test('the instrumentation includes instrument every source the denominator counts', async () => {
  // The denominator is the scope predicate (every in-scope source on disk);
  // the include set decides what vitest actually profiles. A source the
  // predicate counts but the includes ignore never reaches the LCOV report,
  // so it is folded in at 0% — the six-package split left 22 protocol and 19
  // compiler files in exactly that state (3276 estimated uncovered lines).
  const inScope = (path: string): boolean =>
    isPackageSource(path) || isToolsLibSource(path) || isWwwToolsSource(path);
  const denominator = await enumerateCoverageFiles(repoRoot, inScope);
  const matchers = COVERAGE_INCLUDES.map((glob) => globToRegExp(glob));
  const uninstrumented = denominator.filter((path) => {
    const repoRelative = relative(repoRoot, path).replaceAll('\\', '/');
    return !matchers.some((matcher) => matcher.test(repoRelative));
  });

  expect(
    uninstrumented,
    'denominator-only sources (counted at 0% because no include instruments them): ' +
      uninstrumented.slice(0, 5).join(', '),
  ).toEqual([]);
});

test('different crash signals across attempts still count toward the same bound', async () => {
  const { runner, calls } = scriptedRunner([134, 139, 0]);

  const result = await runTestSuiteWithCrashRetry(runner, { maxAttempts: 3 });

  expect(result).toEqual({ crashes: 2 });
  expect(calls()).toEqual(3);
});

test('maxAttempts must be a positive integer', async () => {
  const { runner, calls } = scriptedRunner([0]);
  await assertRejectsIncludes(
    () => runTestSuiteWithCrashRetry(runner, { maxAttempts: 0 }),
    Error,
    'positive integer',
  );
  await assertRejectsIncludes(
    () => runTestSuiteWithCrashRetry(runner, { maxAttempts: 1.5 }),
    Error,
    'positive integer',
  );
  expect(calls()).toEqual(0);
});

// ─── Project-axis drift guard (COVERAGE_PROJECTS vs vitest.config.ts) ───────

test('COVERAGE_PROJECTS matches the vitest node project axis in the real config', async () => {
  // The consumer-form pin: the list is a secondary copy of the root config's
  // project axis, and this test fails on exactly the drift that #1566's
  // compiler split caused (a new node project absent from COVERAGE_PROJECTS).
  const config = await readFile(join(repoRoot, VITEST_CONFIG_PATH), 'utf8');
  const projects = extractVitestProjects(config);
  const drift = coverageProjectDrift(projects, await coverageProjectLines(import.meta.filename!));
  expect(
    drift,
    `project-axis drift (fix vitest.config.ts or check-coverage.ts): ${drift.join(' | ')}`,
  ).toEqual([]);
});

test('extractVitestProjects reads names, lines, and browser mode from the real config', async () => {
  const config = await readFile(join(repoRoot, VITEST_CONFIG_PATH), 'utf8');
  const projects = extractVitestProjects(config);
  const names = projects.map((project) => project.name);
  // Every declared coverage project is a parsed vitest project...
  for (const name of COVERAGE_PROJECTS) expect(names).toContain(name);
  // ...and the browser-mode project is recognized so it can be excluded by
  // the derived rule instead of a name list.
  const browser = projects.find((project) => project.name === 'element-browser');
  expect(browser).toBeDefined();
  expect(browser!.browserEnabled).toEqual(true);
  for (const project of projects) {
    if (project.name === 'element-browser') continue;
    expect(project.browserEnabled, project.name).toEqual(false);
    expect(project.line).toBeGreaterThan(0);
  }
});

test('a missing vitest node project is named with both files and lines', () => {
  const drift = coverageProjectDrift(
    [
      { name: 'element', line: 133, browserEnabled: false },
      { name: 'future-project', line: 42, browserEnabled: false },
    ],
    new Map([['element', 100]]),
  );
  expect(drift.length).toBeGreaterThan(0);
  const joined = drift.join('\n');
  expect(joined).toContain(VITEST_CONFIG_PATH);
  expect(joined).toContain(COVERAGE_CHECKER_PATH);
  // The vitest-side finding names the exact config line.
  expect(joined).toMatch(/vitest\.config\.ts:42/);
  expect(joined).toContain("'future-project'");
});

test('a phantom COVERAGE_PROJECTS entry is named with its own line', async () => {
  // The line map comes from the checker's own source, not the test file.
  const lines = await coverageProjectLines(join(repoRoot, COVERAGE_CHECKER_PATH));
  // Drop one declared project from the vitest side: the list now carries an
  // entry that matches no config project.
  const vitestSide = COVERAGE_PROJECTS.filter((name) => name !== 'benchmarks').map((name) => ({
    name,
    line: 1,
    browserEnabled: false,
  }));
  const drift = coverageProjectDrift(vitestSide, lines);
  const phantom = drift.filter((finding) => finding.includes("'benchmarks'"));
  expect(phantom.length).toEqual(1);
  expect(phantom[0]).toContain('--project flag that selects nothing');
  expect(phantom[0]).toContain(`${lines.get('benchmarks')}`);
});

test('an unparseable config refuses to pass vacuously', () => {
  const drift = coverageProjectDrift([], new Map());
  expect(drift.length).toEqual(1);
  expect(drift[0]).toContain('no vitest projects could be parsed');
});
