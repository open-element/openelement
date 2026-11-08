/**
 * Adversarial continuation contracts for the shared enhance client.
 *
 * These are renderer-neutral assertions: they exercise form-enhance.ts's
 * target resolution and its "a disposed form must not apply a late response"
 * guard. They moved here from the retired router-lit-framework fixture so the
 * native/neutral fixture owns the shared coverage before that fixture is
 * deleted (ADR-0152 2026-11-08 owner ruling).
 */
import { expect, type Page, test } from '@playwright/test';

/**
 * Arm the readiness recorder before the first navigation.
 *
 * The client entry's enhance layer announces itself with
 * `open:enhance-ready` once its ready-time scan has run (form-enhance.ts).
 * `open:ready` is NOT a substitute: it fires per island strategy bucket that
 * has a HOST on the page, and /notes/new carries no island host.
 */
async function armEnhanceReady(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener(
      'open:enhance-ready',
      () => {
        (window as unknown as { __enhanceReady?: boolean }).__enhanceReady = true;
      },
      { once: true },
    );
  });
}

/** Resolve only after that announcement: the submit interceptor is attached. */
async function waitForEnhanceReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as never as { __enhanceReady?: boolean }).__enhanceReady === true,
  );
}

for (const target of [undefined, '', '_self'] as const) {
  test(`base target fallback preserves explicit target ${String(target)}`, async ({ page }) => {
    await armEnhanceReady(page);
    await page.goto('/playground');
    await waitForEnhanceReady(page);
    await page.evaluate((override) => {
      const base = document.createElement('base');
      base.target = '_blank';
      document.head.append(base);
      const form = document
        .querySelector('playground-page')!
        .shadowRoot!.querySelector<HTMLFormElement>('#plain-form')!;
      if (override !== undefined) form.setAttribute('target', override);
    }, target);
    if (target === undefined) {
      // With no explicit form target the document <base target> wins: the
      // browser opens a new tab and the enhanced client must not intercept.
      const popup = page.waitForEvent('popup');
      await page.click('#plain-submit');
      const opened = await popup;
      await opened.waitForLoadState();
      await expect(page).toHaveURL(/\/playground$/);
      await opened.close();
    } else {
      // An explicit target (even the empty string) overrides the <base>: the
      // same-origin form stays on the enhancement path.
      const post = page.waitForRequest((request) => request.method() === 'POST');
      await page.click('#plain-submit');
      expect((await post).headers()['x-openelement-action']).toBe('enhance');
      await expect(page.locator('h1')).toHaveText('playground');
    }
  });
}

for (const outcome of ['html', 'network-error'] as const) {
  test(`a disposed form cannot apply its late ${outcome}`, async ({ page, request }) => {
    const html = await (await request.get('/notes')).text();
    await armEnhanceReady(page);
    await page.goto('/notes/new');
    await waitForEnhanceReady(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let received!: () => void;
    const started = new Promise<void>((resolve) => (received = resolve));
    await page.route('**/notes/new', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      received();
      await held;
      if (outcome === 'network-error') await route.abort('failed');
      else await route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.fill('#title', 'review');
    await page.click('#submit');
    await started;
    await page.evaluate(() => {
      history.pushState({}, '', '/newer-navigation');
      document.body.innerHTML = '<main id="new-page">new page</main>';
    });
    release();
    // Let the delayed network result and its promise continuations settle.
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/newer-navigation$/);
    await expect(page.locator('#new-page')).toHaveText('new page');
  });
}
