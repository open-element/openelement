/**
 * ui dogfood — open-dropdown behavioral evidence (#1226).
 *
 * Observed in a real browser on the compiled framework:
 * - trigger click toggles the native popover (pointerdown/click guard:
 *   a second click closes instead of re-opening);
 * - Escape and outside-click light dismiss close it;
 * - focus returns to the trigger after Escape;
 * - the per-instance CSS anchor pair is assigned at activation.
 *
 * The page shell is a shadow-open DSD element, so document-level queries go
 * through the shadow-walker helpers (helpers.ts).
 */
import { expect, type Page, test } from '@playwright/test';
import { deepFirstExpr } from './helpers.ts';

/** Waits until open-dropdown has activated and assigned its anchor pair. */
async function waitForDropdown(page: Page): Promise<void> {
  await page.waitForFunction(
    `customElements.get('open-dropdown') !== undefined && ` +
      `${deepFirstExpr('#main-dropdown')}?.style.getPropertyValue('anchor-name') !== ''`,
  );
}

/** True while the dropdown content popover is open (page context). */
const popoverOpenExpr =
  `${deepFirstExpr('#main-dropdown')}?.shadowRoot?.querySelector('.content')` +
  `?.matches(':popover-open') ?? false`;

/** Deepest active element id, descending through open shadow roots. */
function deepActiveId(): string {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active?.id ?? '';
}

test.describe('open-dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dropdown');
    await waitForDropdown(page);
  });

  test('assigns the per-instance anchor pair at activation', async ({ page }) => {
    const anchor = await page.evaluate(`(() => {
      const host = ${deepFirstExpr('#main-dropdown')};
      const content = host?.shadowRoot?.querySelector('.content');
      return {
        name: host?.style.getPropertyValue('anchor-name') ?? '',
        style: content?.getAttribute('style') ?? '',
        popover: content?.getAttribute('popover') ?? '',
      };
    })()`);
    expect(anchor.name).toMatch(/^--open-dropdown-trigger-/);
    expect(anchor.style).toContain(`position-anchor: ${anchor.name}`);
    expect(anchor.popover).toBe('auto');
  });

  test('trigger click toggles the popover open and closed', async ({ page }) => {
    expect(await page.evaluate(popoverOpenExpr)).toBe(false);
    await page.locator('#dropdown-trigger').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(true);
    await expect(page.locator('#menu-item-1')).toBeVisible();
    // The pointerdown light-dismiss guard: the following click must close.
    await page.locator('#dropdown-trigger').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(false);
  });

  test('Escape light dismisses and returns focus to the trigger', async ({ page }) => {
    await page.locator('#dropdown-trigger').focus();
    // Keyboard activation has no pointerdown: the click toggles normally.
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(true);

    await page.locator('#menu-item-1').focus();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(false);
    // Focus return runs from the popover's queued toggle event.
    await expect.poll(() => page.evaluate(deepActiveId)).toBe('dropdown-trigger');
  });

  test('clicking outside light dismisses the popover', async ({ page }) => {
    await page.locator('#dropdown-trigger').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(true);
    await page.locator('#outside').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(false);
  });
});
