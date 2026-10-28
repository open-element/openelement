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
import { observeWithTimeoutClassification } from './helpers.ts';
import { HOME_AXE_EXCLUSIONS } from './axe-home-exclusions.ts';

/** Routes the gate scans: one per page template, plus the zh variant. */
const SCANNED_ROUTES = ['/', '/guide/getting-started/', '/docs/', '/reference/'] as const;

/**
 * Node exclusions per route (selector under the route page), each with the
 * reason the page layer cannot own the finding. Kept minimal by design: an
 * exclusion here is a standing accessibility decision.
 *
 * The home list lives in accessibility-coverage.spec.ts (HOME_AXE_EXCLUSIONS)
 * because the T10 sweep scans `/` AND `/zh` — one list, two consumers, no drift.
 * What the T10 audit corrected is the reason text, not the list: the suppressed
 * `color-contrast` nodes come from the entry-opacity snapshot (0.12) AND from
 * `.flood`'s pseudo-element backdrop, which axe cannot composite — and the
 * claimed coverage by the WCAG AA pair test in accessibility-performance.spec.ts
 * was wrong (that test measures the reading shell's code blocks and the mobile
 * rail summary, not the home scenes). The settled numbers for the scenes whose
 * backdrop is resolvable are in the T10 register §2.9.2; the pseudo-element
 * regions still await a pixel-truth check (register R5b).
 */
const EXCLUSIONS: Partial<Record<(typeof SCANNED_ROUTES)[number], string[]>> = {
  '/': [...HOME_AXE_EXCLUSIONS],
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
      // /reference is the one generated mega-page (~13k elements across the
      // 6-package API surface): axe's rule×node walk takes minutes on a shared
      // CI runner, so that scan alone carries a wider ceiling.
      test.setTimeout(route === '/reference/' ? 420_000 : 120_000);
      await page.goto(route);
      // Let hydration settle: the islands upgrade synchronously after the
      // module loads, and the scan should see the page a reader sees. A
      // ceiling that expires in the load/settle or the scan is an engine/probe
      // timeout, never an assertion failure (FR-05C).
      await observeWithTimeoutClassification({ phase: 'axe-gate', url: route }, async () => {
        await page.waitForLoadState('networkidle');
        await scrollThroughAndSettle(page);
      });

      let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
      for (const selector of EXCLUSIONS[route] ?? []) {
        builder = builder.exclude(selector);
      }
      const { violations } = await observeWithTimeoutClassification(
        { phase: 'axe-gate', url: route },
        () => builder.analyze(),
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

  test('the zh article template passes the same scan', async ({ page }) => {
    await page.goto('/zh/guide/getting-started/');
    await page.waitForLoadState('networkidle');
    await scrollThroughAndSettle(page);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const report = violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
    }));
    expect(violations, JSON.stringify(report, null, 1)).toEqual([]);
  });

  test('axe scan meets WCAG 2.1 A+AA on the open search dialog with rendered results (light and dark)', async ({
    page,
  }) => {
    // The route scans above never open the search dialog, so its own
    // contrast pairs were unscanned: hardcoded bare-zinc colors read 1:1
    // against the dark popover and still passed every gate (#1532).
    for (const theme of ['light', 'dark'] as const) {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForFunction(() => !!customElements.get('open-search'));
      // The same channel the theme toggle writes (html[data-theme] plus
      // colorScheme, packages/ui/src/open-theme-toggle.tsx applyTheme):
      // theme.css's token tables key off the attribute alone.
      await page.evaluate((value) => {
        document.documentElement.setAttribute('data-theme', value);
        document.documentElement.style.colorScheme = value;
      }, theme);

      await page.getByRole('button', { name: 'Search' }).click();
      const input = page.getByRole('combobox', { name: 'Search documentation' });
      await expect(input).toBeFocused();
      await input.pressSequentially('routing');
      const firstResult = page
        .getByRole('listbox', { name: 'Search results' })
        .getByRole('option')
        .first();
      await expect(firstResult).toBeVisible({ timeout: 30_000 });

      // Scoped to the island: the page behind the modal scrim is not this
      // scan's subject, the open dialog is.
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .include('open-search')
        .analyze();

      const report = violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
        help: violation.help,
      }));
      expect(
        violations,
        `axe found WCAG A/AA violations on the open search dialog (${theme} theme):\n${JSON.stringify(report, null, 1)}`,
      ).toEqual([]);
    }
  });
});
