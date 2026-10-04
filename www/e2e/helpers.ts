/**
 * E2E test helpers for openElement docs site.
 *
 * Selector policy (#1232): prefer user-visible semantics — roles, accessible
 * names, text, stable routes and component tag names. Playwright role/CSS
 * locators pierce open shadow roots natively; reach for the shadow-walker in
 * tools/lib/shadow-walker.ts only when the shadow structure itself is the
 * subject under test (dsd-layers.spec.ts). Do not add data-testid hooks
 * except for important, stable interaction boundaries.
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

/**
 * Count upgraded custom elements: elements carrying a shadow root after the
 * browser parsed the DSD and the island scripts ran.
 */
export function getShadowRootCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    let count = 0;
    for (const el of document.querySelectorAll('*')) {
      if (el.shadowRoot) count += 1;
    }
    return count;
  });
}

/**
 * Collect trimmed text of ordinary text nodes that look like leaked raw
 * markup matching `pattern` (case-insensitive). Code, pre, style, script and
 * template subtrees are inert containers: their content is authored examples,
 * not failed DSD serialization.
 */
export function getLeakedMarkupText(page: Page, pattern: RegExp): Promise<string[]> {
  return page.evaluate((source: string) => {
    const re = new RegExp(source, 'i');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const leaked: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest('code, pre, style, script, template')) continue;
      const text = node.textContent ?? '';
      if (re.test(text)) leaked.push(text.trim());
    }
    return leaked;
  }, pattern.source);
}
