/**
 * Site E2E fail-closed tests. The candidate proof must reject zero-pass,
 * skipped, failed, missing, or malformed browser evidence — including a fully
 * skipped Playwright run, which exits 0 but proves nothing.
 */
import { assert, assertEquals } from '@std/assert';
import {
  auditSiteE2e,
  SITE_E2E_PROJECTS,
  type SiteE2eResult,
  summarizePlaywrightReport,
} from './site-e2e-result.ts';

function healthy(): SiteE2eResult {
  const projects = Object.fromEntries(
    SITE_E2E_PROJECTS.map((browser) => [browser, { passed: 231, failed: 0, skipped: 0 }]),
  );
  return {
    ran: true,
    projects,
    passed: 231 * SITE_E2E_PROJECTS.length,
    failed: 0,
    skipped: 0,
    generatedAt: new Date().toISOString(),
  };
}

Deno.test('site e2e audit accepts a healthy three-browser result', () => {
  assertEquals(auditSiteE2e(healthy()), []);
});

Deno.test('site e2e audit rejects a fully skipped run', () => {
  const result = healthy();
  for (const browser of SITE_E2E_PROJECTS) {
    result.projects[browser] = { passed: 0, failed: 0, skipped: 231 };
  }
  result.passed = 0;
  result.skipped = 231 * SITE_E2E_PROJECTS.length;
  const failures = auditSiteE2e(result);
  for (const browser of SITE_E2E_PROJECTS) {
    assert(failures.some((f) => f.includes(`${browser} passed=0`)));
    assert(failures.some((f) => f.includes(`${browser} skipped=231`)));
  }
});

Deno.test('site e2e audit rejects zero-pass, skipped, and failed projects', () => {
  const zero = healthy();
  zero.projects.chromium = { passed: 0, failed: 0, skipped: 0 };
  zero.passed -= 231;
  assert(auditSiteE2e(zero).some((f) => f.includes('chromium passed=0')));

  const skipped = healthy();
  skipped.projects.firefox = { passed: 200, failed: 0, skipped: 31 };
  skipped.passed = 231 + 200 + 231;
  skipped.skipped = 31;
  assert(auditSiteE2e(skipped).some((f) => f.includes('firefox skipped=31')));

  const failed = healthy();
  failed.projects.webkit = { passed: 229, failed: 2, skipped: 0 };
  failed.passed -= 2;
  failed.failed = 2;
  assert(auditSiteE2e(failed).some((f) => f.includes('webkit failed=2')));
});

Deno.test('site e2e audit rejects a missing browser and ran=false', () => {
  const missing = healthy();
  delete (missing.projects as Record<string, unknown>).webkit;
  assert(auditSiteE2e(missing).some((f) => f.includes('missing browser proof: webkit')));
  assertEquals(auditSiteE2e({ ...healthy(), ran: false }), [
    'official Site E2E did not run or did not pass',
  ]);
  assertEquals(auditSiteE2e(undefined), ['official Site E2E did not run or did not pass']);
});

Deno.test('site e2e audit rejects inconsistent totals', () => {
  const result = healthy();
  result.passed += 1;
  assert(auditSiteE2e(result).some((f) => f.includes('total passed=')));
  const result2 = healthy();
  result2.failed = 1;
  assert(auditSiteE2e(result2).some((f) => f.includes('total failed=')));
});

Deno.test('site e2e audit rejects non-integer, negative, string, and NaN values', () => {
  for (const bad of [-1, 1.5, '231', Number.NaN, null, undefined]) {
    const result = healthy() as unknown as { projects: Record<string, { passed: unknown }> };
    result.projects.chromium.passed = bad;
    assert(
      auditSiteE2e(result as unknown as SiteE2eResult).some((f) =>
        f.includes('chromium.passed must be a non-negative safe integer')
      ),
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
  const badTotal = healthy() as unknown as Record<string, unknown>;
  badTotal.passed = '693';
  assert(
    auditSiteE2e(badTotal as unknown as SiteE2eResult).some((f) => f.includes('total passed')),
  );
});

Deno.test('summarizePlaywrightReport counts per project and skips', () => {
  const report = {
    suites: [{
      specs: [{
        tests: [
          { projectName: 'chromium', status: 'expected', results: [{ status: 'passed' }] },
          { projectName: 'chromium', status: 'unexpected', results: [{ status: 'failed' }] },
          { projectName: 'firefox', status: 'skipped', results: [{ status: 'skipped' }] },
        ],
      }],
    }],
  };
  assertEquals(summarizePlaywrightReport(report), {
    chromium: { passed: 1, failed: 1, skipped: 0 },
    firefox: { passed: 0, failed: 0, skipped: 1 },
  });
});
