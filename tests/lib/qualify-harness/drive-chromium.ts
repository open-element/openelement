/**
 * Playwright driving for the qualify harnesses (#1472).
 *
 * Owns the browser segment every consumer repeated: dynamic import, browser
 * launch, the static server fronting a built dist/, page-error collection,
 * and the ordered teardown (browser first, then server). Consumers add their
 * charter-specific probes on top of the session.
 */

import type { Browser, Page } from '@playwright/test';
import { serveStatic } from './serve-static.ts';

export type QualifyBrowserName = 'chromium' | 'firefox' | 'webkit';

export interface QualifyBrowserSession {
  browser: Browser;
  /** Origin of the static server fronting the dist directory. */
  origin: string;
  /** Page and console errors observed on watched pages. */
  pageErrors: string[];
  /** Wire pageerror + console-error collection for a page into pageErrors. */
  watchPageErrors(page: Page): void;
  /** Close the browser, then the static server. */
  close(): Promise<void>;
}

/**
 * Launch a Playwright browser and serve distDir over loopback HTTP. The
 * caller opens pages from `session.browser`, navigates to `session.origin`,
 * and closes the session in a finally block.
 */
export async function launchQualifyBrowser(options: {
  distDir: string;
  browserName?: QualifyBrowserName;
}): Promise<QualifyBrowserSession> {
  const browserName = options.browserName ?? 'chromium';
  const playwright = await import('@playwright/test');
  const server = serveStatic(options.distDir);
  const browser = await playwright[browserName].launch();
  const pageErrors: string[] = [];
  return {
    browser,
    origin: server.origin,
    pageErrors,
    watchPageErrors(page: Page): void {
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') pageErrors.push(message.text());
      });
    },
    close: async () => {
      await browser.close();
      await server.close();
    },
  };
}
