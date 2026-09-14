/**
 * BFCache restore contract (#943), Chrome-channel lane.
 *
 * The bundled Playwright Chromium launches with
 * `--disable-back-forward-cache`, so this contract runs on the installed
 * Google Chrome channel instead (project `chrome-bfcache` in
 * playwright.config.ts). A bfcache restore never fires `load`, so the
 * navigation uses `goBack({ waitUntil: 'commit' })` and the assertion reads
 * the direct `pageshow.persisted` signal rather than an ordinary reload.
 */
import { expect, test } from '@playwright/test';

test('island state survives back/forward (bfcache, #943)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const marker = globalThis as unknown as { __bfcacheRestored?: boolean };
    marker.__bfcacheRestored = false;
    globalThis.addEventListener('pageshow', (event) => {
      if ((event as PageTransitionEvent).persisted) marker.__bfcacheRestored = true;
    });
  });

  await page.locator('my-counter').getByRole('button', { name: '+' }).click();
  await expect(page.locator('my-counter #count')).toHaveText('1');

  await page.goto('/blog');
  await page.goBack({ waitUntil: 'commit' });

  // Direct restore signal: a normal reload leaves the flag false.
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (globalThis as unknown as { __bfcacheRestored?: boolean })
            .__bfcacheRestored,
        )
      )
    )
    .toBe(true);
  await expect(page.locator('my-counter #count')).toHaveText('1');

  await page.locator('my-counter').getByRole('button', { name: '+' }).click();
  await expect(page.locator('my-counter #count')).toHaveText('2');
});
