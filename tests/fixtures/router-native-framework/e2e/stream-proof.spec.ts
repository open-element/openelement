import { expect, test } from '@playwright/test';

test('generated streaming route flushes a shell before the delayed Part', async ({ request }) => {
  const response = await request.get('/stream-proof?delay=100');
  expect(response.status()).toBe(200);
  expect(response.headers()['x-stream-proof']).toBe('front-gate');
  expect(response.headers()['set-cookie']).toContain('stream-proof=1');
  const text = await response.text();
  expect(text).toContain('stream-proof-page');
  expect(text).toContain('data-oe-stream-request=');
  expect(text).toContain('Rendered as data resolves');
  expect(text.indexOf('data-oe-stream-request=')).toBeLessThan(
    text.indexOf('Rendered as data resolves'),
  );
});

test('same delayed data without stream opt-in produces a complete ordinary document', async ({ request }) => {
  const response = await request.get('/stream-proof-off?delay=100');
  expect(response.status()).toBe(200);
  expect(response.headers()['x-stream-proof']).toBe('front-gate');
  const text = await response.text();
  expect(text).toContain('Rendered as data resolves');
  expect(text).not.toContain('data-oe-stream-request=');
  expect(text).not.toContain('data-oe-frame=');
});

test('with JavaScript a late frame fills the owning Part in place', async ({ page }) => {
  await page.goto('/stream-proof?delay=100');
  await expect(page.locator('stream-proof-page #delayed')).toHaveText(
    'Rendered as data resolves',
  );
  await expect(page.locator('body')).not.toContainText('Content unavailable.');
});

test('late failure remains an in-stream error, while action remains a redirect', async ({ request }) => {
  const failed = await request.get('/stream-proof?fail=1');
  expect(failed.status()).toBe(200);
  expect(await failed.text()).toContain('outcome&quot;:&quot;error');

  const action = await request.post('/stream-proof', {
    form: {},
    maxRedirects: 0,
  });
  expect(action.status()).toBe(303);
  expect(action.headers()['location']).toBe('/stream-proof?sent=1');
  expect(action.headers()['content-type'] ?? '').not.toContain('text/event-stream');
});

test('streamed Part remains readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/stream-proof');
    await expect.poll(() => page.locator('body').innerText()).toContain(
      'Rendered as data resolves',
    );
    await expect(page.locator('stream-proof-page button')).toBeVisible();
    // ADR-0159 specifies an arrival-order no-JS tail, not an in-place Part.
    await expect(page.locator('stream-proof-page #delayed')).toBeEmpty();
  } finally {
    await context.close();
  }
});
