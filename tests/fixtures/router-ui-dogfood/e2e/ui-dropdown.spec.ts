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

  test('assigns the anchor identity on the host and keeps the compiled content style-free', async ({
    page,
  }) => {
    // The anchor identity rides the host: `anchor-name` (the definition) plus
    // `--oe-dropdown-anchor` (the custom property the authored sheet reads as
    // `position-anchor`). The compiled content leaf never receives a runtime
    // inline style — that would count as an extra static attribute at the
    // reconnect claim.
    const anchorName = await page.evaluate(
      `${deepFirstExpr('#main-dropdown')}?.style.getPropertyValue('anchor-name') ?? ''`,
    );
    expect(anchorName).toMatch(/^--open-dropdown-trigger-/);
    const customProperty = await page.evaluate(
      `${deepFirstExpr('#main-dropdown')}?.style.getPropertyValue('--oe-dropdown-anchor') ?? ''`,
    );
    expect(customProperty).toBe(anchorName);
    const contentHasStyle = () =>
      page.evaluate(
        `${deepFirstExpr('#main-dropdown')}?.shadowRoot?.querySelector('.content')` +
          `?.hasAttribute('style') ?? true`,
      );
    expect(await contentHasStyle(), 'no inline style while closed').toBe(false);

    await page.locator('#dropdown-trigger').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(true);
    expect(await contentHasStyle(), 'no inline style while open').toBe(false);

    await page.locator('#dropdown-trigger').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(false);
    expect(await contentHasStyle(), 'still none after the close').toBe(false);
  });

  test('open, close, then disconnect/reconnect: the toggle still works (seed surface clean)', async ({
    page,
  }) => {
    // Regression (2026-11-17): the open/close cycle left `style=""` on the
    // content and the reconnect re-claim failed (OEIR_LEAF_CLAIM_MISMATCH),
    // dead component after any such cycle.
    await page.locator('#dropdown-trigger').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(true);
    await page.locator('#dropdown-trigger').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(false);

    await page.evaluate(() => {
      const host = document
        .querySelector('dropdown-page')
        ?.shadowRoot?.querySelector('#main-dropdown') as HTMLElement | null;
      if (!host) throw new Error('host not found');
      const parent = host.parentNode as HTMLElement;
      host.remove();
      parent.appendChild(host);
    });
    // The re-claim must pass and the component must work again.
    await page.locator('#dropdown-trigger').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(true);
    await page.locator('#dropdown-trigger').click();
    await expect.poll(() => page.evaluate(popoverOpenExpr)).toBe(false);
  });

  test('renaming the anchor inside the open window moves the host custom property', async ({
    page,
  }) => {
    const before = await page.evaluate(
      `${deepFirstExpr('#main-dropdown')}?.style.getPropertyValue('--oe-dropdown-anchor') ?? ''`,
    );
    expect(before).toMatch(/^--open-dropdown-trigger-/);

    await page.evaluate(`(() => {
      const host = ${deepFirstExpr('#main-dropdown')};
      if (host) host.anchorName = '--renamed-while-open';
    })()`);

    await expect
      .poll(() =>
        page.evaluate(
          `${deepFirstExpr('#main-dropdown')}?.style.getPropertyValue('--oe-dropdown-anchor') ?? ''`,
        ),
      )
      .toBe('--renamed-while-open');
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
