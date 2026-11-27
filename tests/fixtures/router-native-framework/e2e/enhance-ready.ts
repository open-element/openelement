import { randomUUID } from 'node:crypto';
import type { ConsoleMessage, Page } from '@playwright/test';

/** Wait for the document's submit interceptor, including on pages with no island hosts. */
export async function gotoEnhanceReady(page: Page, path: string): Promise<void> {
  const prefix = `[fixture open:enhance-ready ${randomUUID()}] `;
  await page.addInitScript((message) => {
    if (window !== window.top) return;
    document.addEventListener('open:enhance-ready', () => console.debug(message + location.href), {
      once: true,
    });
  }, prefix);

  let announce!: (url: string) => void;
  let rejectAnnouncement!: (error: Error) => void;
  const announcement = new Promise<string>((resolve, reject) => {
    announce = resolve;
    rejectAnnouncement = reject;
  });
  const record = (message: ConsoleMessage): void => {
    const text = message.text();
    if (text.startsWith(prefix)) announce(text.slice(prefix.length));
  };
  const unavailable = (): void => {
    rejectAnnouncement(
      new Error(`Page closed or crashed waiting for open:enhance-ready on ${path}`),
    );
  };
  // The ready-time scan can announce during navigation, before goto settles.
  page.on('console', record);
  page.on('close', unavailable);
  page.on('crash', unavailable);
  try {
    const navigation = page.goto(path).then((response) => {
      const loadedUrl = page.url();
      const redirectedFrom = response?.request().redirectedFrom();
      if (redirectedFrom || new URL(path, loadedUrl).href !== loadedUrl) {
        throw new Error(
          `Expected direct navigation to ${path} for open:enhance-ready, loaded ${loadedUrl}`,
        );
      }
      return loadedUrl;
    });
    const [announcedUrl, loadedUrl] = await Promise.all([announcement, navigation]);
    if (announcedUrl !== loadedUrl) {
      throw new Error(`open:enhance-ready came from ${announcedUrl}, expected ${loadedUrl}`);
    }
  } finally {
    page.off('console', record);
    page.off('close', unavailable);
    page.off('crash', unavailable);
  }
}
