/**
 * Structured Site E2E runner.
 *
 * Runs the official `www` Playwright suite and writes two artifacts:
 *   .artifacts/site-e2e-report.json — the raw Playwright JSON reporter output
 *   .artifacts/site-e2e-result.json — a compact sidecar manifest
 *     (see tools/repo/site-e2e-result.ts for the schema)
 *
 * Candidate evidence reads the sidecar, not free-text log lines, so a browser
 * name in an unrelated fixture's output can never fake the Site proof. The
 * runner fails closed unless Playwright succeeds AND every required browser
 * executed real tests with zero failures and zero skips.
 */
import { dirname, fromFileUrl, join } from '@std/path';
import {
  auditSiteE2e,
  type PlaywrightReport,
  SITE_E2E_PROJECTS,
  type SiteE2eResult,
  summarizePlaywrightReport,
} from './site-e2e-result.ts';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const artifactsDir = join(repoRoot, '.artifacts');
const reportPath = join(artifactsDir, 'site-e2e-report.json');
const resultPath = join(artifactsDir, 'site-e2e-result.json');
const siteDir = join(repoRoot, 'www');

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
    result = {
      ran: SITE_E2E_PROJECTS.every((project) => projects[project] !== undefined),
      projects,
      ...totals,
      generatedAt: new Date().toISOString(),
    };
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

  const failures = auditSiteE2e(result);
  if (!status.success) failures.unshift(`site-e2e: Playwright exited ${status.code}`);
  if (failures.length > 0) {
    console.error('site-e2e: candidate proof is not valid:');
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
}

if (import.meta.main) await main();
