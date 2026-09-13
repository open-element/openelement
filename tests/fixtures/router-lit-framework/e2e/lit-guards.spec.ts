/**
 * Enhancement-guard + effective-tuple E2E for the Lit renderer (Beta.2.2
 * #1339 §5/§5B) — the app-flow-lit counterpart of the native fixture's
 * enhance-guards.spec.ts / effective-tuple.spec.ts. The enhance client is
 * shared code inlined into both renderers' client entries; these tests prove
 * the LIT wiring actually runs it: interception happens exactly where the
 * contract says it must, and forms/links the application does not own keep
 * native browser behavior.
 *
 *   - control: a same-origin enhanced POST IS intercepted (action header on
 *     the fetch, 303 -> morph in place, window marker survives);
 *   - target='_blank': the browser opens a new tab with a native POST — no
 *     enhancement header fired;
 *   - cross-origin action: plain cross-origin document navigation — no
 *     action header, no CORS preflight, no fallback reload;
 *   - GET form: native navigation (the enhance client skips GET by design);
 *   - fragment/download anchors: never intercepted;
 *   - effective tuple: enhanced and native urlencoded submissions are
     byte-identical on the wire, including CRLF newline normalization.
 *
 * State assertions are relative (shared mutable store across projects), the
 * same convention as lit-flow.spec.ts.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

interface WireRecord {
  method: string;
  url: string;
  contentType: string;
  actionHeader: string | null;
  rawBody: string;
}

async function wireLast(request: APIRequestContext): Promise<WireRecord | null> {
  const response = await request.get('/__wire/last');
  expect(response.ok()).toBe(true);
  return (await response.json()).last as WireRecord | null;
}

async function wireReset(request: APIRequestContext): Promise<void> {
  const response = await request.get('/__wire/reset');
  expect(response.ok()).toBe(true);
}

async function actionCount(request: APIRequestContext): Promise<number> {
  const response = await request.get('/api/diagnostics');
  expect(response.ok()).toBe(true);
  return Number((await response.json()).actionCount);
}

/** Set a window marker that survives anything but a full page reload. */
async function markWindow(page: Page, name: string): Promise<void> {
  await page.evaluate((marker) => {
    (window as unknown as Record<string, number>)[marker] = 1;
  }, name);
}

async function markerCleared(page: Page, name: string): Promise<void> {
  await page.waitForFunction(
    (marker) => (window as never as Record<string, number | undefined>)[marker] === undefined,
    name,
  );
}

async function markerIntact(page: Page, name: string): Promise<void> {
  expect(
    await page.evaluate(
      (marker) => (window as unknown as Record<string, number | undefined>)[marker],
      name,
    ),
  ).toBe(1);
}

test.describe('control: the enhance layer is live on /guards', () => {
  test('a same-origin enhanced POST is intercepted and morphs in place', async ({ page, request }) => {
    const countBefore = await actionCount(request);
    await page.goto('/guards');
    await markWindow(page, '__prePlain');

    const enhancedPost = page.waitForResponse((r) =>
      r.request().method() === 'POST' && r.url().includes('/guards')
    );
    await page.click('#plain-submit');
    const response = await enhancedPost;
    expect(response.request().headers()['x-openelement-action']).toBe('enhance');
    expect(response.status()).toBe(303);

    // The fetch follows the 303 to 200 HTML: morph in place, never a reload.
    await page.waitForURL(/\/guards\?sent=1$/);
    await markerIntact(page, '__prePlain');
    expect(await actionCount(request)).toBe(countBefore + 1);
  });
});

test.describe('forms the enhancement must NOT intercept', () => {
  test("a target='_blank' form keeps the browser's new-tab behavior", async ({ page }) => {
    await page.goto('/guards');
    const actionHeaderRequests: string[] = [];
    page.on('request', (r) => {
      if (r.headers()['x-openelement-action']) actionHeaderRequests.push(r.url());
    });

    const popupPromise = page.waitForEvent('popup', { timeout: 5000 });
    await page.click('#blank-submit');
    const popup = await popupPromise;
    expect(popup.url()).toContain('/guards');
    expect(actionHeaderRequests).toEqual([]);
    await popup.close();
  });

  test('a cross-origin action keeps the browser navigation', async ({ page }) => {
    const seen: { method: string; url: string; actionHeader?: string }[] = [];
    const sink = http.createServer((req, res) => {
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        actionHeader: req.headers['x-openelement-action'] as string | undefined,
      });
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>cross-origin sink</body></html>');
    });
    await new Promise<void>((resolve) => sink.listen(4399, '127.0.0.1', resolve));
    const sinkOrigin = `http://127.0.0.1:${(sink.address() as AddressInfo).port}`;

    try {
      await page.goto('/guards');
      await page.click('#cross-submit');
      await page.waitForURL(`${sinkOrigin}/sink`, { timeout: 5000 });
      await expect(page.locator('body')).toHaveText('cross-origin sink');
      const posts = seen.filter((r) => r.method === 'POST');
      expect(posts.length).toBe(1);
      expect(posts[0].actionHeader).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => sink.close(() => resolve()));
    }
  });

  test('a GET form performs a native navigation (enhance client skips GET)', async ({ page }) => {
    await page.goto('/guards');
    await markWindow(page, '__preGet');
    const requests: { url: string; method: string; actionHeader?: string }[] = [];
    page.on('request', (r) => {
      requests.push({
        url: r.url(),
        method: r.method(),
        actionHeader: r.headers()['x-openelement-action'],
      });
    });

    await page.fill('#get-q', 'hello');
    await page.click('#get-submit');
    // Native GET navigation: query lands in the URL and the page reloaded.
    await page.waitForURL(/\/guards\?q=hello$/);
    await markerCleared(page, '__preGet');
    await expect(page.locator('h1')).toHaveText('guards');

    const navigations = requests.filter((r) => r.url.includes('q=hello'));
    expect(navigations.length).toBeGreaterThan(0);
    for (const nav of navigations) {
      expect(nav.method).toBe('GET');
      expect(nav.actionHeader).toBeUndefined();
    }
    expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
  });
});

test.describe('plain links keep browser behavior', () => {
  test('fragment and download links are never intercepted', async ({ page }) => {
    await page.goto('/guards');
    await markWindow(page, '__preLinks');
    const enhancedRequests: string[] = [];
    page.on('request', (r) => {
      if (r.headers()['x-openelement-action']) enhancedRequests.push(r.url());
    });

    await page.click('#frag-link');
    await expect(page).toHaveURL(/\/guards#frag-target$/);
    await markerIntact(page, '__preLinks');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#download-link'),
    ]);
    expect(download.url()).toContain('/notes');
    await expect(page).toHaveURL(/\/guards#frag-target$/, 'still on the guards page');
    await markerIntact(page, '__preLinks');

    expect(enhancedRequests).toEqual([]);
  });
});

test.describe('effective submission tuple (#1339 §5)', () => {
  test('urlencoded default: enhanced and native are byte-identical on the wire', async ({ page, request, browser }) => {
    await wireReset(request);
    const countBefore = await actionCount(request);

    // Enhanced (JS on): fetch with the action header, morph in place.
    await page.goto('/guards');
    await markWindow(page, '__preUrlenc');
    await page.click('#urlenc-submit');
    await page.waitForURL(/\/guards\?sent=1$/);
    await markerIntact(page, '__preUrlenc');
    const enhanced = await wireLast(request);
    expect(enhanced).not.toBeNull();
    expect(enhanced!.method).toBe('POST');
    expect(new URL(enhanced!.url).pathname).toBe('/guards');
    expect(enhanced!.contentType).toBe('application/x-www-form-urlencoded');
    expect(enhanced!.actionHeader).toBe('enhance');
    expect(enhanced!.rawBody).toBe('title=hello+world&tag=a%26b&intent=urlenc');
    expect(await actionCount(request)).toBe(countBefore + 1);

    // Native (JS disabled): the browser's own submission, same bytes.
    await wireReset(request);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const plainPage = await context.newPage();
    await plainPage.goto('/guards');
    await plainPage.click('#urlenc-submit');
    await plainPage.waitForURL(/\/guards\?sent=1$/);
    const native = await wireLast(request);
    await context.close();
    expect(native).not.toBeNull();
    expect(native!.method).toBe('POST');
    expect(new URL(native!.url).pathname).toBe('/guards');
    expect(native!.contentType).toBe('application/x-www-form-urlencoded');
    expect(native!.actionHeader).toBeNull();
    expect(native!.rawBody).toBe(enhanced!.rawBody); // byte parity
    expect(await actionCount(request)).toBe(countBefore + 2);
  });

  test('urlencoded newline parity: a textarea serializes %0D%0A byte-identically on both paths', async ({ page, request, browser }) => {
    const typed = 'alpha\nbeta\rgamma\r\ndelta';
    const expectedBody = 'note=alpha%0D%0Abeta%0D%0Agamma%0D%0Adelta&intent=nl';

    await wireReset(request);
    await page.goto('/guards');
    await page.fill('#nl-note', typed);
    await page.click('#nl-submit');
    await page.waitForURL(/\/guards\?sent=1$/);
    const enhanced = await wireLast(request);
    expect(enhanced).not.toBeNull();
    expect(enhanced!.contentType).toBe('application/x-www-form-urlencoded');
    expect(enhanced!.actionHeader).toBe('enhance');
    expect(enhanced!.rawBody).toBe(expectedBody);
    // No lone LF/CR may survive: every %0A is preceded by %0D and vice versa.
    expect(enhanced!.rawBody.replaceAll('%0D%0A', '')).not.toMatch(/%0[AD]/);

    await wireReset(request);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const plainPage = await context.newPage();
    await plainPage.goto('/guards');
    await plainPage.fill('#nl-note', typed);
    await plainPage.click('#nl-submit');
    await plainPage.waitForURL(/\/guards\?sent=1$/);
    const native = await wireLast(request);
    await context.close();
    expect(native).not.toBeNull();
    expect(native!.rawBody).toBe(enhanced!.rawBody); // byte parity
  });
});
