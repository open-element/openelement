/**
 * Site E2E fail-closed tests. The candidate proof must reject zero-pass,
 * skipped, failed, missing, extra, or malformed browser evidence — including
 * a fully skipped Playwright run, which exits 0 but proves nothing — plus a
 * shrunk suite (below the per-browser floor), a filtered config, a wrong
 * config file, an incomplete identity manifest, and a test that never
 * executed (empty `results`) masquerading as passed.
 */
import { expect, test } from 'vitest';
import {
  auditSiteE2e,
  SITE_E2E_CONFIG_FILE,
  SITE_E2E_MIN_PASSED_PER_PROJECT,
  SITE_E2E_PROJECTS,
  type SiteE2eResult,
  summarizePlaywrightReport,
} from './site-e2e-result.ts';
import { checkRunnerArgs } from './site-e2e-run.ts';

const PASSED_PER_BROWSER = 243;
const TOTAL = PASSED_PER_BROWSER * SITE_E2E_PROJECTS.length;

function healthy(): SiteE2eResult {
  const projects = Object.fromEntries(
    SITE_E2E_PROJECTS.map((browser) => [
      browser,
      { passed: PASSED_PER_BROWSER, failed: 0, skipped: 0, flaky: 0 },
    ]),
  );
  return {
    ran: true,
    projects,
    passed: TOTAL,
    failed: 0,
    skipped: 0,
    flaky: 0,
    expected: TOTAL,
    configFile: SITE_E2E_CONFIG_FILE,
    grep: {},
    reportSha256: 'a'.repeat(64),
    candidateSha: 'b'.repeat(40),
    generatedAt: new Date().toISOString(),
  };
}

test('site e2e audit accepts a healthy three-browser result', () => {
  expect(auditSiteE2e(healthy())).toEqual([]);
});

test('site e2e audit accepts the exact floor', () => {
  const result = healthy();
  for (const browser of SITE_E2E_PROJECTS) {
    result.projects[browser] = {
      passed: SITE_E2E_MIN_PASSED_PER_PROJECT,
      failed: 0,
      skipped: 0,
      flaky: 0,
    };
  }
  result.passed = SITE_E2E_MIN_PASSED_PER_PROJECT * SITE_E2E_PROJECTS.length;
  result.expected = result.passed;
  expect(auditSiteE2e(result)).toEqual([]);
});

test('site e2e audit accepts a retry-cleared run and records the retries', () => {
  // The shape that a `--retries 1` run produces when one test per browser
  // times out and passes on the retry: Playwright exits 0 with
  // `unexpected: 0, flaky: 3`, so `stats.expected` counts 726 of the 729
  // executed tests and the three retry-cleared ones are the difference. The
  // proof must accept it (the runner allowlists `--retries 1`) while keeping
  // the retry visible.
  const flakyPerBrowser = 1;
  const result = healthy();
  for (const browser of SITE_E2E_PROJECTS) {
    result.projects[browser] = {
      passed: PASSED_PER_BROWSER,
      failed: 0,
      skipped: 0,
      flaky: flakyPerBrowser,
    };
  }
  result.flaky = flakyPerBrowser * SITE_E2E_PROJECTS.length;
  result.expected = result.passed - result.flaky;
  expect(auditSiteE2e(result)).toEqual([]);

  // A retry cannot inflate the pass count: `flaky` is a subset of `passed`.
  const inflated = healthy();
  inflated.projects.chromium = { passed: 243, failed: 0, skipped: 0, flaky: 244 };
  inflated.flaky = 244;
  expect(
    auditSiteE2e(inflated).some((f) => f.includes('chromium flaky=244 > passed=243')),
  ).toBeTruthy();

  // ...and the executed-count binding moves with it, so a summary that hides
  // retries (expected alone == executed) is rejected when retries happened.
  const hidden = healthy();
  hidden.flaky = 2;
  expect(
    auditSiteE2e(hidden).some((f) => f.includes('flaky=2+expected=') && f.includes('executed')),
  ).toBeTruthy();
});

test('site e2e audit rejects a fully skipped run', () => {
  const result = healthy();
  for (const browser of SITE_E2E_PROJECTS) {
    result.projects[browser] = { passed: 0, failed: 0, skipped: PASSED_PER_BROWSER, flaky: 0 };
  }
  result.passed = 0;
  result.skipped = TOTAL;
  const failures = auditSiteE2e(result);
  for (const browser of SITE_E2E_PROJECTS) {
    expect(failures.some((f) => f.includes(`${browser} passed=0`))).toBeTruthy();
    expect(
      failures.some((f) => f.includes(`${browser} skipped=${PASSED_PER_BROWSER}`)),
    ).toBeTruthy();
  }
});

test('site e2e audit rejects zero-pass, skipped, and failed projects', () => {
  const zero = healthy();
  zero.projects.chromium = { passed: 0, failed: 0, skipped: 0, flaky: 0 };
  zero.passed -= PASSED_PER_BROWSER;
  expect(auditSiteE2e(zero).some((f) => f.includes('chromium passed=0'))).toBeTruthy();

  const skipped = healthy();
  skipped.projects.firefox = { passed: 200, failed: 0, skipped: 31, flaky: 0 };
  skipped.passed = TOTAL - 31;
  skipped.skipped = 31;
  expect(auditSiteE2e(skipped).some((f) => f.includes('firefox skipped=31'))).toBeTruthy();

  const failed = healthy();
  failed.projects.webkit = { passed: 229, failed: 2, skipped: 0, flaky: 0 };
  failed.passed -= 2;
  failed.failed = 2;
  expect(auditSiteE2e(failed).some((f) => f.includes('webkit failed=2'))).toBeTruthy();
});

test('site e2e audit rejects a missing browser, a single-browser run, and ran=false', () => {
  const missing = healthy();
  delete (missing.projects as Record<string, unknown>).webkit;
  expect(
    auditSiteE2e(missing).some((f) => f.includes('missing browser proof: webkit')),
  ).toBeTruthy();

  const single = healthy();
  single.projects = { chromium: { passed: PASSED_PER_BROWSER, failed: 0, skipped: 0, flaky: 0 } };
  single.passed = PASSED_PER_BROWSER;
  single.expected = PASSED_PER_BROWSER;
  const singleFailures = auditSiteE2e(single);
  expect(singleFailures.some((f) => f.includes('missing browser proof: firefox'))).toBeTruthy();
  expect(singleFailures.some((f) => f.includes('missing browser proof: webkit'))).toBeTruthy();
  expect(singleFailures.some((f) => f.includes('expected must be a safe integer'))).toBeTruthy();

  expect(auditSiteE2e({ ...healthy(), ran: false })).toEqual([
    'official Site E2E did not run or did not pass',
  ]);
  expect(auditSiteE2e(undefined)).toEqual(['official Site E2E did not run or did not pass']);
});

test('site e2e audit rejects an unexpected extra project', () => {
  const result = healthy();
  (result.projects as Record<string, unknown>).opera = {
    passed: 243,
    failed: 0,
    skipped: 0,
    flaky: 0,
  };
  expect(
    auditSiteE2e(result).some((f) => f.includes('unexpected extra projects: opera')),
  ).toBeTruthy();
});

test('site e2e audit rejects a suite shrunk below the per-browser floor', () => {
  const result = healthy();
  result.projects.chromium = {
    passed: SITE_E2E_MIN_PASSED_PER_PROJECT - 1,
    failed: 0,
    skipped: 0,
    flaky: 0,
  };
  result.passed = TOTAL - (PASSED_PER_BROWSER - SITE_E2E_MIN_PASSED_PER_PROJECT + 1);
  result.expected = result.passed;
  const failures = auditSiteE2e(result);
  expect(
    failures.some(
      (f) =>
        f.includes(`chromium passed=${SITE_E2E_MIN_PASSED_PER_PROJECT - 1}`) &&
        f.includes(`must be >= ${SITE_E2E_MIN_PASSED_PER_PROJECT}`),
    ),
  ).toBeTruthy();
});

test('site e2e audit rejects a forged or shrunk expected count', () => {
  const shrunk = healthy();
  shrunk.expected = 3;
  expect(
    auditSiteE2e(shrunk).some((f) => f.includes('expected must be a safe integer >=')),
  ).toBeTruthy();

  const mismatched = healthy();
  mismatched.expected = TOTAL + 1;
  expect(
    auditSiteE2e(mismatched).some((f) => f.includes(`expected=${TOTAL + 1} != executed tests`)),
  ).toBeTruthy();

  const missing = healthy() as unknown as Record<string, unknown>;
  delete missing.expected;
  expect(
    auditSiteE2e(missing as unknown as SiteE2eResult).some((f) => f.includes('expected must be')),
  ).toBeTruthy();
});

test('site e2e audit rejects a wrong or missing configFile', () => {
  for (const bad of [
    'e2e/playwright.config.ts',
    '/abs/www/e2e/playwright.config.ts',
    '',
    undefined,
  ]) {
    const result = healthy() as unknown as Record<string, unknown>;
    result.configFile = bad;
    expect(
      auditSiteE2e(result as unknown as SiteE2eResult).some((f) =>
        f.includes('configFile must be www/e2e/playwright.config.ts'),
      ),
      `expected configFile rejection for ${JSON.stringify(bad)}`,
    ).toBeTruthy();
  }
});

test('site e2e audit rejects a non-empty, malformed, or missing grep', () => {
  for (const bad of [{ source: 'foo' }, 'foo', ['foo'], null, undefined, 0]) {
    const result = healthy() as unknown as Record<string, unknown>;
    result.grep = bad;
    expect(
      auditSiteE2e(result as unknown as SiteE2eResult).some((f) =>
        f.includes('grep must be present and serialize to an empty object'),
      ),
      `expected grep rejection for ${JSON.stringify(bad)}`,
    ).toBeTruthy();
  }
});

test('site e2e audit rejects a missing or malformed reportSha256', () => {
  for (const bad of ['', 'a'.repeat(63), 'A'.repeat(64), `sha256:${'a'.repeat(64)}`, undefined]) {
    const result = healthy() as unknown as Record<string, unknown>;
    result.reportSha256 = bad;
    expect(
      auditSiteE2e(result as unknown as SiteE2eResult).some((f) =>
        f.includes('reportSha256 must be 64 lowercase hex chars'),
      ),
      `expected reportSha256 rejection for ${JSON.stringify(bad)}`,
    ).toBeTruthy();
  }
});

test('site e2e audit rejects a missing or malformed candidateSha', () => {
  for (const bad of ['', 'b'.repeat(39), 'B'.repeat(40), undefined]) {
    const result = healthy() as unknown as Record<string, unknown>;
    result.candidateSha = bad;
    expect(
      auditSiteE2e(result as unknown as SiteE2eResult).some((f) =>
        f.includes('candidateSha must be a 40-char hex commit'),
      ),
      `expected candidateSha rejection for ${JSON.stringify(bad)}`,
    ).toBeTruthy();
  }
});

test('site e2e audit rejects inconsistent totals', () => {
  const result = healthy();
  result.passed += 1;
  expect(auditSiteE2e(result).some((f) => f.includes('total passed='))).toBeTruthy();
  const result2 = healthy();
  result2.failed = 1;
  expect(auditSiteE2e(result2).some((f) => f.includes('total failed='))).toBeTruthy();
});

test('site e2e audit rejects non-integer, negative, string, and NaN values', () => {
  for (const bad of [-1, 1.5, '243', Number.NaN, null, undefined]) {
    const result = healthy() as unknown as { projects: Record<string, { passed: unknown }> };
    result.projects.chromium.passed = bad;
    expect(
      auditSiteE2e(result as unknown as SiteE2eResult).some((f) =>
        f.includes('chromium.passed must be a non-negative safe integer'),
      ),
      `expected rejection for ${JSON.stringify(bad)}`,
    ).toBeTruthy();
  }
  const badTotal = healthy() as unknown as Record<string, unknown>;
  badTotal.passed = '729';
  expect(
    auditSiteE2e(badTotal as unknown as SiteE2eResult).some((f) => f.includes('total passed')),
  ).toBeTruthy();
});

test('summarizePlaywrightReport counts per project and skips', () => {
  const report = {
    suites: [
      {
        specs: [
          {
            tests: [
              { projectName: 'chromium', status: 'expected', results: [{ status: 'passed' }] },
              { projectName: 'chromium', status: 'unexpected', results: [{ status: 'failed' }] },
              { projectName: 'firefox', status: 'skipped', results: [{ status: 'skipped' }] },
            ],
          },
        ],
      },
    ],
  };
  expect(summarizePlaywrightReport(report)).toEqual({
    chromium: { passed: 1, failed: 1, skipped: 0, flaky: 0 },
    firefox: { passed: 0, failed: 0, skipped: 1, flaky: 0 },
  });
});

test('summarizePlaywrightReport counts a retry-cleared test as a pass and a retry', () => {
  // Exactly the alpha.4 attempt-1 shape: a first attempt that timed out, a
  // retry that passed, Playwright reporting the test as `flaky` with
  // `unexpected: 0`. Two such tests, and one that failed both attempts —
  // which stays a failure, because `--retries 1` must not launder a real one.
  const report = {
    suites: [
      {
        specs: [
          {
            tests: [
              {
                projectName: 'chromium',
                status: 'flaky',
                results: [{ status: 'timedOut' }, { status: 'passed' }],
              },
              {
                projectName: 'chromium',
                status: 'flaky',
                results: [{ status: 'failed' }, { status: 'passed' }],
              },
              {
                projectName: 'firefox',
                status: 'unexpected',
                results: [{ status: 'failed' }, { status: 'failed' }],
              },
              {
                projectName: 'webkit',
                status: 'flaky',
                // A retry that itself timed out is a failure, not a flake.
                results: [{ status: 'passed' }, { status: 'timedOut' }],
              },
            ],
          },
        ],
      },
    ],
  };
  expect(summarizePlaywrightReport(report)).toEqual({
    chromium: { passed: 2, failed: 0, skipped: 0, flaky: 2 },
    firefox: { passed: 0, failed: 1, skipped: 0, flaky: 0 },
    webkit: { passed: 0, failed: 1, skipped: 0, flaky: 0 },
  });
});

test('summarizePlaywrightReport fails closed on a test that never executed', () => {
  const report = {
    suites: [
      {
        specs: [
          {
            tests: [
              { projectName: 'chromium', status: 'expected', results: [] },
              { projectName: 'firefox', status: 'expected' },
              { projectName: 'webkit', status: 'expected', results: [{ status: 'passed' }] },
            ],
          },
        ],
      },
    ],
  };
  expect(summarizePlaywrightReport(report)).toEqual({
    chromium: { passed: 0, failed: 1, skipped: 0, flaky: 0 },
    firefox: { passed: 0, failed: 1, skipped: 0, flaky: 0 },
    webkit: { passed: 1, failed: 0, skipped: 0, flaky: 0 },
  });
});

test('runner args reject suite-filtering flags before Playwright launches', () => {
  for (const args of [
    ['--grep', 'foo'],
    ['--grep=foo'],
    ['-g', 'foo'],
    ['--grep-invert', 'foo'],
    ['--project', 'chromium'],
    ['--project=chromium'],
    ['--only-changed'],
    ['--last-failed'],
    ['--list'],
    ['e2e/specs/home.spec.ts'],
    ['--headed'],
    ['--repeat-each', '2'],
    ['--repeat-each=3'],
    ['--workers'],
  ]) {
    expect(
      checkRunnerArgs(args) !== null,
      `expected rejection for ${JSON.stringify(args)}`,
    ).toBeTruthy();
  }
});

test('runner args allow only benign knobs', () => {
  expect(checkRunnerArgs([])).toEqual(null);
  expect(checkRunnerArgs(['--workers', '4'])).toEqual(null);
  expect(checkRunnerArgs(['--workers=4'])).toEqual(null);
  expect(checkRunnerArgs(['--retries', '1', '--timeout', '30000'])).toEqual(null);
  expect(checkRunnerArgs(['--repeat-each', '1'])).toEqual(null);
  expect(checkRunnerArgs(['--repeat-each=1'])).toEqual(null);
});
