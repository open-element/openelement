/**
 * Hybrid page E2E (ADR-0120 amendment, 2026-09-16).
 *
 * /guestbook exports an action but declares no renderIntent, so its GET is
 * prerendered at build time and served from the static artifact while its
 * action POST is dispatched to dist/server at request time. /form stays the
 * dynamic+action contrast. Matrix:
 *   a. static route without action: prerendered (covered by live.spec.ts);
 *   b. hybrid route: GET is prerendered with static cache semantics, POST
 *      succeeds;
 *   c. dynamic+action route still works (contrast assertions here, full
 *      coverage in live.spec.ts);
 *   d. JS-disabled form POST (plain POST -> 303 PRG / 422 re-render);
 *   e. enhanced form (fetch with the action header -> JSON channel);
 *   f. success / 303 redirect / 422 validation re-render / notFound from an
 *      action.
 *
 * Note: the in-browser enhance+morph path is not exercised on this page
 * because the fixture pins a strict-dynamic CSP whose policy-only <meta>
 * fallback deliberately blocks all scripts on static pages (see
 * csp-nonce.spec.ts) — the no-JS path is the honest static-page contract
 * here, and the fetch channel is covered at the request level below.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

test.describe('hybrid page: static GET + request-time POST (ADR-0120 amendment)', () => {
  test('b. the hybrid GET is prerendered to a static artifact', async ({ request }) => {
    // The build wrote dist/guestbook/index.html — a request-time-only route
    // (like /form) has no such file.
    const artifact = `${distDir}/guestbook/index.html`;
    expect(existsSync(artifact)).toBe(true);
    expect(readFileSync(artifact, 'utf8')).toContain('hybrid guestbook');
    expect(existsSync(`${distDir}/form/index.html`)).toBe(false);
    expect(existsSync(`${distDir}/form.html`)).toBe(false);

    const response = await request.get('/guestbook');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('hybrid guestbook');
    // Static cache semantics: the artifact path answers `no-cache` (static
    // HTML must revalidate). It must NOT carry the request-time GET
    // relaxation (`private, no-cache`) or the POST/error `no-store`.
    expect(response.headers()['cache-control']).toBe('no-cache');

    // Contrast (c): the dynamic+action route renders per request with the
    // request-time cache relaxation.
    const dynamic = await request.get('/form');
    expect(dynamic.headers()['cache-control']).toBe('private, no-cache');
  });

  test('b/f. POST to the hybrid path succeeds (303 PRG), with no-store POST semantics', async ({ request }) => {
    const response = await request.post('/guestbook', {
      form: { note: 'hello-hybrid' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('/guestbook?posted=hello-hybrid');
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['vary']).toContain('x-openelement-action');

    // Follow the PRG: the target GET is served from the STATIC artifact, so
    // it cannot personalize on the query param (that is what 'dynamic' is
    // for) — the prerendered echo slot stays at its build-time value.
    const echo = await request.get('/guestbook?posted=hello-hybrid');
    expect(echo.ok()).toBe(true);
    expect(echo.headers()['cache-control']).toBe('no-cache');
    const html = await echo.text();
    expect(html).toContain('hybrid guestbook');
    expect(html).not.toContain('echo=hello-hybrid');
  });

  test('f. validation failure is a 422 re-render with the echo', async ({ request }) => {
    const response = await request.post('/guestbook', { form: { note: '  ' } });
    expect(response.status()).toBe(422);
    const html = await response.text();
    expect(html).toContain('note is required');
    expect(response.headers()['cache-control']).toBe('no-store');
  });

  test('f. notFound from an action answers the 404 channel', async ({ request }) => {
    const response = await request.post('/guestbook?/ghost', { form: {} });
    expect(response.status()).toBe(404);
    expect(await response.text()).toContain('this guest is gone');
  });

  test('d. the full form loop works with JavaScript disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/guestbook');
    await page.fill('#note', 'no-js-hybrid');
    await page.click('#submit');
    // Plain POST -> 303 PRG -> static GET: the URL follows the redirect and
    // the prerendered page is shown (no per-query personalization).
    await page.waitForURL('**/guestbook?posted=no-js-hybrid');
    await expect(page.locator('#guestbook-marker')).toHaveText('hybrid guestbook');
    await expect(page.locator('#echo')).toHaveText('echo=');

    await page.goto('/guestbook');
    await page.click('#submit');
    // The 422 re-render runs at request time, so the failure echo appears.
    await expect(page.locator('#error')).toHaveText('note is required');
    await context.close();
  });

  test('e. fetch callers receive the ActionResult union on the hybrid path', async ({ request }) => {
    const failure = await request.post('/guestbook', {
      form: { note: '' },
      headers: { 'x-openelement-action': 'true' },
    });
    expect(failure.status()).toBe(422);
    expect(await failure.json()).toEqual({
      type: 'failure',
      status: 422,
      data: { error: 'note is required', note: '' },
    });

    const success = await request.post('/guestbook', {
      form: { note: 'fetch-hybrid' },
      headers: { 'x-openelement-action': 'true' },
      maxRedirects: 0,
    });
    const body = await success.json();
    expect(body.type).toBe('redirect');
    expect(body.location).toBe('/guestbook?posted=fetch-hybrid');
  });
});
