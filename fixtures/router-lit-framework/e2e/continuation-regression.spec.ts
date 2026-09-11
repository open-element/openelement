/** Adversarial continuation contracts for the shared enhance client and Lit hydration. */
import { expect, test } from '@playwright/test';

for (const target of [undefined, '', '_self'] as const) {
  test(`base target fallback preserves explicit target ${String(target)}`, async ({ page }) => {
    await page.goto('/guards');
    await page.evaluate((override) => {
      const base = document.createElement('base');
      base.target = '_blank';
      document.head.append(base);
      const form = document.querySelector('guards-page')!.shadowRoot!
        .querySelector<HTMLButtonElement>('#plain-submit')!.form!;
      if (override !== undefined) form.setAttribute('target', override);
    }, target);
    if (target === undefined) {
      const popup = page.waitForEvent('popup');
      await page.click('#plain-submit');
      const opened = await popup;
      await opened.waitForLoadState();
      await expect(page).toHaveURL(/\/guards$/);
      await opened.close();
    } else {
      const post = page.waitForRequest((request) => request.method() === 'POST');
      await page.click('#plain-submit');
      expect((await post).headers()['x-openelement-action']).toBe('enhance');
      await page.waitForURL(/sent=1/);
    }
  });
}

for (const outcome of ['html', 'network-error'] as const) {
  test(`a disposed form cannot apply its late ${outcome}`, async ({ page, request }) => {
    const html = await (await request.get('/notes')).text();
    await page.goto('/notes/new');
    await page.waitForFunction(() => !!customElements.get('note-counter'));
    let release!: () => void;
    const held = new Promise<void>((resolve) => release = resolve);
    let received!: () => void;
    const started = new Promise<void>((resolve) => received = resolve);
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

test('Lit islands introduced by repeated enhanced responses hydrate and handle clicks', async ({ page, request }) => {
  const html = (await (await request.get('/notes')).text()).replace(
    '</main>',
    '<form method="post" action="/notes/new" data-open-enhance><button id="again">again</button></form></main>',
  );
  await page.goto('/notes/new');
  await page.waitForFunction(() => !!customElements.get('note-counter'));
  await page.route(
    '**/notes/new',
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ contentType: 'text/html', body: html })
        : route.continue(),
  );
  await page.fill('#title', 'review');
  await page.click('#submit');
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('note-counter')).not.toHaveAttribute('defer-hydration');
    await page.click('#counter');
    await expect(page.locator('#counter')).toHaveText('count: 1');
    if (i === 0) await page.click('#again');
  }
});
