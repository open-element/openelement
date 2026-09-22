/**
 * Site E2E result schema and the single canonical validator shared by the
 * runner (`site-e2e-run.ts`) and the candidate-evidence validator.
 *
 * Evidence contract (fail closed on every axis):
 *   - exactly the three projects chromium/firefox/webkit — a missing browser
 *     is not proof, and an unexpected extra project means the suite was run
 *     with a different config;
 *   - per-browser `passed >= SITE_E2E_MIN_PASSED_PER_PROJECT` — the floor
 *     tracks the real suite size (currently 231 tests per browser, 693
 *     total) and MUST be raised when the suite grows, never lowered to force
 *     a pass, so a `--grep`-shrunk run cannot look green;
 *   - `expected` (Playwright `stats.expected`) plus `flaky` is a safe integer
 *     >= 3 * floor and equals the total executed tests, so the sidecar
 *     cannot shrink the suite by omission;
 *   - `configFile` is the canonical repo-relative `www/e2e/playwright.config.ts`;
 *   - `grep` must be present and serialize to an empty object. The JSON
 *     reporter serializes every RegExp as `{}`, so this field cannot by
 *     itself detect `--grep` — the runner rejects filtering flags outright
 *     and the floor/`expected` binding catches a shrunk run;
 *   - `reportSha256` (64 lowercase hex) binds the sidecar to the raw
 *     `.artifacts/site-e2e-report.json` bytes, and `candidateSha` (40 hex)
 *     binds it to the commit that ran the suite. candidate-evidence
 *     recomputes the summary and the hash from the raw report and requires
 *     the candidate SHA to match, so a forged or stale sidecar fails.
 *
 * A project with any `skipped`, `failed`, or never-started test is not proof
 * of a green Site suite, so a fully skipped Playwright run (which exits 0)
 * still fails closed. A test whose `results` array is empty never started and
 * counts as failed, not passed. The validator recomputes from the sidecar's
 * per-project and total numbers; it never trusts the runner's `ran` boolean
 * alone.
 *
 * ## Retries and the `flaky` count
 *
 * `www#e2e:browsers` runs with `--retries 1`, and the runner allowlists that
 * flag. A retry is therefore part of the contract, and a test that timed out
 * on the first attempt and passed on the retry is a pass with a recorded
 * retry — Playwright's own verdict: it reports such a test as `flaky`, keeps
 * it out of `stats.unexpected`, and exits 0. The suite's proof obligation
 * follows Playwright here, because the gate attests "the Site suite passed",
 * not "no runner ever hiccuped":
 *
 *   - `passed` counts every test that ultimately passed, INCLUDING a
 *     retry-cleared one (previously the first timed-out attempt was counted
 *     as a failure, so a Playwright-successful run was reported as a failed
 *     proof — the same commit that failed attempt 1 ran green on attempt 2);
 *   - `flaky` is the retry-cleared SUBSET of `passed`, recorded so the retry
 *     is visible in the evidence instead of laundered away, and bound to the
 *     raw report's own `stats.flaky`;
 *   - the suite-size identity is `expected + flaky === executed`, because
 *     `stats.expected` counts FIRST-ATTEMPT passes only;
 *   - `failed` keeps its meaning: the final attempt failed, the test never
 *     started, or Playwright says `unexpected`. `--retries 1` does not make a
 *     real failure disappear, and every other axis (skips, the per-browser
 *     floor, the executed-count binding, the byte/hash binding) is unchanged.
 */
export const SITE_E2E_PROJECTS = ['chromium', 'firefox', 'webkit'] as const;

/**
 * Minimum passed tests per browser. The real suite is currently 234 per
 * browser (702 total); 200 is deliberately conservative. Raise this when the
 * suite grows — see the header contract.
 */
export const SITE_E2E_MIN_PASSED_PER_PROJECT = 200;

/** Canonical Playwright config for the candidate proof (repo-relative POSIX). */
export const SITE_E2E_CONFIG_FILE = 'www/e2e/playwright.config.ts';

const SHA256_BARE_HEX = /^[0-9a-f]{64}$/u;
const COMMIT_HEX = /^[0-9a-f]{40}$/u;

export interface SiteProjectSummary {
  passed: number;
  failed: number;
  skipped: number;
  /**
   * Retry-cleared tests: the subset of `passed` whose first attempt failed
   * and whose retry passed. Recorded rather than folded away, so the retry is
   * visible in the evidence.
   */
  flaky: number;
}

export interface SiteE2eResult {
  ran: boolean;
  projects: Record<string, SiteProjectSummary>;
  passed: number;
  failed: number;
  skipped: number;
  /** Sum of the projects' `flaky` counts; see {@linkcode SiteProjectSummary}. */
  flaky: number;
  /**
   * Playwright `stats.expected` from the raw report — FIRST-ATTEMPT passes
   * only, so `expected + flaky` is the run's passing total.
   */
  expected: number;
  /** Repo-relative POSIX path of the Playwright config that produced the run. */
  configFile: string;
  /** `config.grep` exactly as the JSON reporter serialized it (`{}` when empty). */
  grep: unknown;
  /** Bare 64-char lowercase hex SHA-256 of the raw report file bytes. */
  reportSha256: string;
  /** `git rev-parse HEAD` at run time (40-char hex). */
  candidateSha: string;
  generatedAt: string;
}

export interface PlaywrightTest {
  projectName?: string;
  status?: string;
  results?: Array<{ status?: string }>;
}

export interface PlaywrightSpec {
  tests?: PlaywrightTest[];
}

export interface PlaywrightSuite {
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

export interface PlaywrightReport {
  suites?: PlaywrightSuite[];
  stats?: { expected?: number; unexpected?: number; skipped?: number; flaky?: number };
  config?: {
    configFile?: string;
    grep?: unknown;
    projects?: Array<{ name?: string }>;
  };
}

/** Bare-hex SHA-256 of the raw report bytes (sidecar `reportSha256` format). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

/** True only for a present, non-array object with zero keys (`{}`). */
export function isEmptyGrep(grep: unknown): boolean {
  return typeof grep === 'object' && grep !== null && !Array.isArray(grep) &&
    Object.keys(grep).length === 0;
}

/** Attempt statuses Playwright records for an attempt that did not pass. */
function attemptFailed(status: string | undefined): boolean {
  return status === 'failed' || status === 'timedOut' || status === 'interrupted';
}

/** Pure per-project aggregation over a Playwright JSON report. */
export function summarizePlaywrightReport(
  report: PlaywrightReport,
): Record<string, SiteProjectSummary> {
  const projects: Record<string, SiteProjectSummary> = {};
  const ensure = (name: string): SiteProjectSummary => {
    projects[name] ??= { passed: 0, failed: 0, skipped: 0, flaky: 0 };
    return projects[name];
  };
  const visit = (suites: PlaywrightSuite[] | undefined): void => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const name = test.projectName ?? 'unknown';
          const summary = ensure(name);
          const results = test.results ?? [];
          const last = results.at(-1)?.status;
          // Fail closed on the OUTCOME, not on any single attempt: a test with
          // no results never executed, Playwright's own `unexpected` verdict is
          // authoritative, and a final attempt that did not pass is a failure —
          // a retry only clears the attempts before it (see the header's retry
          // note: `--retries 1` is part of the contract, so a retry-cleared test
          // is a pass with a recorded retry, not a failure).
          const failed = results.length === 0 || test.status === 'unexpected' ||
            attemptFailed(last);
          const skipped = !failed && (test.status === 'skipped' ||
            results.every((result) => result.status === 'skipped'));
          // Retry-cleared: the final attempt passed, an earlier one did not.
          // Counted in `passed` AND recorded in `flaky`.
          const wasFlaky = !failed && !skipped &&
            results.slice(0, -1).some((result) => attemptFailed(result.status));
          if (failed) summary.failed++;
          else if (skipped) summary.skipped++;
          else {
            summary.passed++;
            if (wasFlaky) summary.flaky++;
          }
        }
      }
      visit(suite.suites);
    }
  };
  visit(report.suites);
  return projects;
}

/**
 * Fail-closed audit of a Site E2E result. Exactly the three required
 * browsers must exist with non-negative integer counts, `passed` at or above
 * the per-project floor, `failed === 0`, and `skipped === 0`; the totals
 * must equal the per-project sums; `expected` must match the executed test
 * count; and the identity fields (`configFile`, `grep`, `reportSha256`,
 * `candidateSha`) must be present and well-formed. Extra projects, a shrunk
 * suite, or a missing identity field are all failures.
 */
export function auditSiteE2e(site: Partial<SiteE2eResult> | undefined): string[] {
  const failures: string[] = [];
  if (!site || site.ran !== true) {
    failures.push('official Site E2E did not run or did not pass');
    return failures;
  }
  if (!site.projects || typeof site.projects !== 'object') {
    failures.push('Site E2E projects missing');
    return failures;
  }
  const extraProjects = Object.keys(site.projects).filter((name) =>
    !(SITE_E2E_PROJECTS as readonly string[]).includes(name)
  );
  if (extraProjects.length > 0) {
    failures.push(`Site E2E unexpected extra projects: ${extraProjects.sort().join(', ')}`);
  }
  const totals = { passed: 0, failed: 0, skipped: 0, flaky: 0 };
  let executed = 0;
  let countsValid = true;
  const count = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) >= 0;
  for (const browser of SITE_E2E_PROJECTS) {
    const summary = site.projects[browser];
    if (!summary) {
      failures.push(`Site E2E missing browser proof: ${browser}`);
      countsValid = false;
      continue;
    }
    let valid = true;
    for (const field of ['passed', 'failed', 'skipped', 'flaky'] as const) {
      if (!count(summary[field])) {
        failures.push(
          `Site E2E ${browser}.${field} must be a non-negative safe integer, got ${
            JSON.stringify(summary[field])
          }`,
        );
        valid = false;
      }
    }
    if (!valid) {
      countsValid = false;
      continue;
    }
    if (summary.failed !== 0) failures.push(`Site E2E ${browser} failed=${summary.failed}`);
    if (summary.skipped !== 0) {
      failures.push(
        `Site E2E ${browser} skipped=${summary.skipped} (candidate proof forbids skips)`,
      );
    }
    // `flaky` is a subset of `passed`, so this can only fail on a forged or
    // mismatched summary — a retry-cleared test is never double counted.
    if (summary.flaky > summary.passed) {
      failures.push(
        `Site E2E ${browser} flaky=${summary.flaky} > passed=${summary.passed} (flaky is a subset of passed)`,
      );
    }
    if (summary.passed < SITE_E2E_MIN_PASSED_PER_PROJECT) {
      failures.push(
        `Site E2E ${browser} passed=${summary.passed} (must be >= ${SITE_E2E_MIN_PASSED_PER_PROJECT}; a filtered run is not candidate proof)`,
      );
    }
    totals.passed += summary.passed;
    totals.failed += summary.failed;
    totals.skipped += summary.skipped;
    totals.flaky += summary.flaky;
    executed += summary.passed + summary.failed + summary.skipped;
  }
  for (const field of ['passed', 'failed', 'skipped', 'flaky'] as const) {
    if (!count(site[field])) {
      failures.push(
        `Site E2E total ${field} must be a non-negative safe integer, got ${
          JSON.stringify(site[field])
        }`,
      );
      continue;
    }
    if (countsValid && site[field] !== totals[field]) {
      failures.push(`Site E2E total ${field}=${site[field]} != sum of projects ${totals[field]}`);
    }
  }
  const minimumExpected = SITE_E2E_MIN_PASSED_PER_PROJECT * SITE_E2E_PROJECTS.length;
  if (!Number.isSafeInteger(site.expected) || (site.expected as number) < minimumExpected) {
    failures.push(
      `Site E2E expected must be a safe integer >= ${minimumExpected}, got ${
        JSON.stringify(site.expected)
      }`,
    );
  } else if (countsValid && (site.flaky as number) + (site.expected as number) !== executed) {
    // `stats.expected` counts first-attempt passes, so the suite-size identity
    // is expected + flaky === executed (see the header's retry note).
    failures.push(
      `Site E2E flaky=${site.flaky}+expected=${site.expected} != executed tests ${executed}`,
    );
  }
  if (site.configFile !== SITE_E2E_CONFIG_FILE) {
    failures.push(
      `Site E2E configFile must be ${SITE_E2E_CONFIG_FILE}, got ${JSON.stringify(site.configFile)}`,
    );
  }
  if (!isEmptyGrep(site.grep)) {
    failures.push(
      `Site E2E grep must be present and serialize to an empty object, got ${
        JSON.stringify(site.grep)
      }`,
    );
  }
  if (typeof site.reportSha256 !== 'string' || !SHA256_BARE_HEX.test(site.reportSha256)) {
    failures.push(
      `Site E2E reportSha256 must be 64 lowercase hex chars, got ${
        JSON.stringify(site.reportSha256)
      }`,
    );
  }
  if (typeof site.candidateSha !== 'string' || !COMMIT_HEX.test(site.candidateSha)) {
    failures.push(
      `Site E2E candidateSha must be a 40-char hex commit, got ${
        JSON.stringify(site.candidateSha)
      }`,
    );
  }
  return failures;
}
