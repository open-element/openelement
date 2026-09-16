/**
 * Structured Site E2E runner.
 *
 * Runs the official `www` Playwright suite and writes two artifacts:
 *   .artifacts/site-e2e-report.json — the raw Playwright JSON reporter
 *     output. This file IS the evidence-tree copy of the report:
 *     candidate-evidence stages these exact bytes into the source-matrix
 *     evidence bundle and recomputes the sidecar from them, so nothing else
 *     may write or rewrite this path.
 *   .artifacts/site-e2e-result.json — a compact sidecar manifest bound to
 *     the raw report (`reportSha256`), the Playwright config (`configFile`,
 *     empty `grep`), the suite size (`expected`), and the commit
 *     (`candidateSha`). See tools/repo/site-e2e-result.ts for the schema and
 *     the evidence contract.
 *
 * The candidate proof must always cover the FULL suite, so suite-filtering
 * Playwright arguments (`--grep`/`-g`, `--grep-invert`, `--project`,
 * `--only-changed`, `--last-failed`, `--list`), positional test-file
 * filters, and every unknown flag are rejected BEFORE Playwright launches.
 * Only a tight allowlist of benign knobs passes through: `--workers`,
 * `--retries`, `--timeout`, and `--repeat-each` (value 1 only — anything
 * else would change the executed test total).
 *
 * Candidate evidence reads the sidecar, not free-text log lines, so a
 * browser name in an unrelated fixture's output can never fake the Site
 * proof. The runner fails closed unless Playwright succeeds AND every
 * required browser executed the full suite with zero failures and zero
 * skips.
 */
import { dirname, fromFileUrl, join, relative } from '@std/path';
import {
  auditSiteE2e,
  type PlaywrightReport,
  sha256Hex,
  SITE_E2E_PROJECTS,
  type SiteE2eResult,
  summarizePlaywrightReport,
} from './site-e2e-result.ts';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const artifactsDir = join(repoRoot, '.artifacts');
const reportPath = join(artifactsDir, 'site-e2e-report.json');
const resultPath = join(artifactsDir, 'site-e2e-result.json');
const siteDir = join(repoRoot, 'www');

const FORBIDDEN_RUNNER_FLAGS = new Set([
  '--grep',
  '-g',
  '--grep-invert',
  '--project',
  '--only-changed',
  '--last-failed',
  '--list',
]);
const ALLOWED_VALUE_FLAGS = new Set(['--workers', '--retries', '--timeout']);

/**
 * Fail-closed gate for pass-through Playwright arguments. Returns an error
 * message when any argument could shrink or rewrite the suite (or is simply
 * unknown), null when every argument is an allowlisted benign knob.
 */
export function checkRunnerArgs(args: readonly string[]): string | null {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
    if (FORBIDDEN_RUNNER_FLAGS.has(flag)) {
      return `site-e2e: ${flag} filters or rewrites the suite and is forbidden for candidate proof`;
    }
    const takesValue = ALLOWED_VALUE_FLAGS.has(flag) || flag === '--repeat-each';
    if (takesValue) {
      const value = inlineValue ?? args[index + 1];
      if (value === undefined || value.startsWith('-')) {
        return `site-e2e: ${flag} requires a value`;
      }
      if (flag === '--repeat-each' && value !== '1') {
        return 'site-e2e: --repeat-each other than 1 changes the executed test total';
      }
      if (inlineValue === undefined) index++;
      continue;
    }
    return `site-e2e: argument ${
      JSON.stringify(arg)
    } is not allowlisted for candidate proof (positional test filters and unknown flags shrink the suite)`;
  }
  return null;
}

async function gitHead(): Promise<string> {
  const output = await new Deno.Command('git', {
    args: ['rev-parse', 'HEAD'],
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'null',
  }).output().catch(() => null);
  return output?.success ? new TextDecoder().decode(output.stdout).trim() : '';
}

/** Repo-relative POSIX normalization of the report's absolute config path. */
function normalizeConfigFile(configFile: string | undefined): string {
  if (!configFile) return '';
  return relative(repoRoot, configFile).replaceAll('\\', '/');
}

async function writeResult(result: SiteE2eResult): Promise<void> {
  await Deno.mkdir(dirname(resultPath), { recursive: true });
  await Deno.writeTextFile(resultPath, JSON.stringify(result, null, 2) + '\n');
}

async function main(): Promise<void> {
  const argError = checkRunnerArgs(Deno.args);
  if (argError) {
    console.error(argError);
    Deno.exit(1);
  }
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
  const candidateSha = await gitHead();
  try {
    const reportBytes = await Deno.readFile(reportPath);
    const report = JSON.parse(new TextDecoder().decode(reportBytes)) as PlaywrightReport;
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
      expected: report.stats?.expected ?? 0,
      configFile: normalizeConfigFile(report.config?.configFile),
      grep: report.config?.grep ?? {},
      reportSha256: await sha256Hex(reportBytes),
      candidateSha,
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
      expected: 0,
      configFile: '',
      grep: {},
      reportSha256: '',
      candidateSha,
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
