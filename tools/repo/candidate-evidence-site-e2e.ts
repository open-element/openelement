/**
 * Candidate evidence — Site E2E audit (issue #1473 extraction).
 *
 * The Site E2E proof travels as data, not log lines: this module stages the
 * raw Playwright report bytes from inside a fresh clone next to a job's
 * result.json (`stageCloneSiteE2e`) and recomputes the structured sidecar
 * from those bytes for both aggregation and validation
 * (`collectSiteE2eRecomputeFailures`), so a forged, stale, or report-less
 * sidecar fails closed. Moved out of candidate-evidence.ts verbatim: checks
 * and failure texts are unchanged.
 */

import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  auditSiteE2e,
  isEmptyGrep,
  type PlaywrightReport,
  sha256Hex,
  SITE_E2E_CONFIG_FILE,
  type SiteE2eResult,
  summarizePlaywrightReport,
} from './site-e2e-result.ts';

/** Partial sidecar shape as embedded in the aggregated evidence bundle. */
export type SiteE2eRollup = Partial<SiteE2eResult>;

/** Raw Playwright report file name inside the fresh-clone evidence dir. */
export const SITE_E2E_REPORT_FILE = 'site-e2e-report.json';
/** Raw report path relative to the aggregated evidence root. */
export const SITE_E2E_REPORT_BUNDLE_PATH = `ci/fresh-clone/${SITE_E2E_REPORT_FILE}`;

/** Order-insensitive deep equality (map insertion order is not evidence). */
function deepEqualUnordered(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  };
  return canonical(a) === canonical(b);
}

/**
 * The report's `config.configFile` is absolute on the producer machine;
 * normalize to the canonical repo-relative path when it points at the
 * candidate config, otherwise keep the (rejected) posix form.
 */
function normalizeReportConfigFile(configFile: unknown): string {
  if (typeof configFile !== 'string') return '';
  const posix = configFile.replaceAll('\\', '/');
  return posix === SITE_E2E_CONFIG_FILE || posix.endsWith(`/${SITE_E2E_CONFIG_FILE}`)
    ? SITE_E2E_CONFIG_FILE
    : posix;
}

/**
 * Forged-sidecar guard: recompute the Site E2E summary and the SHA-256 from
 * the raw Playwright report bytes and require equality with the sidecar, and
 * bind the sidecar to the candidate commit. The raw report is REQUIRED —
 * where the evidence contract demands it, its absence fails closed.
 */
export async function collectSiteE2eRecomputeFailures(
  siteE2e: SiteE2eRollup | undefined,
  options: {
    readReport: () => Promise<Uint8Array | null>;
    expectedSha?: string;
  },
): Promise<string[]> {
  const failures: string[] = [];
  if (options.expectedSha !== undefined && siteE2e?.candidateSha !== options.expectedSha) {
    failures.push(
      `Site E2E candidateSha ${JSON.stringify(
        siteE2e?.candidateSha ?? null,
      )} != candidate ${options.expectedSha} (stale or foreign sidecar)`,
    );
  }
  const bytes = await options.readReport();
  if (!bytes) {
    failures.push(
      `Site E2E raw Playwright report missing from the evidence tree (${SITE_E2E_REPORT_FILE})`,
    );
    return failures;
  }
  if (siteE2e?.reportSha256 !== (await sha256Hex(bytes))) {
    failures.push(
      'Site E2E reportSha256 does not match the raw report bytes (forged or stale sidecar)',
    );
    return failures;
  }
  let report: PlaywrightReport;
  try {
    report = JSON.parse(new TextDecoder().decode(bytes)) as PlaywrightReport;
  } catch {
    failures.push('Site E2E raw report is not valid JSON');
    return failures;
  }
  const projects = summarizePlaywrightReport(report);
  if (!deepEqualUnordered(projects, siteE2e?.projects ?? null)) {
    failures.push('Site E2E sidecar projects do not match the recomputed report summary');
  }
  const totals = { passed: 0, failed: 0, skipped: 0, flaky: 0 };
  for (const summary of Object.values(projects)) {
    totals.passed += summary.passed;
    totals.failed += summary.failed;
    totals.skipped += summary.skipped;
    totals.flaky += summary.flaky;
  }
  for (const field of ['passed', 'failed', 'skipped', 'flaky'] as const) {
    if (siteE2e?.[field] !== totals[field]) {
      failures.push(
        `Site E2E sidecar ${field}=${JSON.stringify(siteE2e?.[field])} != recomputed ${
          totals[field]
        } from the raw report`,
      );
    }
  }
  if (siteE2e?.expected !== report.stats?.expected) {
    failures.push(
      `Site E2E sidecar expected=${JSON.stringify(siteE2e?.expected)} != report stats.expected ${JSON.stringify(
        report.stats?.expected ?? null,
      )}`,
    );
  }
  // The retry count is a fact the report states itself, so bind it too: a
  // sidecar cannot claim retries the raw bytes do not record, nor hide the
  // ones they do.
  if (totals.flaky !== (report.stats?.flaky ?? 0)) {
    failures.push(
      `Site E2E recomputed flaky=${totals.flaky} != report stats.flaky ${JSON.stringify(
        report.stats?.flaky ?? null,
      )}`,
    );
  }
  const configFile = normalizeReportConfigFile(report.config?.configFile);
  if (siteE2e?.configFile !== configFile) {
    failures.push(
      `Site E2E sidecar configFile ${JSON.stringify(
        siteE2e?.configFile ?? null,
      )} != report config ${JSON.stringify(configFile)}`,
    );
  }
  const grep = report.config?.grep ?? {};
  if (!isEmptyGrep(grep)) {
    failures.push('Site E2E raw report config.grep is not empty');
  }
  if (!deepEqualUnordered(siteE2e?.grep ?? null, grep)) {
    failures.push('Site E2E sidecar grep does not match the raw report config.grep');
  }
  return failures;
}

/**
 * Stage the Site E2E proof recorded inside a fresh clone.
 *
 * The official Site E2E suite belongs to the PR-layer fresh-clone lane: the
 * trimmed source gate no longer builds or drives the Site. The runner writes
 * a structured sidecar (Playwright JSON summary) plus the raw Playwright
 * report inside the clone; the raw bytes are staged next to this job's
 * result.json so aggregation and validation recompute the sidecar instead of
 * trusting it. A lazy probe cannot fake the proof: a lane that exits 0
 * without a reportable sidecar fails closed here.
 *
 * #1409: the raw report is also staged when the suite FAILED. A red run is
 * precisely the case whose per-test names are otherwise unrecoverable — the
 * sidecar's counts alone cannot say which test broke, and the runner emits no
 * per-test annotations by design. `options.required` separates the two
 * callers: a green run must yield recordable evidence (missing or unrecordable
 * bytes are a hard error), while a red run stages whatever the runner managed
 * to write. A red run that produced no sidecar at all still records
 * `ran: false`, which the aggregate fails closed on.
 *
 * Exported for tests: the red/green branches are the #1409 contract, and they
 * are pure filesystem staging, so they are worth pinning without a clone.
 */
export async function stageCloneSiteE2e(
  cloneDir: string,
  outDir: string,
  expectedCommit: string,
  options: { required?: boolean } = {},
): Promise<SiteE2eRollup> {
  const required = options.required ?? true;
  const artifacts = join(cloneDir, '.artifacts');
  const unrecordable = (cause: unknown): SiteE2eRollup => {
    console.warn(`[evidence] failed Site E2E produced no recordable report: ${String(cause)}`);
    return { ran: false } as SiteE2eRollup;
  };
  let result: SiteE2eRollup;
  let reportBytes: Uint8Array;
  try {
    result = JSON.parse(
      await readFile(join(artifacts, 'site-e2e-result.json'), 'utf8'),
    ) as SiteE2eRollup;
    reportBytes = await readFile(join(artifacts, SITE_E2E_REPORT_FILE));
  } catch (cause) {
    if (!required) return unrecordable(cause);
    throw new Error(
      `fresh clone did not produce the Site E2E sidecar and raw report the candidate proof requires: ${String(
        cause,
      )}`,
    );
  }
  // The runner removes the previous report before every run, so the bytes
  // cannot be stale; the sidecar must still describe this candidate.
  if (result.candidateSha !== expectedCommit) {
    if (!required) return unrecordable(`sidecar candidateSha=${result.candidateSha}`);
    throw new Error(
      `Site E2E sidecar candidateSha=${JSON.stringify(result.candidateSha)} != ${expectedCommit}`,
    );
  }
  await writeFile(join(outDir, SITE_E2E_REPORT_FILE), reportBytes);
  // A red run's evidence travels as-is: the report bytes are what a human
  // needs, and the validator's auditSiteE2e is what fails the aggregate.
  if (!required) return result;
  // Fail closed at record time on a green run: a sidecar that does not
  // recompute from the raw report bytes, or that belongs to another commit, is
  // never recorded.
  const failures = [
    ...auditSiteE2e(result),
    ...(await collectSiteE2eRecomputeFailures(result, {
      readReport: () => Promise.resolve(reportBytes),
      expectedSha: expectedCommit,
    })),
  ];
  if (failures.length > 0) {
    throw new Error(`Site E2E evidence is not recordable:\n${failures.join('\n')}`);
  }
  return result;
}
