import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

export const ENHANCE_READY_CONSOLE_PREFIX = '[fixture open:enhance-ready ';

/** Wait for the document's submit interceptor, including on pages with no island hosts. */
export async function gotoEnhanceReady(page: Page, path: string): Promise<void> {
  const nonce = randomUUID();
  const attribute = 'data-fixture-enhance-ready';
  const urlAttribute = 'data-fixture-enhance-ready-url';
  const prefix = `${ENHANCE_READY_CONSOLE_PREFIX}${nonce}] `;
  await page.addInitScript(
    ({ nonce, attribute, urlAttribute, prefix }) => {
      if (window !== window.top) return;
      document.addEventListener(
        'open:enhance-ready',
        () => {
          const root = document.documentElement;
          root.setAttribute(urlAttribute, location.href);
          root.setAttribute(attribute, nonce);
          console.debug(prefix + location.href);
        },
        { once: true },
      );
    },
    { nonce, attribute, urlAttribute, prefix },
  );

  const response = await page.goto(path);
  const loadedUrl = page.url();
  if (response?.request().redirectedFrom() || new URL(path, loadedUrl).href !== loadedUrl) {
    throw new Error(
      `Expected direct navigation to ${path} for open:enhance-ready, loaded ${loadedUrl}`,
    );
  }

  // The real ready-time event may fire before the navigation settles.
  const ready = page.locator(`html[${attribute}="${nonce}"]`);
  await ready.waitFor({ state: 'attached' });
  const announcedUrl = await ready.getAttribute(urlAttribute);
  if (announcedUrl !== loadedUrl || page.url() !== loadedUrl) {
    throw new Error(
      `open:enhance-ready came from ${announcedUrl}, expected ${loadedUrl} (current URL ${page.url()})`,
    );
  }
}
