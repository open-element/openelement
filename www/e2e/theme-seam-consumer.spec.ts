/**
 * E2E: html[data-theme] broadcast seam — consumer form.
 *
 * After PR #1804 the attribute has ONE owner
 * (`packages/ui/src/theme-contract.ts`): the pre-paint script is generated
 * from it and the toggle delegates to it. This spec asserts the observable
 * consequence rather than the source shape: a page load performs EXACTLY ONE
 * mutation of `html[data-theme]`, hydration does not write it a second time,
 * and the applied theme still drives computed style.
 *
 * The static half of the same seam lives in
 * `www/__tests__/site-theme-and-gaze-seams.test.ts`; the byte-identity of the
 * generated script is guarded by `@openelement/www#check:theme-init`.
 */
import { expect, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __themeMutations?: number;
    __themeValues?: Array<string | null>;
  }
}

/** Record every data-theme mutation from before the first page script runs. */
async function observeThemeMutations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__themeMutations = 0;
    window.__themeValues = [];
    // Init scripts run before <html> exists, so observe the document subtree
    // and filter to the document element's data-theme attribute.
    new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.type === 'attributes' &&
          record.attributeName === 'data-theme' &&
          record.target === document.documentElement
        ) {
          window.__themeMutations = (window.__themeMutations ?? 0) + 1;
          window.__themeValues?.push(document.documentElement.getAttribute('data-theme'));
        }
      }
    }).observe(document, {
      attributes: true,
      attributeFilter: ['data-theme'],
      subtree: true,
    });
  });
}

/** Wait for the synchronous pre-paint script to have run. */
async function waitForPrePaint(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.themeInit === '1');
}

function readTheme(page: Page): Promise<{ mutations: number; theme: string | null }> {
  return page.evaluate(() => ({
    mutations: window.__themeMutations ?? 0,
    theme: document.documentElement.getAttribute('data-theme'),
  }));
}

test('a dark-preference load mutates html[data-theme] exactly once', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await observeThemeMutations(page);
  await page.goto('/');
  await waitForPrePaint(page);

  const { mutations, theme } = await readTheme(page);
  expect(theme).toBe('dark');
  // Pre-paint writes; hydration must be a no-op on the seam attribute.
  expect(mutations).toBe(1);
});

test('a saved light theme wins the one write, even with a dark OS preference', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    localStorage.setItem('open-theme', 'light');
  });
  await observeThemeMutations(page);
  await page.goto('/');
  await waitForPrePaint(page);

  const { mutations, theme } = await readTheme(page);
  expect(theme).toBe('light');
  expect(mutations).toBe(1);
});

test('an unavailable matchMedia falls back to the dark default with one write', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true });
  });
  await observeThemeMutations(page);
  await page.goto('/');
  await waitForPrePaint(page);

  const { mutations, theme } = await readTheme(page);
  expect(theme).toBe('dark');
  expect(mutations).toBe(1);
});

test('a user toggle still propagates through the owner and changes computed style', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await observeThemeMutations(page);
  await page.goto('/');
  await waitForPrePaint(page);

  const toggle = page.getByRole('button', { name: 'Toggle theme' });
  await expect(toggle).toBeVisible({ timeout: 10000 });
  const darkColor = await page.evaluate(() => getComputedStyle(document.body).color);

  await toggle.click();
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');

  const lightColor = await page.evaluate(() => getComputedStyle(document.body).color);
  const { mutations } = await readTheme(page);
  // One pre-paint write plus the one user-driven write; hydration adds none.
  expect(mutations).toBe(2);
  expect(lightColor).not.toBe(darkColor);
});
