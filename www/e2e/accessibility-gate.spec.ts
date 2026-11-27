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

/** Routes the gate scans: one per page template, plus the zh variant. */
const SCANNED_ROUTES = ['/', '/guide/getting-started/', '/docs/', '/reference/'] as const;

async function waitForReferenceReady(page: Page): Promise<void> {
  const options = { timeout: 30_000 };
  // The registry form starts hidden in the server markup. The outline and
  // chrome also upgrade after navigation. A prefetch for another route can
  // still be pending after this page is ready for a full axe scan.
  await Promise.all([
    expect(page.locator('#main-content')).toBeVisible(options),
    expect(page.locator('open-registry-lookup form')).toBeVisible(options),
    expect(page.locator('open-page-rail nav a[aria-current="location"]').first()).toBeAttached(
      options,
    ),
    page.waitForFunction(
      () => {
        const chrome = ['open-search', 'open-site-menu', 'open-theme-toggle'];
        const sheets = document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]');
        return (
          chrome.every((tag) => customElements.get(tag) !== undefined) &&
          sheets.length > 0 &&
          [...sheets].every((link) => link.sheet !== null) &&
          document.fonts.status === 'loaded'
        );
      },
      null,
      options,
    ),
  ]);
}

test.describe('Accessibility gate (axe)', () => {
  for (const route of SCANNED_ROUTES) {
    test(`axe scan meets WCAG 2.1 A+AA on ${route}`, async ({ page }) => {
      // /reference is the one generated mega-page (~13k elements across the
      // 6-package API surface): axe's rule×node walk takes minutes on a shared
      // CI runner, so that scan alone carries a wider ceiling.
      test.setTimeout(route === '/reference/' ? 420_000 : 120_000);
      await page.goto(route);
      await observeWithTimeoutClassification({ phase: 'axe-gate', url: route }, async () => {
        if (route === '/reference/') {
          await waitForReferenceReady(page);
        } else {
          await page.waitForLoadState('networkidle');
        }
      });

      const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
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
