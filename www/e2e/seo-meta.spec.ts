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
    expect(content).toBe('openElement');
  });

  test('has Open Graph type', async ({ page }) => {
    const content = await page.locator('meta[property="og:type"]').getAttribute('content');
    expect(content).toBe('website');
  });

  test('has Open Graph title', async ({ page }) => {
    const content = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(content).toBe('openElement — The Web Components framework');
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

  test('declares the social card image and localized alt text', async ({ page }) => {
    const image = 'https://openelement.org/brand/og-default.png';
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', image);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', image);
    await expect(page.locator('meta[property="og:image:type"]')).toHaveAttribute(
      'content',
      'image/png',
    );
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      'content',
      '1200',
    );
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
      'content',
      '630',
    );
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
      'content',
      'openElement mark and wordmark',
    );

    await page.goto('/zh/');
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
      'content',
      'openElement 图形标记与字标',
    );
  });

  test('has Twitter Card', async ({ page }) => {
    const content = await page.locator('meta[name="twitter:card"]').getAttribute('content');
    expect(content).toBe('summary_large_image');
  });

  test('has description meta tag', async ({ page }) => {
    const content = await page.locator('meta[name="description"]').getAttribute('content');
    expect(content).toBeTruthy();
    expect(content).toContain('openElement');
    expect(content).toContain('Web Components-native');
  });

  // The structured-data channel had no end-to-end coverage: unit assertions
  // only pinned the renderer's string include, while five emission points
  // (SSG/request-time) and the JSON escaping were untested. The homepage
  // declares WebSite + Organization by design (www/app/site-ui/head.ts).
  test('homepage ships parseable schema.org JSON-LD with escaped markup', async ({ page }) => {
    const scripts = page.locator('script[type="application/ld+json"]');
    const count = await scripts.count();
    expect(count).toBeGreaterThan(0);
    const types: unknown[] = [];
    for (let index = 0; index < count; index += 1) {
      const raw = (await scripts.nth(index).textContent()) ?? '';
      // A bare "<" would let authored data close the script element early.
      expect(raw).not.toContain('<');
      const parsed = JSON.parse(raw) as { '@context'?: unknown; '@type'?: unknown };
      expect(parsed['@context']).toBe('https://schema.org');
      types.push(parsed['@type']);
    }
    expect(new Set(types).size).toBe(types.length);
  });

  // #1307: per-route metadata replaces the boilerplate era (identical title,
  // description and og:title on every page).
  test('per-route title/description replace the boilerplate (#1307)', async ({ page }) => {
    await page.goto('/reference/');
    expect(await page.title()).toBe('API Reference — openElement');
    const referenceDescription = await page
      .locator('meta[name="description"]')
      .getAttribute('content');
    expect(referenceDescription).toContain('supported openElement API surface');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBe('https://openelement.org/reference/');
    const hreflangZh = await page
      .locator('link[rel="alternate"][hreflang="zh"]')
      .getAttribute('href');
    expect(hreflangZh).toBe('https://openelement.org/zh/reference/');

    await page.goto('/zh/reference/');
    expect(await page.title()).toBe('API 参考 — openElement');
    const zhDescription = await page.locator('meta[name="description"]').getAttribute('content');
    expect(zhDescription).toContain('openElement 受支持的 API 面');
    const zhCanonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(zhCanonical).toBe('https://openelement.org/zh/reference/');
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

  test('ships the same mark in the header, downloadable vectors, and favicon', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/brand/apple-touch-icon.png',
    );

    const brand = page
      .getByRole('link', { name: 'openElement', exact: true })
      .filter({
        has: page.locator('svg'),
      })
      .first();
    await expect(brand).toContainText('openElement');
    const path = brand.locator('svg path');
    await expect(path).toHaveCount(1);
    await expect(path).toHaveAttribute('fill', 'currentColor');
    const contour = await path.getAttribute('d');
    expect(contour).toBeTruthy();
    for (const url of ['/brand/mark.svg', '/brand/lockup.svg', '/favicon.svg']) {
      const response = await request.get(url);
      expect(response.ok(), url).toBe(true);
      expect(await response.text()).toContain(`d="${contour}"`);
    }
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
