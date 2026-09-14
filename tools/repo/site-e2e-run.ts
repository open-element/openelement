/**
 * Structured Site E2E runner.
 *
 * Runs the official `apps/site` Playwright suite and writes two artifacts:
 *   .artifacts/site-e2e-report.json — the raw Playwright JSON reporter output
 *   .artifacts/site-e2e-result.json — a compact sidecar manifest:
 *     { ran, projects: { chromium: {passed,failed,skipped}, ... }, passed,
 *       failed, skipped, generatedAt }
 *
 * Candidate evidence reads the sidecar, not free-text log lines, so a browser
 * name in an unrelated fixture's output can never fake the Site proof. The
 * runner fails closed if Playwright exits non-zero, a required project is
 * missing, or any test failed.
 */
import { dirname, fromFileUrl, join } from '@std/path';

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

interface PlaywrightTest {
  projectName?: string;
  status?: string;
  results?: Array<{ status?: string }>;
}

interface PlaywrightSpec {
  tests?: PlaywrightTest[];
}

interface PlaywrightSuite {
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightReport {
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

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const artifactsDir = join(repoRoot, '.artifacts');
const reportPath = join(artifactsDir, 'site-e2e-report.json');
const resultPath = join(artifactsDir, 'site-e2e-result.json');
const siteDir = join(repoRoot, 'apps/site');

async function writeResult(result: SiteE2eResult): Promise<void> {
  await Deno.mkdir(dirname(resultPath), { recursive: true });
  await Deno.writeTextFile(resultPath, JSON.stringify(result, null, 2) + '\n');
}

async function main(): Promise<void> {
  await Deno.mkdir(artifactsDir, { recursive: true });
  await Deno.remove(reportPath).catch(() => undefined);
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '--config',
      join(repoRoot, 'deno.json'),
      '--allow-read',
      '--allow-write',
      '--allow-env',
      '--allow-net',
      '--allow-run',
      '--allow-sys',
      'npm:@playwright/test@1.59.1',
      'test',
      '--config',
      'e2e/playwright.config.ts',
      '--reporter=list,json',
      ...Deno.args,
    ],
    cwd: siteDir,
    env: { ...Deno.env.toObject(), PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'null',
  });
  const status = await command.output();

  let result: SiteE2eResult;
  try {
    const report = JSON.parse(await Deno.readTextFile(reportPath)) as PlaywrightReport;
    const projects = summarizePlaywrightReport(report);
    const totals = { passed: 0, failed: 0, skipped: 0 };
    for (const summary of Object.values(projects)) {
      totals.passed += summary.passed;
      totals.failed += summary.failed;
      totals.skipped += summary.skipped;
    }
    const missing = SITE_E2E_PROJECTS.filter((project) => !projects[project]);
    result = {
      ran: missing.length === 0,
      projects,
      ...totals,
      generatedAt: new Date().toISOString(),
    };
    if (missing.length > 0) {
      console.error(`site-e2e: missing project output: ${missing.join(', ')}`);
    }
  } catch (error) {
    console.error(`site-e2e: no usable Playwright report: ${error}`);
    result = {
      ran: false,
      projects: {},
      passed: 0,
      failed: 0,
      skipped: 0,
      generatedAt: new Date().toISOString(),
    };
  }
  await writeResult(result);
  if (!status.success || !result.ran || result.failed > 0) {
    Deno.exit(1);
  }
}

if (import.meta.main) await main();
