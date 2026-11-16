/**
 * ui dogfood — open-dropdown behavioral evidence (#1226).
 *
 * Observed in a real browser on the compiled framework:
 * - trigger click toggles the native popover (pointerdown/click guard:
 *   a second click closes instead of re-opening);
 * - Escape and outside-click light dismiss close it;
 * - focus returns to the trigger after Escape;
 * - the per-instance CSS anchor pair: the host half at activation, the
 *   content half inside the open window (dropped on close so a reconnect's
 *   re-claim sees the compiled static seeds).
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

  test('assigns the anchor pair: host half at activation, content half inside the open window', async ({
    page,
  }) => {
    // The host half is assigned at activation and stays while closed. The
    // content half is runtime-written INSIDE the open window only (applied at
    // `beforetoggle`, dropped on close) — a reconnect re-claims the retained
    // nodes against the compiled static seeds, so the closed element must
    // carry no extra inline style.
    const anchorName = await page.evaluate(
      `${deepFirstExpr('#main-dropdown')}?.style.getPropertyValue('anchor-name') ?? ''`,
    );
    expect(anchorName).toMatch(/^--open-dropdown-trigger-/);
    const closedStyle = await page.evaluate(
      `${deepFirstExpr('#main-dropdown')}?.shadowRoot?.querySelector('.content')` +
        `?.getAttribute('style') ?? ''`,
    );
    expect(closedStyle, 'no runtime content style while closed').not.toContain('position-anchor');

    await page.locator('#dropdown-trigger').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(true);
    const openStyle = await page.evaluate(
      `${deepFirstExpr('#main-dropdown')}?.shadowRoot?.querySelector('.content')` +
        `?.getAttribute('style') ?? ''`,
    );
    expect(openStyle).toContain(`position-anchor: ${anchorName}`);

    await page.locator('#dropdown-trigger').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(false);
    const reclosedStyle = await page.evaluate(
      `${deepFirstExpr('#main-dropdown')}?.shadowRoot?.querySelector('.content')` +
        `?.getAttribute('style') ?? ''`,
    );
    expect(reclosedStyle, 'the runtime content anchor drops on close').not.toContain(
      'position-anchor',
    );
    expect(
      await page.evaluate(
        `${deepFirstExpr('#main-dropdown')}?.shadowRoot?.querySelector('.content')` +
          `?.getAttribute('popover') ?? ''`,
      ),
    ).toBe('auto');
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
