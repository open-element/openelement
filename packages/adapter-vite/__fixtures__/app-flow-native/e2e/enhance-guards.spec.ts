/**
 * Enhancement-guard E2E (Beta.2.2 #1339 §5B): the application-level form/
 * platform contract rows that app-flow.spec.ts does not cover.
 *
 *   9. Submitter formaction='?/feature' override reaches the NAMED action on
 *      both the enhanced (JS) path and the native no-JS path — the ?via=feature
 *      marker on the PRG target proves the named action, not the default, ran.
 *  10. target='_blank' / cross-origin actions must NOT be intercepted by the
 *      enhancement (the Beta.2.2 fix in form-enhance.ts: a target or origin
 *      guard returns before preventDefault, so the browser keeps its native
 *      submission — new tab / cross-origin document navigation).
 *  11. Plain anchors (download attribute, fragment-only) keep browser
 *      behavior on an enhanced page: no interception channel exists for links.
 *  12. An enhanced GET form is deliberately skipped by the enhance client
 *      (form-enhance.ts) and performs a native navigation.
 *
 * State assertions are relative (shared mutable store across projects), same
 * convention as app-flow.spec.ts.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

/** Current store action-invocation counter, read off a dynamic page's header. */
async function actionCount(request: APIRequestContext): Promise<number> {
  const response = await request.get('/notes');
  expect(response.ok()).toBe(true);
  const value = response.headers()['x-action-count'];
  expect(value).toBeTruthy();
  return Number(value);
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

test.describe('9. submitter formaction override -> named action', () => {
  test(
    'enhanced path: the override posts to ?/feature with the action header',
    async ({ page, request }, info) => {
      const countBefore = await actionCount(request);
      const title = `Feature enhanced ${info.project.name}`;

      await page.goto('/notes/new');
      const namedPost = page.waitForResponse((r) =>
        r.request().method() === 'POST' && r.url().includes('?/feature')
      );
      await page.fill('#title', title);
      await page.click('#feature');
      const response = await namedPost;

      // The enhanced client resolved the submitter's formAction IDL and posted
      // to the formaction URL with the enhancement header (#576 + ADR-0120).
      expect(response.request().headers()['x-openelement-action']).toBe('enhance');
      expect(response.status()).toBe(303);
      expect(response.headers()['location']).toMatch(/^\/notes\/note-\d+\?created=1&via=feature$/);
      expect(await actionCount(request)).toBe(countBefore + 1);

      // The ?via=feature flash proves the NAMED action ran (the default action
      // redirects without it); the named submitter value traveled too.
      await page.waitForURL(/\/notes\/note-\d+\?created=1&via=feature$/);
      await expect(page.locator('#note-title')).toHaveText(title);
      await expect(page.locator('#last-intent')).toHaveText('intent=feature');
    },
  );

  test(
    'no-JS path: the native POST goes to the formaction URL',
    async ({ browser, request }, info) => {
      const countBefore = await actionCount(request);
      const title = `Feature native ${info.project.name}`;

      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto('/notes/new');
      await page.fill('#title', title);
      await page.click('#feature');
      await page.waitForURL(/\/notes\/note-\d+\?created=1&via=feature$/);
      await expect(page.locator('#note-title')).toHaveText(title);
      await expect(page.locator('#last-intent')).toHaveText('intent=feature');
      expect(await actionCount(request)).toBe(countBefore + 1);
      await context.close();
    },
  );
});

test.describe('10. forms the enhancement must NOT intercept', () => {
  test('the enhance layer is live on /playground (control)', async ({ page }) => {
    await page.goto('/playground');
    await markWindow(page, '__prePlain');
    const enhancedPosts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.headers()['x-openelement-action'] === 'enhance') {
        enhancedPosts.push(r.url());
      }
    });
    await page.click('#plain-submit');
    // A same-origin POST enhance form IS intercepted: action-header fetch to
    // /playground, whose 404 status page is not morphable -> full navigation.
    await page.waitForResponse((r) =>
      r.request().method() === 'POST' && r.url().includes('/playground')
    );
    await markerCleared(page, '__prePlain');
    expect(enhancedPosts.length).toBe(1);
    await expect(page.locator('h1')).toHaveText('playground');
  });

  test("a target='_blank' form keeps the browser's new-tab behavior", async ({ page }) => {
    // Contract (#1339 §5.8): a form targeting another browsing context is not
    // owned by the enhancement — form-enhance.ts returns before
    // preventDefault(), so the browser opens the new tab with a native POST.
    await page.goto('/playground');
    const actionHeaderRequests: string[] = [];
    page.on('request', (r) => {
      if (r.headers()['x-openelement-action']) actionHeaderRequests.push(r.url());
    });

    const popupPromise = page.waitForEvent('popup', { timeout: 5000 });
    await page.click('#blank-submit');
    const popup = await popupPromise;
    // Contract: the browser opened a new tab with a native POST; the
    // enhancement fired nothing.
    expect(popup.url()).toContain('/playground');
    expect(actionHeaderRequests).toEqual([]);
    await popup.close();
  });

  test('a cross-origin action keeps the browser navigation', async ({ page }) => {
    // Contract (#1339 §5.8): a cross-origin action is not owned by the
    // enhancement — form-enhance.ts returns before preventDefault(), so the
    // browser performs the plain cross-origin document navigation with no
    // action header, no CORS preflight, no fallback reload.
    const seen: { method: string; url: string; acrHeaders?: string; actionHeader?: string }[] = [];
    const sink = http.createServer((req, res) => {
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        acrHeaders: req.headers['access-control-request-headers'] as string | undefined,
        actionHeader: req.headers['x-openelement-action'] as string | undefined,
      });
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>cross-origin sink</body></html>');
    });
    await new Promise<void>((resolve) => sink.listen(4399, '127.0.0.1', resolve));
    const sinkOrigin = `http://127.0.0.1:${(sink.address() as AddressInfo).port}`;

    try {
      await page.goto('/playground');
      await page.click('#cross-submit');
      // Contract: plain cross-origin document navigation to the sink, with no
      // enhancement header involved at all.
      await page.waitForURL(`${sinkOrigin}/sink`, { timeout: 5000 });
      await expect(page.locator('body')).toHaveText('cross-origin sink');
      const posts = seen.filter((r) => r.method === 'POST');
      expect(posts.length).toBe(1);
      expect(posts[0].actionHeader).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => sink.close(() => resolve()));
    }
  });
});

test.describe('11. plain links keep browser behavior', () => {
  test('fragment and download links are never intercepted', async ({ page }) => {
    await page.goto('/playground');
    await markWindow(page, '__preLinks');
    const enhancedRequests: string[] = [];
    page.on('request', (r) => {
      if (r.headers()['x-openelement-action']) enhancedRequests.push(r.url());
    });

    // Fragment-only link: hash change in place — no reload, no request.
    await page.click('#frag-link');
    await expect(page).toHaveURL(/\/playground#frag-target$/);
    await markerIntact(page, '__preLinks');

    // download attribute: the browser downloads instead of navigating.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#download-link'),
    ]);
    expect(download.url()).toContain('/notes');
    await expect(page).toHaveURL(/\/playground#frag-target$/, 'still on the playground page');
    await markerIntact(page, '__preLinks');

    expect(enhancedRequests).toEqual([]);
  });
});

test.describe('12. enhanced GET form', () => {
  test('a GET form performs a native navigation (enhance client skips GET)', async ({ page }) => {
    await page.goto('/playground');
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
    await page.waitForURL(/\/playground\?q=hello$/);
    await markerCleared(page, '__preGet');
    await expect(page.locator('h1')).toHaveText('playground');

    const navigations = requests.filter((r) => r.url.includes('q=hello'));
    expect(navigations.length).toBeGreaterThan(0);
    for (const nav of navigations) {
      expect(nav.method).toBe('GET');
      expect(nav.actionHeader).toBeUndefined();
    }
    expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
  });
});

test('base target applies to a native renderer enhanced form', async ({ page }) => {
  await page.goto('/notes/new');
  await page.fill('#title', 'base target native');
  await page.evaluate(() => {
    const base = document.createElement('base');
    base.target = '_blank';
    document.head.append(base);
  });
  const popup = page.waitForEvent('popup');
  await page.click('#submit');
  const opened = await popup;
  await opened.waitForLoadState();
  await expect(page).toHaveURL(/\/notes\/new$/);
  await opened.close();
});
