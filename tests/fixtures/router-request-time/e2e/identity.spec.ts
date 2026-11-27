import { expect, test } from '@playwright/test';

test('the browser carries the action cookie through PRG, isolated from a fresh context', async ({
  browser,
}) => {
  const signedIn = await browser.newContext({ javaScriptEnabled: false });
  const anonymous = await browser.newContext({ javaScriptEnabled: false });

  try {
    const page = await signedIn.newPage();
    await page.goto('/set-header');
    await expect(page.locator('#identity')).toHaveText('anonymous');
    const posted = page.waitForResponse((response) => response.request().method() === 'POST');
    await page.getByRole('button', { name: 'go' }).click();
    const redirect = await posted;
    expect(redirect.status()).toBe(303);
    expect(await redirect.headerValue('cache-control')).toBe('no-store');
    await expect(page).toHaveURL(/\/set-header\?done=1$/);
    await expect(page.locator('#identity')).toHaveText('session');
    expect(await signedIn.cookies(page.url())).toEqual([
      expect.objectContaining({
        name: 'oe_session',
        value: 'stub-ok',
        httpOnly: true,
        path: '/',
        sameSite: 'Lax',
      }),
    ]);

    const other = await anonymous.newPage();
    const response = await other.goto(page.url());
    expect(await response?.headerValue('cache-control')).toBe('private, no-cache');
    await expect(other.locator('#identity')).toHaveText('anonymous');
    await expect(page.locator('#identity')).toHaveText('session');
  } finally {
    await Promise.all([signedIn.close(), anonymous.close()]);
  }
});

test('authorization uses the server binding and cannot personalize another request', async ({
  request,
}) => {
  const token = 'fixture-node-token';
  const [authorized, anonymous] = await Promise.all([
    request.get('/set-header', { headers: { authorization: `Bearer ${token}` } }),
    request.get('/set-header'),
  ]);
  for (const [response, identity] of [
    [authorized, 'bearer'],
    [anonymous, 'anonymous'],
  ] as const) {
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('private, no-cache');
    expect(response.headers()['set-cookie']).toBeUndefined();
    const html = await response.text();
    expect(html.replaceAll(/<!--oe:\/?t:\d+-->/g, '')).toContain(
      `<p id="identity">${identity}</p>`,
    );
    expect(html).not.toContain(token);
  }
});
