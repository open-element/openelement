/**
 * E2E: Internationalization (i18n)
 *
 * Verifies that the i18n system works correctly:
 *   - Default locale (en) pages are accessible at root
 *   - The default English locale uses canonical unprefixed routes
 *   - Chinese locale pages are accessible at /zh/
 *   - The app shell projects locale-aware home and navigation links
 *   - Pages have correct lang attribute per locale
 */

import { expect, type Page, test } from '@playwright/test';

async function readShellState(page: Page) {
  // The logo is the site-name link in the banner landmark; the primary nav
  // links are its labelled navigation landmark. Both are user-visible
  // semantics — no class or shadow-walk queries needed.
  const homeHref = await page.getByRole('banner')
    .getByRole('link', { name: 'openElement' })
    .getAttribute('href');
  const navHrefs = await page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  return {
    htmlLang: await page.evaluate(() => document.documentElement.lang),
    homeHref,
    navHrefs,
    title: await page.title(),
  };
}

test.describe('Locale Routes', () => {
  test('default root loads English locale', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(await page.getAttribute('html', 'lang')).toBe('en');
  });

  test('canonical guide route loads the default English locale', async ({ page }) => {
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const lang = await page.getAttribute('html', 'lang');
    expect(lang).toBe('en');
  });

  test('/zh/ loads Chinese locale', async ({ page }) => {
    await page.goto('/zh/');
    await page.waitForLoadState('networkidle');

    const lang = await page.getAttribute('html', 'lang');
    expect(lang).toBe('zh');
  });

  test('canonical English guide page loads correctly', async ({ page }) => {
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const lang = await page.getAttribute('html', 'lang');
    expect(lang).toBe('en');

    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('zh guide page loads correctly', async ({ page }) => {
    await page.goto('/zh/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const lang = await page.getAttribute('html', 'lang');
    expect(lang).toBe('zh');

    // The guide tsx routes are the single source of truth for both locales;
    // the zh render must contain real Chinese copy, not the English fallback.
    await expect(page.locator('open-reading-shell').locator('h1')).toContainText('快速开始');
    await expect(page.locator('guide-getting-started')).toContainText('安装');
  });
});

test.describe('Localized app shell', () => {
  test('default shell uses canonical unprefixed links', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const state = await readShellState(page);
    expect(state.htmlLang).toBe('en');
    expect(state.homeHref).toBe('/');
    expect(state.navHrefs).toContain('/docs');
    expect(state.navHrefs?.some((href) => href?.startsWith('/zh/'))).toBe(false);
  });

  test('Chinese shell projects locale-prefixed navigation', async ({ page }) => {
    await page.goto('/zh/');
    await page.waitForLoadState('networkidle');

    const state = await readShellState(page);
    expect(state.htmlLang).toBe('zh');
    expect(state.homeHref).toBe('/zh');
    expect(state.navHrefs).toContain('/zh/docs');
  });

  test('switching locale via URL changes page language', async ({ page }) => {
    // Start on Chinese page
    await page.goto('/zh/guide/getting-started');
    await page.waitForLoadState('networkidle');
    const zhLang = await page.getAttribute('html', 'lang');
    expect(zhLang).toBe('zh');

    // Navigate to English version
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('networkidle');
    const enLang = await page.getAttribute('html', 'lang');
    expect(enLang).toBe('en');
  });

  test('localized logo returns to the current locale home', async ({ page }) => {
    await page.goto('/zh/guide/getting-started');
    await page.waitForLoadState('networkidle');

    await page.getByRole('banner').getByRole('link', { name: 'openElement' }).click();
    await page.waitForURL(/\/zh\/?$/);
    const after = await readShellState(page);

    expect(after.htmlLang).toBe('zh');
    expect(after.homeHref).toBe('/zh');
    expect(after.title).toBeTruthy();
  });
});

test.describe('i18n SSG Output', () => {
  test('both locale versions of blog exist', async ({ page }) => {
    // Check Chinese blog
    const zhRes = await page.goto('/zh/blog');
    expect(zhRes?.ok()).toBe(true);

    // Check English blog
    const enRes = await page.goto('/blog');
    expect(enRes?.ok()).toBe(true);
  });

  test('English blog post pages contain no /zh/ links', async ({ page }) => {
    const res = await page.goto('/blog/0001-keep-hono-vite-dev-server');
    expect(res?.status()).toBeLessThan(400);
    await page.waitForLoadState('networkidle');

    // getByRole('link') pierces open shadow roots and matches every anchored
    // link; no hand-rolled shadow walk needed.
    const hrefs = await page.getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    // The header language switcher legitimately links to the zh locale;
    // the regression was post content/navigation linking into /zh/blog.
    const zhHrefs = hrefs.filter((href) => href?.startsWith('/zh/blog'));
    expect(zhHrefs).toEqual([]);
  });

  test('both locale versions of changelog exist', async ({ page }) => {
    const zhRes = await page.goto('/zh/changelog');
    expect(zhRes?.ok()).toBe(true);

    const enRes = await page.goto('/changelog');
    expect(enRes?.ok()).toBe(true);
  });

  test('both locale versions of roadmap exist', async ({ page }) => {
    const zhRes = await page.goto('/zh/roadmap');
    expect(zhRes?.ok()).toBe(true);

    const enRes = await page.goto('/roadmap');
    expect(enRes?.ok()).toBe(true);
  });
});
