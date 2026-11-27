/**
 * Adversarial continuation contracts for the shared enhance client.
 *
 * These are renderer-neutral assertions: they exercise form-enhance.ts's
 * target resolution and its "a disposed form must not apply a late response"
 * guard. They moved here from the retired router-lit-framework fixture so the
 * native/neutral fixture owns the shared coverage before that fixture is
 * deleted (ADR-0152 2026-11-08 owner ruling).
 */
import { expect, test } from '@playwright/test';
import { gotoEnhanceReady } from './enhance-ready.ts';

for (const target of [undefined, '', '_self'] as const) {
  test(`base target fallback preserves explicit target ${String(target)}`, async ({ page }) => {
    await gotoEnhanceReady(page, '/playground');
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
    await gotoEnhanceReady(page, '/notes/new');
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
