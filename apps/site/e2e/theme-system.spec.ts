/**
 * E2E: Theme System
 *
 * Verifies the dark/light theme toggle:
 *   - Theme toggle element is present
 *   - Clicking toggle switches theme
 *   - Theme state is persisted to localStorage
 *   - Initial theme follows prefers-color-scheme when nothing is saved
 *   - data-theme attribute is updated on document
 */

import { expect, type Page, test } from '@playwright/test';

/**
 * The toggle button is the user-visible control ("Toggle theme"); Playwright
 * role locators pierce the open shadow roots of open-layout and
 * open-theme-toggle natively, so no ad-hoc shadow walking is needed.
 */
async function clickThemeToggle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Toggle theme' }).click();
}

async function waitForThemeChange(page: Page, before: string | null): Promise<void> {
  await page.waitForFunction((prev) => {
    return document.documentElement.getAttribute('data-theme') !== prev;
  }, before);
}

/**
 * Wait for <open-theme-toggle> to be fully upgraded:
 * DSD hydration + _initTheme() must complete before clicks work.
 * The host carries a data-theme attribute once _initTheme() ran during
 * onDsdHydrated().
 */
async function waitForToggleReady(page: Page): Promise<void> {
  await expect(page.locator('open-theme-toggle')).toHaveAttribute('data-theme', /^(light|dark)$/, {
    timeout: 10000,
  });
}

test.describe('Theme Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await waitForToggleReady(page);
  });

  test('theme toggle button is exposed with an accessible name', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
  });

  test('theme toggle has shadow root', async ({ page }) => {
    const hasShadowRoot = await page.locator('open-theme-toggle')
      .evaluate((el) => el.shadowRoot !== null);
    expect(hasShadowRoot).toBe(true);
  });

  test('clicking theme toggle changes data-theme on document', async ({ page }) => {
    const themeBefore = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });

    await clickThemeToggle(page);

    await waitForThemeChange(page, themeBefore);
    const themeAfter = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    expect(themeAfter).not.toBe(themeBefore);
  });

  test('theme is persisted to localStorage after toggle', async ({ page }) => {
    await clickThemeToggle(page);

    // Check localStorage
    const stored = await page.evaluate(() => {
      return localStorage.getItem('open-theme');
    });
    expect(stored).toMatch(/^(light|dark)$/);
  });

  test('multiple toggles cycle between dark and light', async ({ page }) => {
    const themeBefore = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });

    await clickThemeToggle(page);
    await waitForThemeChange(page, themeBefore);
    const themeAfter1 = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    expect(themeAfter1).not.toBe(themeBefore);

    await clickThemeToggle(page);
    await waitForThemeChange(page, themeAfter1);
    const themeAfter2 = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    expect(themeAfter2).toBe(themeBefore);
  });

  test('homepage surface colors follow the active theme', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      globalThis.dispatchEvent(
        new CustomEvent('open:theme-change', {
          detail: { theme: 'dark' },
        }),
      );
    });

    const dark = await page.evaluate(() => {
      return {
        canvas: getComputedStyle(document.body).backgroundImage,
        surface: getComputedStyle(document.body).backgroundColor,
      };
    });

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      globalThis.dispatchEvent(
        new CustomEvent('open:theme-change', {
          detail: { theme: 'light' },
        }),
      );
    });

    const light = await page.evaluate(() => {
      return {
        canvas: getComputedStyle(document.body).backgroundImage,
        surface: getComputedStyle(document.body).backgroundColor,
      };
    });

    expect(dark.canvas).not.toBe(light.canvas);
    expect(dark.surface).not.toBe(light.surface);
  });
});

test.describe('Theme initialization', () => {
  // theme-init.js runs synchronously in <head> before first paint: with no
  // saved theme the initial data-theme must follow prefers-color-scheme
  // exactly. A dark first paint that later flips to light is the FOUC this
  // contract exists to prevent, so both directions are asserted strictly.
  test('initial theme is light when prefers-color-scheme is light and nothing is saved', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const theme = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    expect(theme).toBe('light');
    // theme-init.js must have run synchronously before first paint.
    const themeInit = await page.evaluate(() => {
      return document.documentElement.dataset.themeInit;
    });
    expect(themeInit).toBe('1');
  });

  test('initial theme is dark when prefers-color-scheme is dark and nothing is saved', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const theme = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    expect(theme).toBe('dark');
    // theme-init.js must have run synchronously before first paint.
    const themeInit = await page.evaluate(() => {
      return document.documentElement.dataset.themeInit;
    });
    expect(themeInit).toBe('1');
  });
});
