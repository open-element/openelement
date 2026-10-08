/**
 * Packed-starter visual + interaction smoke (#934, #1530 showcase form).
 *
 * Guards the starter regression classes the computed surface owns: unstyled
 * page (no token baseline), dead island, jammed nav, duplicate H1, missing
 * 404 fidelity — the layer curl-level checks cannot see. The showcase
 * starter's chrome is plain light DOM (header.site-head), so the old
 * app-shell shadow queries are gone along with the blog routes.
 */
import { expect, test } from '@playwright/test';

// Tailwind-ON form: --paper seats on --color-background = --color-white.
const PAPER = 'rgb(255, 255, 255)';

test('computed body background is the design-token paper, not the UA default', async ({ page }) => {
  await page.goto('/');
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe(PAPER);
});

test('header nav links are spaced apart (not jammed)', async ({ page }) => {
  await page.goto('/');
  const links = page.locator('header.site-head nav a');
  await expect(links).toHaveCount(3);
  const [home, about] = await links.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }),
  );
  expect(about.left - home.right).toBeGreaterThan(4);
});

test('counter island hydrates and responds to clicks', async ({ page }) => {
  await page.goto('/');
  const counter = page.locator('my-counter');
  await expect(counter).toBeVisible();
  await page.evaluate(() => customElements.whenDefined('my-counter'));
  const plus = counter.getByRole('button', { name: '+' });
  await plus.click();
  await expect(counter.locator('#count')).toHaveText('1');
  await plus.click();
  await expect(counter.locator('#count')).toHaveText('2');
  await counter.getByRole('button', { name: '-' }).click();
  await expect(counter.locator('#count')).toHaveText('1');
});

test('about page renders exactly one H1', async ({ page }) => {
  await page.goto('/about');
  await expect(page.locator('h1')).toHaveCount(1);
});

test('unknown route is a 404 status, not a 200 fallback (#922)', async ({ page }) => {
  const response = await page.goto('/definitely-not-a-page');
  expect(response?.status()).toBe(404);
  await expect(page.locator('h1')).toContainText('404');
});
