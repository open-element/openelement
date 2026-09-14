/**
 * Site E2E result schema and the single canonical validator shared by the
 * runner (`site-e2e-run.ts`) and the candidate-evidence validator.
 *
 * The candidate proof requires that every project actually executed real tests:
 * a project with `passed === 0` or any `skipped`/`failed` test is not proof of a
 * green Site suite, so a fully skipped Playwright run (which exits 0) must still
 * fail closed. The validator recomputes from the sidecar's per-project and
 * total numbers; it never trusts the runner's `ran` boolean alone.
 */
export const SITE_E2E_PROJECTS = ['chromium', 'firefox', 'webkit'] as const;

export interface SiteProjectSummary {
  passed: number;
  failed: number;
  skipped: number;
}

export interface SiteE2eResult {
  ran: boolean;
  projects: Record<string, SiteProjectSummary>;
  passed: number;
  failed: number;
  skipped: number;
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
}

/** Pure per-project aggregation over a Playwright JSON report. */
export function summarizePlaywrightReport(
  report: PlaywrightReport,
): Record<string, SiteProjectSummary> {
  const projects: Record<string, SiteProjectSummary> = {};
  const ensure = (name: string): SiteProjectSummary => {
    projects[name] ??= { passed: 0, failed: 0, skipped: 0 };
    return projects[name];
  };
  const visit = (suites: PlaywrightSuite[] | undefined): void => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const name = test.projectName ?? 'unknown';
          const summary = ensure(name);
          const results = test.results ?? [];
          const failed = test.status === 'unexpected' ||
            results.some((result) =>
              result.status === 'failed' || result.status === 'timedOut' ||
              result.status === 'interrupted'
            );
          const skipped = test.status === 'skipped' ||
            (results.length > 0 && results.every((result) => result.status === 'skipped'));
          if (failed) summary.failed++;
          else if (skipped) summary.skipped++;
          else summary.passed++;
        }
      }
      visit(suite.suites);
    }
  };
  visit(report.suites);
  return projects;
}

/**
 * Fail-closed audit of a Site E2E result. Every required browser must exist
 * exactly once with non-negative integer counts, `passed > 0`, `failed === 0`,
 * and `skipped === 0`; the totals must equal the per-project sums. Unknown
 * extra projects are allowed but never required.
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
  const totals = { passed: 0, failed: 0, skipped: 0 };
  const count = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) >= 0;
  for (const browser of SITE_E2E_PROJECTS) {
    const summary = site.projects[browser];
    if (!summary) {
      failures.push(`Site E2E missing browser proof: ${browser}`);
      continue;
    }
    let valid = true;
    for (const field of ['passed', 'failed', 'skipped'] as const) {
      if (!count(summary[field])) {
        failures.push(
          `Site E2E ${browser}.${field} must be a non-negative safe integer, got ${
            JSON.stringify(summary[field])
          }`,
        );
        valid = false;
      }
    }
    if (!valid) continue;
    if (summary.failed !== 0) failures.push(`Site E2E ${browser} failed=${summary.failed}`);
    if (summary.skipped !== 0) {
      failures.push(
        `Site E2E ${browser} skipped=${summary.skipped} (candidate proof forbids skips)`,
      );
    }
    if (summary.passed <= 0) {
      failures.push(`Site E2E ${browser} passed=${summary.passed} (must be > 0)`);
    }
    totals.passed += summary.passed;
    totals.failed += summary.failed;
    totals.skipped += summary.skipped;
  }
  for (const field of ['passed', 'failed', 'skipped'] as const) {
    if (!count(site[field])) {
      failures.push(
        `Site E2E total ${field} must be a non-negative safe integer, got ${
          JSON.stringify(site[field])
        }`,
      );
      continue;
    }
    if (site[field] !== totals[field]) {
      failures.push(`Site E2E total ${field}=${site[field]} != sum of projects ${totals[field]}`);
    }
  }
  return failures;
}
