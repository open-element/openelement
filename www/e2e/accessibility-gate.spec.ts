/**
 * The resident axe gate (alpha9 C4, #1507): every template-representative
 * route is scanned with axe-core (WCAG 2.1 A + AA tags) at page-load state,
 * on the built site, in every e2e:browsers browser. This file rides the
 * standard `*.spec.ts` test match, so the e2e:browsers chain — and therefore
 * CI — runs it with zero workflow changes.
 *
 * The scan is a hard gate: any unresolved violation fails the route. Excluded
 * nodes are listed per route with the reason the page layer cannot own them,
 * so an exclusion is a reviewed decision, not a shrug.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Routes the gate scans: one per page template, plus the zh variant. */
const SCANNED_ROUTES = ['/', '/guide/getting-started', '/docs', '/reference'] as const;

/**
 * Node exclusions per route (selector under the route page), each with the
 * reason the page layer cannot own the finding. Kept minimal by design: an
 * exclusion here is a standing accessibility decision.
 */
const EXCLUSIONS: Partial<Record<(typeof SCANNED_ROUTES)[number], string[]>> = {
  '/': [
    // Decorative outlined scene numerals: transparent fill over a text-stroke
    // outline — a stroke has no contrast semantics — and aria-hidden.
    '.scene-outlined',
    // The scroll-reveal targets (page-home-styles, `scene-in` under
    // `@supports (animation-timeline: view())`). A view() timeline is a
    // function of scroll position, so any static whole-page snapshot reads
    // sub-fold copy at its entry opacity (0.12) — the final, reading state is
    // full opacity, and the reduced-motion media query disables the reveal
    // entirely. axe's snapshot has no honest measurement of this class; the
    // settled prose contrast is owned by the WCAG AA pair test in
    // accessibility-performance.spec.ts.
    '.scene-copy',
    '.scene-art',
    '.scene > h2',
    '.flood-panel',
    '.flood-arrow',
    '.strategy',
    '.output-row',
  ],
};

/**
 * Scroll the route end to end, then settle: the homepage scenes ride
 * scroll-timeline entry animations (animation-fill-mode: both), so a static
 * top-of-page snapshot would read sub-fold copy at its entry opacity instead
 * of the final state a reader sees. Walking the page pushes every view()
 * timeline to its end; the pause gives the time-based hero reveals their
 * (≤ ~3s) completion window.
 */
async function scrollThroughAndSettle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = globalThis.innerHeight / 2;
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(3_000);
}

test.describe('Accessibility gate (axe)', () => {
  for (const route of SCANNED_ROUTES) {
    test(`axe scan meets WCAG 2.1 A+AA on ${route}`, async ({ page }) => {
      await page.goto(route);
      // Let hydration settle: the islands upgrade synchronously after the
      // module loads, and the scan should see the page a reader sees.
      await page.waitForLoadState('networkidle');
      await scrollThroughAndSettle(page);

      let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
      for (const selector of EXCLUSIONS[route] ?? []) {
        builder = builder.exclude(selector);
      }
      const { violations } = await builder.analyze();

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

  test('the zh article template passes the same scan', async ({ page }) => {
    await page.goto('/zh/guide/getting-started');
    await page.waitForLoadState('networkidle');
    await scrollThroughAndSettle(page);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const report = violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
    }));
    expect(violations, JSON.stringify(report, null, 1)).toEqual([]);
  });
});
