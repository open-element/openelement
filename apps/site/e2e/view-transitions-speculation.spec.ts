/**
 * E2E: View Transitions & Speculation Rules (v0.9.2)
 *
 * Verifies that the SSG post-processing pipeline correctly injects
 * View Transitions meta tag and Speculation Rules script tag into
 * all built HTML pages.
 *
 * These are v0.9.2 features - critical to validate in e2e.
 */

import { expect, test } from '@playwright/test';

test.describe('View Transitions (v0.9.2)', () => {
  const pages = [
    '/',
    '/guide/getting-started',
    '/guide/architecture',
    '/blog',
    '/changelog',
  ];

  for (const path of pages) {
    test(`"${path}" has <meta name="view-transition">`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const meta = page.locator('meta[name="view-transition"]');
      await expect(meta).toHaveAttribute('content', 'same-origin');
    });
  }

  test('view-transition meta tag is in <head>', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const isInHead = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="view-transition"]');
      return meta?.parentElement?.tagName === 'HEAD';
    });
    expect(isInHead).toBe(true);
  });

  test('only one view-transition meta tag per page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const count = await page.locator('meta[name="view-transition"]').count();
    expect(count).toBe(1);
  });
});

test.describe('Speculation Rules (v0.9.2)', () => {
  test('homepage has <script type="speculationrules">', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const script = page.locator('script[type="speculationrules"]');
    expect(await script.count()).toBe(1);
  });

  test('speculation rules contain valid JSON', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const jsonText = await page.evaluate(() => {
      const script = document.querySelector('script[type="speculationrules"]');
      return script?.textContent ?? '';
    });

    // Should be parseable JSON
    let parsed: Record<string, unknown>;
    expect(() => {
      parsed = JSON.parse(jsonText);
    }).not.toThrow();

    // Should have at least one of: prefetch or prerender
    const hasPrefetch = 'prefetch' in parsed! && Array.isArray(parsed!.prefetch);
    const hasPrerender = 'prerender' in parsed! && Array.isArray(parsed!.prerender);
    expect(hasPrefetch || hasPrerender).toBe(true);
  });

  test('speculation rules include prefetch entries', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const rules = await page.evaluate(() => {
      const script = document.querySelector('script[type="speculationrules"]');
      if (!script) return null;
      return JSON.parse(script.textContent!);
    });

    expect(rules).not.toBeNull();
    expect(rules.prefetch).toBeDefined();
    expect(Array.isArray(rules.prefetch)).toBe(true);
    expect(rules.prefetch.length).toBeGreaterThan(0);
  });

  test('each prefetch rule has href_matches pattern', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const rules = await page.evaluate(() => {
      const script = document.querySelector('script[type="speculationrules"]');
      if (!script) return null;
      return JSON.parse(script.textContent!);
    });

    for (const rule of rules.prefetch) {
      expect(rule.where).toBeDefined();
      expect(rule.where.href_matches).toBeDefined();
      expect(typeof rule.where.href_matches).toBe('string');
    }
  });

  test('guide page also has speculation rules', async ({ page }) => {
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const script = page.locator('script[type="speculationrules"]');
    expect(await script.count()).toBe(1);
  });

  test('only one speculationrules script tag per page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const count = await page.locator('script[type="speculationrules"]').count();
    expect(count).toBe(1);
  });
});
