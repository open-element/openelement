/**
 * E2E: open-search dialog a11y across ALL of its content states.
 *
 * The resident gate (`accessibility-gate.spec.ts`) scans the open dialog only
 * with a rendered result set. The pre-results states were unscanned, and the
 * P2 audit found the regression there: the combobox machine exposes the
 * results surface as `role="listbox"`, but in the idle ("Type at least 2
 * characters…") and no-results states it had no `option`/`group` children — an
 * axe `aria-required-children` violation (critical impact) on
 * `#open-search-results`.
 *
 * The fix scopes the machine-owned listbox role to the state that owns
 * options: absent while the idle/no-results message renders (a listbox with no
 * option children is the axe-critical invalid shape), restored when the hit
 * anchors render. This spec pins all three states plus Escape/backdrop focus
 * return, so a regression fails CI instead of shipping.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const RESULTS = '#open-search-results';

function scanDialog(page: Page) {
  // Scoped to the island: the page behind the modal scrim is not this
  // spec's subject (the resident gate's home exclusions live there).
  return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('open-search').analyze();
}

function violationReport(violations: Awaited<ReturnType<typeof scanDialog>>['violations']) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
  }));
}

async function openDialog(page: Page): Promise<Locator> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !!customElements.get('open-search'));
  const trigger = page.getByRole('button', { name: 'Search', exact: true });
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
  // The overlay is shown from SSR markup synchronously; the machine wiring
  // (which also owns the backdrop click handler's prop application) lands a
  // few microtasks later. Waiting for the machine's open state keeps the
  // dismissal assertions deterministic under parallel workers.
  await expect(page.locator(RESULTS)).toHaveAttribute('data-state', 'open');
  return trigger;
}

test.describe('open-search dialog — a11y for every content state', () => {
  test('idle state (dialog open, no query) has no listbox without options', async ({ page }) => {
    await openDialog(page);
    const results = page.locator(RESULTS);
    // A listbox with no option/group children is the P2 audit's axe-critical
    // shape; the idle message is a status message, not a listbox.
    await expect(results).not.toHaveAttribute('role', 'listbox');
    await expect(results).toContainText('Type at least 2 characters to search');
    await expect(results.locator('[role="option"]')).toHaveCount(0);
    const { violations } = await scanDialog(page);
    expect(
      violations,
      `axe found WCAG A/AA violations on the idle search dialog:\n${JSON.stringify(violationReport(violations), null, 1)}`,
    ).toEqual([]);
  });

  test('no-results state has no listbox without options', async ({ page }) => {
    await openDialog(page);
    const field = page.getByRole('combobox', { name: 'Search documentation' });
    await field.pressSequentially('zzqxwvv');
    // A rendered no-results message means the Pagefind round has landed.
    await expect(page.locator(RESULTS)).toContainText(/No results found for/iu, {
      timeout: 30_000,
    });
    await expect(page.locator(RESULTS)).not.toHaveAttribute('role', 'listbox');
    await expect(page.locator(RESULTS).locator('[role="option"]')).toHaveCount(0);
    const { violations } = await scanDialog(page);
    expect(
      violations,
      `axe found WCAG A/AA violations on the no-results search dialog:\n${JSON.stringify(violationReport(violations), null, 1)}`,
    ).toEqual([]);
  });

  test('rendered-results state exposes machine options and stays clean', async ({ page }) => {
    await openDialog(page);
    const field = page.getByRole('combobox', { name: 'Search documentation' });
    await field.pressSequentially('routing');
    const listbox = page.getByRole('listbox', { name: 'Search results' });
    const firstResult = listbox.getByRole('option').first();
    await expect(firstResult).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(RESULTS)).toHaveAttribute('role', 'listbox');
    const { violations } = await scanDialog(page);
    expect(
      violations,
      `axe found WCAG A/AA violations on the results search dialog:\n${JSON.stringify(violationReport(violations), null, 1)}`,
    ).toEqual([]);
  });

  test('Escape returns focus to the Search trigger', async ({ page }) => {
    const trigger = await openDialog(page);
    await expect(page.getByRole('combobox', { name: 'Search documentation' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('backdrop dismissal returns focus to the Search trigger', async ({ page }) => {
    const trigger = await openDialog(page);
    // The overlay covers the viewport; the panel is centered below 15vh, so a
    // corner click lands on the backdrop, not the panel. Click the backdrop
    // element itself (with an explicit visible wait) instead of raw viewport
    // coordinates: the raw-coordinate form occasionally raced the overlay's
    // state under the full 3-engine lane and left the dialog open (flake
    // recorded on #1668). The assertions below are unchanged.
    const backdrop = page.locator('open-search .overlay');
    await expect(backdrop).toBeVisible();
    await backdrop.click({ position: { x: 8, y: 8 } });
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
