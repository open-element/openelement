/**
 * E2E test helpers for openElement docs site.
 *
 * Selector policy (#1232): prefer user-visible semantics — roles, accessible
 * names, text, stable routes and component tag names. Playwright role/CSS
 * locators pierce open shadow roots natively; reach for the shadow-walker in
 * tools/lib/shadow-walker.ts only when the shadow structure itself is the
 * subject under test (dsd-layers.spec.ts, tools/visual-smoke.ts). Do not add
 * data-testid hooks except for important, stable interaction boundaries.
 */

import type { Page } from '@playwright/test';

/**
 * Collect all custom element tag names found in the page HTML.
 */
export function getCustomElementTags(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const tags = new Set<string>();
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.tagName.includes('-')) {
        tags.add(el.tagName.toLowerCase());
      }
    }
    return [...tags];
  });
}
