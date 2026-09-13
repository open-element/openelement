/**
 * E2E: Island Reactivity
 *
 * Verifies that currently rendered island components are available without
 * fixed sleeps. The homepage no longer renders the historical home-console island, so
 * this suite follows the current layout shell instead:
 *   - open-layout owns a compiled light-root shell
 *   - layout header islands are present inside that shell
 *   - island client script is present
 */

import { expect, type Page, test } from '@playwright/test';

async function waitForLayoutReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const layout = document.querySelector('open-layout');
    // The shell's main landmark is the user-visible readiness signal.
    return !!layout?.querySelector('main');
  });
}

test.describe('Layout Island Shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('layout element exists in DOM', async ({ page }) => {
    await expect(page.locator('open-layout')).toHaveCount(1);
  });

  test('layout retains its compiled light-root marker and SSR shell', async ({ page }) => {
    await waitForLayoutReady(page);

    const state = await page.evaluate(() => {
      const layout = document.querySelector('open-layout');
      return {
        light: layout?.hasAttribute('data-oe-light') ?? false,
        // Landmark structure is the shell contract: banner + main + footer.
        shell: !!layout?.querySelector('header') && !!layout?.querySelector('main') &&
          !!layout?.querySelector('footer'),
      };
    });
    expect(state).toEqual({ light: true, shell: true });
  });

  test('layout header islands are rendered inside the static shell', async ({ page }) => {
    await waitForLayoutReady(page);

    const headerIslands = await page.locator('open-layout').evaluate((layout) => {
      return {
        search: !!layout.querySelector('open-search'),
        themeToggle: !!layout.querySelector('open-theme-toggle'),
        // The brand mark is the labelled site-name link in the header.
        brand: !!layout.querySelector('header a[aria-label="openElement"]'),
      };
    });

    expect(headerIslands).toEqual({
      search: true,
      themeToggle: true,
      brand: true,
    });
  });
});

test.describe('Island Script Loading', () => {
  test('island client script is loaded', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.waitForFunction(() => {
      const scripts = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script[type="module"]'),
      );
      return scripts.some((s) => s.src?.includes('client') || s.src?.includes('island'));
    });

    const loaded = await page.evaluate(() => {
      const scripts = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script[type="module"]'),
      );
      return scripts.some((s) => s.src?.includes('client') || s.src?.includes('island'));
    });
    expect(loaded).toBe(true);
  });

  test('component shadow roots remain available after island load', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await waitForLayoutReady(page);

    const upgradedCount = await page.evaluate(() => {
      let count = 0;
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) count++;
      }
      return count;
    });
    expect(upgradedCount).toBeGreaterThan(0);
  });
});
