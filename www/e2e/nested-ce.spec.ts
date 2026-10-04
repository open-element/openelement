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
import { getCustomElementTags, getLeakedMarkupText, getShadowRootCount } from './helpers.js';

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
    // not text nodes containing raw HTML (a sign of failed DSD)
    const nestedAsText = await getLeakedMarkupText(page, /<[a-z]+-[a-z]+/);
    expect(nestedAsText).toEqual([]);
  });

  test('some custom elements have shadow roots after upgrade', async ({ page }) => {
    // After DSD parsing and island upgrade, some elements should have shadow roots
    const upgradedCount = await getShadowRootCount(page);
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
