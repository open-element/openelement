/**
 * E2E: DSD Layers
 *
 * Verifies Declarative Shadow DOM structure in the built docs site:
 *   - Custom elements have shadow roots (DSD parsed by browser)
 *   - Shadow root content is rendered and visible
 *   - DSD content matches expected patterns (no raw HTML text)
 *   - Custom element tags are present in the DOM
 *
 * NOTE: After browser DSD parsing, <template shadowrootmode="open"> elements
 * are consumed and replaced with real shadow roots. Tests must check shadow roots
 * rather than template elements.
 */

import { expect, test } from '@playwright/test';
import { getCustomElementTags } from './helpers.js';
import { deepQueryAllInPage } from '../../tools/lib/shadow-walker.ts';

test.describe('DSD Layers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for native DSD parsing, custom-element upgrade, and theme init.
    await page.waitForLoadState('networkidle');
  });

  test('homepage has correct HTML structure', async ({ page }) => {
    // Page should have a title
    const title = await page.title();
    expect(title).toContain('openElement');

    // HTML lang attribute
    const lang = await page.getAttribute('html', 'lang');
    expect(lang).toBe('en');
  });

  test('custom elements have shadow roots after DSD parsing', async ({ page }) => {
    // After DSD parsing, custom elements should have shadow roots.
    // The browser processes <template shadowrootmode="open"> into real ShadowRoot.
    const hasShadowRoots = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) return true;
      }
      return false;
    });
    expect(hasShadowRoots).toBe(true);
  });

  test('default output relies on native DSD without an inline fallback', async ({ page }) => {
    const fallbackCount = await page.locator('script[data-openelement-dsd-fallback]').count();
    expect(fallbackCount).toBe(0);
  });

  test('shadow root content includes style elements', async ({ page }) => {
    // Shadow roots should contain <style> elements (openElement component styles)
    const hasStyles: boolean = await page.evaluate(
      `(${deepQueryAllInPage.toString()})(document, '*').some((el) => {
        const style = el.shadowRoot?.querySelector('style');
        return !!style?.textContent?.trim();
      })`,
    );
    expect(hasStyles).toBe(true);
  });

  test('DSD content is not exposed as raw text', async ({ page }) => {
    // Intentional code examples may mention DSD syntax. Only fail when raw DSD
    // markup leaks into ordinary page text outside code and inert containers.
    const leakedDsdText = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      const leaked: string[] = [];

      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || parent.closest('code, pre, style, script, template')) {
          continue;
        }

        const text = node.textContent ?? '';
        if (/<template\s+shadowrootmode/i.test(text)) {
          leaked.push(text.trim());
        }
      }

      return leaked;
    });

    expect(leakedDsdText).toEqual([]);
  });

  test('custom elements are discovered in the page', async ({ page }) => {
    const tags = await getCustomElementTags(page);
    expect(tags.length).toBeGreaterThan(0);
  });
});
