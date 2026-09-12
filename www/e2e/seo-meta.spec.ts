/**
 * E2E: SEO & Meta Tags
 *
 * Verifies that SSG-built pages have correct SEO meta tags:
 *   - Open Graph tags (og:title, og:description, og:image, og:url)
 *   - Twitter Card tags
 *   - Description meta tag
 *   - HTML lang attribute
 *   - Viewport meta tag
 */

import { expect, test } from '@playwright/test';

test.describe('SEO Meta Tags', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('has Open Graph site name', async ({ page }) => {
    const content = await page.locator('meta[property="og:site_name"]').getAttribute('content');
    expect(content).toBe('OpenElement');
  });

  test('has Open Graph type', async ({ page }) => {
    const content = await page.locator('meta[property="og:type"]').getAttribute('content');
    expect(content).toBe('website');
  });

  test('has Open Graph title', async ({ page }) => {
    const content = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(content).toBe('openElement — The Web, composed.');
  });

  test('has Open Graph description', async ({ page }) => {
    const content = await page.locator('meta[property="og:description"]').getAttribute('content');
    expect(content).toBeTruthy();
    expect(content!.length).toBeGreaterThan(10);
  });

  test('has Open Graph URL', async ({ page }) => {
    const content = await page.locator('meta[property="og:url"]').getAttribute('content');
    expect(content).toContain('openelement.org');
  });

  test('has Open Graph image', async ({ page }) => {
    const content = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(content).toBeTruthy();
    expect(content).toContain('og-image');
  });

  test('has Twitter Card', async ({ page }) => {
    const content = await page.locator('meta[name="twitter:card"]').getAttribute('content');
    expect(content).toBe('summary_large_image');
  });

  test('has description meta tag', async ({ page }) => {
    const content = await page.locator('meta[name="description"]').getAttribute('content');
    expect(content).toBeTruthy();
    expect(content).toContain('OpenElement');
    expect(content).toContain('Web Components-native');
  });

  // #1307: per-route metadata replaces the boilerplate era (identical title,
  // description and og:title on every page).
  test('per-route title/description replace the boilerplate (#1307)', async ({ page }) => {
    await page.goto('/apilist');
    expect(await page.title()).toBe('API Reference — openElement');
    const apilistDescription = await page.locator('meta[name="description"]').getAttribute(
      'content',
    );
    expect(apilistDescription).toContain('supported openElement API surface');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBe('https://openelement.org/apilist');
    const hreflangZh = await page.locator('link[rel="alternate"][hreflang="zh"]').getAttribute(
      'href',
    );
    expect(hreflangZh).toBe('https://openelement.org/zh/apilist');

    await page.goto('/zh/apilist');
    expect(await page.title()).toBe('API 参考 — openElement');
    const zhDescription = await page.locator('meta[name="description"]').getAttribute('content');
    expect(zhDescription).toContain('openElement 受支持的 API 面');
    const zhCanonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(zhCanonical).toBe('https://openelement.org/zh/apilist');
  });
});

test.describe('HTML Structure', () => {
  test('homepage has correct lang attribute', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const lang = await page.getAttribute('html', 'lang');
    // Default locale should be 'en' or 'zh' depending on route
    expect(lang).toMatch(/^(en|zh)$/);
  });

  test('zh locale page has lang="zh"', async ({ page }) => {
    await page.goto('/zh/');
    await page.waitForLoadState('networkidle');

    const lang = await page.getAttribute('html', 'lang');
    expect(lang).toBe('zh');
  });

  test('en locale page has lang="en"', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const lang = await page.getAttribute('html', 'lang');
    expect(lang).toBe('en');
  });

  test('has viewport meta tag', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('has favicon', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const favicon = page.locator('link[rel="icon"]');
    expect(await favicon.count()).toBeGreaterThan(0);
  });

  test('has charset meta', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const charset = await page.locator('meta[charset]').getAttribute('charset');
    expect(charset?.toLowerCase()).toBe('utf-8');
  });
});

test.describe('Sitemap & Robots', () => {
  test('sitemap.xml is accessible', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.ok()).toBe(true);
    const content = await response.text();
    expect(content).toContain('openelement.org');
  });

  test('robots.txt is accessible', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.ok()).toBe(true);
  });
});
