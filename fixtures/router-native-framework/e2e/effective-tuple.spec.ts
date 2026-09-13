/**
 * Effective submission tuple E2E (Beta.2.2, #1339 §5): the enhanced submit
 * path and the JS-disabled native path must produce the SAME request on the
 * wire — method, URL, Content-Type and raw body — per the platform's
 * effective submission tuple (submitter overrides win over form attributes).
 *
 * The server-side observer in e2e/server.ts records exactly what arrives over
 * HTTP (before the framework parses anything); assertions compare the two
 * paths byte for byte. Relative counters (shared mutable store) follow the
 * same convention as app-flow.spec.ts / enhance-guards.spec.ts.
 */
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';

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
  const response = await request.get('/notes');
  const value = response.headers()['x-action-count'];
  expect(value).toBeTruthy();
  return Number(value);
}

/** A window marker that survives anything but a full page reload. */
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

/** Enhanced (JS on) submit of the given control; returns after ?sent=1 lands. */
async function enhancedSubmit(page: Page, selector: string, marker: string): Promise<void> {
  await page.goto('/tuple-probes');
  await markWindow(page, marker);
  await page.click(selector);
  await page.waitForURL(/\/tuple-probes\?sent=1/);
  await markerIntact(page, marker); // morph in place, never a reload
}

/** Native (JS disabled) submit of the given control; returns after ?sent=1. */
async function nativeSubmit(browser: Browser, selector: string): Promise<void> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/tuple-probes');
  await page.click(selector);
  await page.waitForURL(/\/tuple-probes\?sent=1/);
  await context.close();
}

test.describe('effective submission tuple (#1339 §5)', () => {
  test('urlencoded default: enhanced and native are byte-identical on the wire', async ({ page, request, browser }) => {
    await wireReset(request);
    const countBefore = await actionCount(request);
    await enhancedSubmit(page, '#urlenc-submit', '__preUrlenc');
    const enhanced = await wireLast(request);
    expect(enhanced).not.toBeNull();
    expect(enhanced!.method).toBe('POST');
    expect(new URL(enhanced!.url).pathname).toBe('/tuple-probes');
    expect(enhanced!.contentType).toBe('application/x-www-form-urlencoded');
    expect(enhanced!.actionHeader).toBe('enhance');
    expect(enhanced!.rawBody).toBe('title=hello+world&tag=a%26b&intent=urlenc');
    expect(await actionCount(request)).toBe(countBefore + 1);

    await wireReset(request);
    await nativeSubmit(browser, '#urlenc-submit');
    const native = await wireLast(request);
    expect(native).not.toBeNull();
    expect(native!.method).toBe('POST');
    expect(new URL(native!.url).pathname).toBe('/tuple-probes');
    expect(native!.contentType).toBe('application/x-www-form-urlencoded');
    expect(native!.actionHeader).toBeNull();
    expect(native!.rawBody).toBe(enhanced!.rawBody); // byte parity
    expect(await actionCount(request)).toBe(countBefore + 2);
  });

  test('urlencoded newline parity: a textarea serializes %0D%0A byte-identically on both paths', async ({ page, request, browser }) => {
    // Mixed newlines in one value: lone LF, lone CR and an existing CRLF all
    // become exactly one CRLF on the wire (the platform urlencoded newline
    // rule). The enhanced path must produce the same raw bytes as the native
    // JS-disabled path — never a bare %0A or %0D.
    const typed = 'alpha\nbeta\rgamma\r\ndelta';
    const expectedBody = 'note=alpha%0D%0Abeta%0D%0Agamma%0D%0Adelta&intent=nl';

    await wireReset(request);
    await page.goto('/tuple-probes');
    await markWindow(page, '__preNl');
    await page.fill('#nl-note', typed);
    await page.click('#nl-submit');
    await page.waitForURL(/\/tuple-probes\?sent=1/);
    await markerIntact(page, '__preNl'); // enhanced morph, not a reload
    const enhanced = await wireLast(request);
    expect(enhanced).not.toBeNull();
    expect(enhanced!.method).toBe('POST');
    expect(enhanced!.contentType).toBe('application/x-www-form-urlencoded');
    expect(enhanced!.actionHeader).toBe('enhance');
    expect(enhanced!.rawBody).toBe(expectedBody);
    expect(enhanced!.rawBody).toContain('%0D%0A');
    // No lone LF/CR may survive: every %0A is preceded by %0D and vice versa.
    expect(enhanced!.rawBody.replaceAll('%0D%0A', '')).not.toMatch(/%0[AD]/);

    await wireReset(request);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const plainPage = await context.newPage();
    await plainPage.goto('/tuple-probes');
    await plainPage.fill('#nl-note', typed);
    await plainPage.click('#nl-submit');
    await plainPage.waitForURL(/\/tuple-probes\?sent=1/);
    const native = await wireLast(request);
    expect(native).not.toBeNull();
    expect(native!.method).toBe('POST');
    expect(native!.contentType).toBe('application/x-www-form-urlencoded');
    expect(native!.actionHeader).toBeNull();
    expect(native!.rawBody).toContain('%0D%0A');
    // Byte-level wire parity between the native and the enhanced path.
    expect(native!.rawBody).toBe(enhanced!.rawBody);
    await context.close();
  });

  test('multipart (form enctype): boundary is real, fields survive, paths agree', async ({ page, request, browser }) => {
    await wireReset(request);
    await enhancedSubmit(page, '#multipart-submit', '__preMultipart');
    const enhanced = await wireLast(request);
    expect(enhanced!.method).toBe('POST');
    expect(enhanced!.contentType).toMatch(/^multipart\/form-data; boundary=.+/);
    expect(enhanced!.actionHeader).toBe('enhance');
    expect(enhanced!.rawBody).toContain('name="title"');
    expect(enhanced!.rawBody).toContain('multi part');
    expect(enhanced!.rawBody).toContain('name="intent"');
    expect(enhanced!.rawBody).toContain('multipart');

    await wireReset(request);
    await nativeSubmit(browser, '#multipart-submit');
    const native = await wireLast(request);
    expect(native!.contentType).toMatch(/^multipart\/form-data; boundary=.+/);
    expect(native!.actionHeader).toBeNull();
    // Boundary differs per request by design; normalize before comparing.
    const normalize = (record: WireRecord): string => {
      const boundary = record.contentType.split('boundary=')[1];
      return record.rawBody.replaceAll(boundary, 'BOUNDARY');
    };
    expect(normalize(native!)).toBe(normalize(enhanced!));
  });

  test('multipart via the submitter formenctype override', async ({ page, request, browser }) => {
    await wireReset(request);
    await enhancedSubmit(page, '#mo-submit', '__preMo');
    const enhanced = await wireLast(request);
    expect(enhanced!.contentType).toMatch(/^multipart\/form-data; boundary=.+/);
    expect(enhanced!.rawBody).toContain('via override');
    expect(enhanced!.rawBody).toContain('name="intent"');

    await wireReset(request);
    await nativeSubmit(browser, '#mo-submit');
    const native = await wireLast(request);
    expect(native!.contentType).toMatch(/^multipart\/form-data; boundary=.+/);
    expect(native!.actionHeader).toBeNull();
    expect(native!.rawBody).toContain('via override');
  });

  test('text/plain is never intercepted: native submission on both paths', async ({ page, request, browser }) => {
    const actionHeaderRequests: string[] = [];
    page.on('request', (r) => {
      if (r.headers()['x-openelement-action']) actionHeaderRequests.push(r.url());
    });
    await wireReset(request);
    await page.goto('/tuple-probes');
    await markWindow(page, '__preTextPlain');
    // text/plain falls back BEFORE preventDefault(): the browser submits
    // natively; whatever the server answers, the page performs a real
    // navigation (the tuple-probes action expects a form body, so the native
    // text/plain submission need not produce the ?sent=1 PRG target).
    const posted = page.waitForResponse((r) =>
      r.request().method() === 'POST' && r.url().includes('/tuple-probes')
    );
    await page.click('#tp-submit');
    await posted;
    await markerCleared(page, '__preTextPlain'); // full native navigation
    expect(actionHeaderRequests).toEqual([]);
    const enhancedPath = await wireLast(request);
    expect(enhancedPath!.method).toBe('POST');
    expect(enhancedPath!.contentType).toBe('text/plain');
    expect(enhancedPath!.actionHeader).toBeNull();
    expect(enhancedPath!.rawBody).toContain('title=plain text');
    expect(enhancedPath!.rawBody).toContain('intent=tp');

    await wireReset(request);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const plainPage = await context.newPage();
    await plainPage.goto('/tuple-probes');
    const nativePosted = plainPage.waitForResponse((r) =>
      r.request().method() === 'POST' && r.url().includes('/tuple-probes')
    );
    await plainPage.click('#tp-submit');
    await nativePosted;
    const native = await wireLast(request);
    expect(native!.contentType).toBe('text/plain');
    expect(native!.actionHeader).toBeNull();
    expect(native!.rawBody).toBe(enhancedPath!.rawBody);
    await context.close();
  });

  test('submitter formmethod=get on a POST form: native GET navigation, never intercepted', async ({ page, request, browser }) => {
    const actionHeaderRequests: string[] = [];
    page.on('request', (r) => {
      if (r.headers()['x-openelement-action']) actionHeaderRequests.push(r.url());
    });
    await wireReset(request);
    await page.goto('/tuple-probes');
    await markWindow(page, '__prePostGet');
    await page.click('#pg-submit');
    await page.waitForURL(/\/tuple-probes\?q=via-get/);
    await markerCleared(page, '__prePostGet');
    expect(actionHeaderRequests).toEqual([]);
    expect(await wireLast(request)).toBeNull(); // no POST reached the wire

    await wireReset(request);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const plainPage = await context.newPage();
    await plainPage.goto('/tuple-probes');
    await plainPage.click('#pg-submit');
    await plainPage.waitForURL(/\/tuple-probes\?q=via-get/);
    await context.close();
    expect(await wireLast(request)).toBeNull();
  });

  test('submitter formmethod=post on a GET form: enhanced POST, byte-identical to native', async ({ page, request, browser }) => {
    await wireReset(request);
    const countBefore = await actionCount(request);
    await enhancedSubmit(page, '#gp-submit', '__preGetPost');
    const enhanced = await wireLast(request);
    expect(enhanced!.method).toBe('POST');
    expect(enhanced!.contentType).toBe('application/x-www-form-urlencoded');
    expect(enhanced!.actionHeader).toBe('enhance');
    expect(enhanced!.rawBody).toBe('q=via-post&intent=gp');
    expect(await actionCount(request)).toBe(countBefore + 1);

    await wireReset(request);
    await nativeSubmit(browser, '#gp-submit');
    const native = await wireLast(request);
    expect(native!.method).toBe('POST');
    expect(native!.contentType).toBe('application/x-www-form-urlencoded');
    expect(native!.actionHeader).toBeNull();
    expect(native!.rawBody).toBe(enhanced!.rawBody);
  });

  test('method=dialog closes the dialog natively and is never fetch()ed', async ({ page, request }) => {
    const actionHeaderRequests: string[] = [];
    page.on('request', (r) => {
      if (r.headers()['x-openelement-action']) actionHeaderRequests.push(r.url());
    });
    await wireReset(request);
    await page.goto('/tuple-probes');
    await page.locator('#probe-dialog').evaluate((el: HTMLDialogElement) => el.showModal());
    await expect(page.locator('#probe-dialog')).toHaveJSProperty('open', true);
    await page.click('#dialog-submit');
    await expect(page.locator('#probe-dialog')).toHaveJSProperty('open', false);
    expect(actionHeaderRequests).toEqual([]);
    expect(await wireLast(request)).toBeNull();
  });

  test("submitter formtarget=_blank keeps the browser's new-tab behavior", async ({ page, request }) => {
    const actionHeaderRequests: string[] = [];
    page.on('request', (r) => {
      if (r.headers()['x-openelement-action']) actionHeaderRequests.push(r.url());
    });
    await wireReset(request);
    await page.goto('/tuple-probes');
    const popupPromise = page.waitForEvent('popup', { timeout: 5000 });
    await page.click('#to-submit');
    const popup = await popupPromise;
    expect(popup.url()).toContain('/tuple-probes');
    expect(actionHeaderRequests).toEqual([]);
    // The native submission happens inside the new tab and lands on the wire
    // as a plain POST with no enhancement header.
    const wire = await wireLast(request);
    expect(wire).not.toBeNull();
    expect(wire!.method).toBe('POST');
    expect(wire!.actionHeader).toBeNull();
    expect(wire!.rawBody).toBe('to=t');
    await popup.close();
  });
});
