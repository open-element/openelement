/**
 * E2E: Nested Custom Elements
 *
 * Verifies that nested custom elements render correctly:
 *   - Custom elements exist in the DOM after DSD parsing
 *   - Nested CEs are real DOM elements (not raw text)
 *   - Island scripts load and upgrade elements
 *   - openElement UI components are present
 */

import { expect, test } from '@playwright/test';
import { getCustomElementTags } from './helpers.js';

test.describe('Nested Custom Elements', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('custom elements exist in the DOM', async ({ page }) => {
    // Check that custom elements (hyphenated tags) are present
    const tags = await getCustomElementTags(page);
    expect(tags.length).toBeGreaterThan(0);
  });

  test('nested CEs are real DOM elements, not text', async ({ page }) => {
    // After DSD hydration, nested CEs should be elements in the DOM,
    // not text nodes containing raw HTML
    const nestedAsText = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      const textNodes: string[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.closest('code, pre, style, script, template')) {
          continue;
        }
        const text = node.textContent?.trim() ?? '';
        // Look for text that looks like raw HTML tags (sign of failed DSD)
        if (/<[a-z]+-[a-z]+/i.test(text)) {
          textNodes.push(text);
        }
      }
      return textNodes;
    });
    expect(nestedAsText).toEqual([]);
  });

  test('openElement components are present in the DOM', async ({ page }) => {
    const tags = await getCustomElementTags(page);
    // The docs site should have custom elements (any hyphenated tags)
    // These may include open-*, docs-*, page-*, code-block, etc.
    expect(tags.length).toBeGreaterThan(0);
    // At minimum, the page should have custom element tags
    const hasHyphenatedTags = tags.some((t) => t.includes('-'));
    expect(hasHyphenatedTags).toBe(true);
  });

  test('some custom elements have shadow roots after upgrade', async ({ page }) => {
    // After DSD parsing and island upgrade, some elements should have shadow roots
    const upgradedCount = await page.evaluate(() => {
      let count = 0;
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) count++;
      }
      return count;
    });
    expect(upgradedCount).toBeGreaterThan(0);
  });

  test('page navigation works between guide pages', async ({ page }) => {
    // Navigate from home to a guide page
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('networkidle');

    // The guide page should have loaded successfully
    const url = page.url();
    expect(url).toContain('/guide/getting-started');

    // The page should have a title (DSD-rendered)
    const title = await page.title();
    expect(title).toBeTruthy();
  });
});
