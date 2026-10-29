/**
 * Mega-page accessibility scans (T10 R5 coverage, split out during the
 * release-check repair).
 *
 * The two generated reference pages are 2.09 MB of HTML each (~13,5k tags).
 * Chromium scans them in ~12 s and WebKit in ~21 s. Firefox does too when it
 * runs alone (16 s, measured 2026-10-18), but under a full three-engine run it
 * intermittently stops making progress and sits until the ceiling — 7 minutes
 * with the 420 s ceiling the resident gate also uses for `/reference`, and the
 * retry can hang the same way. That is the Firefox large-page trap the Lead is
 * isolating separately (release:check item B, a sibling spec timing out on the
 * same page); nothing in these scans is Firefox-specific, so running them in
 * the two engines that complete them keeps the coverage honest instead of
 * buying a green run with a skip.
 *
 * Coverage note: `/reference` is still scanned in Firefox by the resident gate
 * (accessibility-gate.spec.ts, one route per template). What Firefox does not
 * get from this split is the `/zh/reference` sweep scan — the one gap, recorded
 * with the trap rather than hidden behind an exclusion.
 *
 * Split out of accessibility-coverage.spec.ts so `testIgnore` can target this
 * file per engine: Playwright scopes ignores to files, not to individual tests.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { observeWithTimeoutClassification } from './helpers.ts';

/** The generated mega-pages, in both locales. */
const MEGA_PAGES = ['/reference/', '/zh/reference/'] as const;

/** The resident gate's ceiling for the same page (accessibility-gate.spec.ts). */
const MEGA_PAGE_TIMEOUT_MS = 420_000;

test.describe('Mega-page accessibility (axe)', () => {
  for (const route of MEGA_PAGES) {
    test(`axe meets WCAG 2.1 A+AA on ${route}`, async ({ page }) => {
      test.setTimeout(MEGA_PAGE_TIMEOUT_MS);
      await page.goto(route);
      // A ceiling that expires during the load or the scan is an engine/probe
      // timeout for this route, not an assertion failure (FR-05C).
      const { violations } = await observeWithTimeoutClassification(
        { phase: 'axe-mega-page', url: route },
        async () => {
          await page.waitForLoadState('networkidle');
          return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        },
      );
      const report = violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
        help: violation.help,
      }));
      expect(
        violations,
        `axe found WCAG A/AA violations on ${route}:\n${JSON.stringify(report, null, 1)}`,
      ).toEqual([]);
    });
  }
});
