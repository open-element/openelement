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
import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  type Request,
  test,
} from '@playwright/test';

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

const sentUrl = /\/tuple-probes\?sent=1$/;
const getUrl = /\/tuple-probes\?q=via-get$/;

function mainDocumentRequest(page: Page, request: Request): boolean {
  return (
    request.isNavigationRequest() &&
    request.resourceType() === 'document' &&
    request.frame() === page.mainFrame()
  );
}

/** Enhanced form PRG finishes with a morph and URL update in the live document. */
async function enhancedSubmit(
  page: Page,
  request: APIRequestContext,
  selector: string,
  prepare?: (page: Page) => Promise<void>,
): Promise<WireRecord> {
  await page.goto('/tuple-probes');
  await prepare?.(page);
  const documents: string[] = [];
  let loads = 0;
  const recordDocument = (outgoing: Request): void => {
    if (mainDocumentRequest(page, outgoing))
      documents.push(`${outgoing.method()} ${outgoing.url()}`);
  };
  const recordLoad = (): void => {
    loads++;
  };
  page.on('request', recordDocument);
  page.on('load', recordLoad);
  try {
    await Promise.all([page.waitForURL(sentUrl), page.locator(selector).click()]);
    await expect(page.getByRole('heading', { name: 'tuple probes' })).toBeVisible();
    const wire = await wireLast(request);
    expect(documents, 'the enhanced PRG morph issues no main-frame document request').toEqual([]);
    expect(loads, 'the enhanced PRG morph does not load a new document').toBe(0);
    expect(wire?.method).toBe('POST');
    expect(new URL(wire!.url).pathname).toBe('/tuple-probes');
    expect(wire!.actionHeader).toBe('enhance');
    return wire!;
  } finally {
    page.off('request', recordDocument);
    page.off('load', recordLoad);
  }
}

interface NativeSubmission {
  method: 'GET' | 'POST';
  finalUrl?: RegExp;
}

/** Observe the new document load and trace its response back to the actual submit. */
async function submitDocument(
  page: Page,
  selector: string,
  { method, finalUrl }: NativeSubmission,
): Promise<void> {
  const enhancedRequests: string[] = [];
  const recordEnhanced = (request: Request): void => {
    if (request.headers()['x-openelement-action'] !== undefined)
      enhancedRequests.push(request.url());
  };
  page.on('request', recordEnhanced);
  try {
    const [response] = await Promise.all([
      page.waitForResponse((response) => {
        const redirect =
          response.status() >= 300 && response.status() < 400 && response.headers().location;
        return (
          !redirect &&
          mainDocumentRequest(page, response.request()) &&
          (finalUrl === undefined || finalUrl.test(response.url()))
        );
      }),
      page.waitForEvent('load'),
      page.locator(selector).click(),
    ]);
    await expect(page).toHaveURL(response.url());

    let submission = response.request();
    for (
      let previous = submission.redirectedFrom();
      previous;
      previous = previous.redirectedFrom()
    ) {
      submission = previous;
    }
    expect(mainDocumentRequest(page, submission)).toBe(true);
    expect(submission.method()).toBe(method);
    expect(new URL(submission.url()).pathname).toBe('/tuple-probes');
    expect(enhancedRequests, 'native submission carries no enhancement header').toEqual([]);
  } finally {
    page.off('request', recordEnhanced);
  }
}

async function nativeSubmit(
  browser: Browser,
  selector: string,
  destination: NativeSubmission = { method: 'POST', finalUrl: sentUrl },
  prepare?: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/tuple-probes');
    await prepare?.(page);
    await submitDocument(page, selector, destination);
  } finally {
    await context.close();
  }
}

test.describe('effective submission tuple (#1339 §5)', () => {
  test('urlencoded default: enhanced and native are byte-identical on the wire', async ({
    page,
    request,
    browser,
  }) => {
    await wireReset(request);
    const countBefore = await actionCount(request);
    const enhanced = await enhancedSubmit(page, request, '#urlenc-submit');
    expect(enhanced.contentType).toBe('application/x-www-form-urlencoded');
    expect(enhanced.rawBody).toBe('title=hello+world&tag=a%26b&intent=urlenc');
    expect(await actionCount(request)).toBe(countBefore + 1);

    await wireReset(request);
    await nativeSubmit(browser, '#urlenc-submit');
    const native = await wireLast(request);
    expect(native).not.toBeNull();
    expect(native!.method).toBe('POST');
    expect(new URL(native!.url).pathname).toBe('/tuple-probes');
    expect(native!.contentType).toBe('application/x-www-form-urlencoded');
    expect(native!.actionHeader).toBeNull();
    expect(native!.rawBody).toBe(enhanced.rawBody); // byte parity
    expect(await actionCount(request)).toBe(countBefore + 2);
  });

  test('urlencoded newline parity: a textarea serializes %0D%0A byte-identically on both paths', async ({
    page,
    request,
    browser,
  }) => {
    // Mixed newlines in one value: lone LF, lone CR and an existing CRLF all
    // become exactly one CRLF on the wire (the platform urlencoded newline
    // rule). The enhanced path must produce the same raw bytes as the native
    // JS-disabled path — never a bare %0A or %0D.
    const typed = 'alpha\nbeta\rgamma\r\ndelta';
    const expectedBody = 'note=alpha%0D%0Abeta%0D%0Agamma%0D%0Adelta&intent=nl';
    const fillNote = (page: Page) => page.locator('#nl-note').fill(typed);

    await wireReset(request);
    const enhanced = await enhancedSubmit(page, request, '#nl-submit', fillNote);
    expect(enhanced.contentType).toBe('application/x-www-form-urlencoded');
    expect(enhanced.rawBody).toBe(expectedBody);
    expect(enhanced.rawBody).toContain('%0D%0A');
    // No lone LF/CR may survive: every %0A is preceded by %0D and vice versa.
    expect(enhanced.rawBody.replaceAll('%0D%0A', '')).not.toMatch(/%0[AD]/);

    await wireReset(request);
    await nativeSubmit(browser, '#nl-submit', { method: 'POST', finalUrl: sentUrl }, fillNote);
    const native = await wireLast(request);
    expect(native).not.toBeNull();
    expect(native!.method).toBe('POST');
    expect(native!.contentType).toBe('application/x-www-form-urlencoded');
    expect(native!.actionHeader).toBeNull();
    expect(native!.rawBody).toContain('%0D%0A');
    // Byte-level wire parity between the native and the enhanced path.
    expect(native!.rawBody).toBe(enhanced.rawBody);
  });

  test('multipart (form enctype): boundary is real, fields survive, paths agree', async ({
    page,
    request,
    browser,
  }) => {
    await wireReset(request);
    const enhanced = await enhancedSubmit(page, request, '#multipart-submit');
    expect(enhanced.contentType).toMatch(/^multipart\/form-data; boundary=.+/);
    expect(enhanced.rawBody).toContain('name="title"');
    expect(enhanced.rawBody).toContain('multi part');
    expect(enhanced.rawBody).toContain('name="intent"');
    expect(enhanced.rawBody).toContain('multipart');

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
    expect(normalize(native!)).toBe(normalize(enhanced));
  });

  test('multipart via the submitter formenctype override', async ({ page, request, browser }) => {
    await wireReset(request);
    const enhanced = await enhancedSubmit(page, request, '#mo-submit');
    expect(enhanced.contentType).toMatch(/^multipart\/form-data; boundary=.+/);
    expect(enhanced.rawBody).toContain('via override');
    expect(enhanced.rawBody).toContain('name="intent"');

    await wireReset(request);
    await nativeSubmit(browser, '#mo-submit');
    const native = await wireLast(request);
    expect(native!.contentType).toMatch(/^multipart\/form-data; boundary=.+/);
    expect(native!.actionHeader).toBeNull();
    expect(native!.rawBody).toContain('via override');
  });

  test('text/plain is never intercepted: native submission on both paths', async ({
    page,
    request,
    browser,
  }) => {
    await wireReset(request);
    await page.goto('/tuple-probes');
    // text/plain falls back BEFORE preventDefault(): the browser submits
    // natively; whatever the server answers, the page performs a real
    // navigation (the tuple-probes action expects a form body, so the native
    // text/plain submission need not produce the ?sent=1 PRG target).
    await submitDocument(page, '#tp-submit', { method: 'POST' });
    const enhancedPath = await wireLast(request);
    expect(enhancedPath!.method).toBe('POST');
    expect(enhancedPath!.contentType).toBe('text/plain');
    expect(enhancedPath!.actionHeader).toBeNull();
    expect(enhancedPath!.rawBody).toContain('title=plain text');
    expect(enhancedPath!.rawBody).toContain('intent=tp');

    await wireReset(request);
    await nativeSubmit(browser, '#tp-submit', { method: 'POST' });
    const native = await wireLast(request);
    expect(native!.contentType).toBe('text/plain');
    expect(native!.actionHeader).toBeNull();
    expect(native!.rawBody).toBe(enhancedPath!.rawBody);
  });

  test('submitter formmethod=get on a POST form: native GET navigation, never intercepted', async ({
    page,
    request,
    browser,
  }) => {
    await wireReset(request);
    await page.goto('/tuple-probes');
    await submitDocument(page, '#pg-submit', { method: 'GET', finalUrl: getUrl });
    expect(await wireLast(request)).toBeNull(); // no POST reached the wire

    await wireReset(request);
    await nativeSubmit(browser, '#pg-submit', { method: 'GET', finalUrl: getUrl });
    expect(await wireLast(request)).toBeNull();
  });

  test('submitter formmethod=post on a GET form: enhanced POST, byte-identical to native', async ({
    page,
    request,
    browser,
  }) => {
    await wireReset(request);
    const countBefore = await actionCount(request);
    const enhanced = await enhancedSubmit(page, request, '#gp-submit');
    expect(enhanced.contentType).toBe('application/x-www-form-urlencoded');
    expect(enhanced.rawBody).toBe('q=via-post&intent=gp');
    expect(await actionCount(request)).toBe(countBefore + 1);

    await wireReset(request);
    await nativeSubmit(browser, '#gp-submit');
    const native = await wireLast(request);
    expect(native!.method).toBe('POST');
    expect(native!.contentType).toBe('application/x-www-form-urlencoded');
    expect(native!.actionHeader).toBeNull();
    expect(native!.rawBody).toBe(enhanced.rawBody);
  });

  test('method=dialog closes the dialog natively and is never fetch()ed', async ({
    page,
    request,
  }) => {
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

  test("submitter formtarget=_blank keeps the browser's new-tab behavior", async ({
    page,
    request,
  }) => {
    const actionHeaderRequests: string[] = [];
    page.on('request', (r) => {
      if (r.headers()['x-openelement-action']) actionHeaderRequests.push(r.url());
    });
    await wireReset(request);
    await page.goto('/tuple-probes');
    // The initial popup POST can start before Playwright exposes the popup page.
    const [popup, posted] = await Promise.all([
      page.waitForEvent('popup', { timeout: 5000 }),
      page.context().waitForEvent('response', (response) => {
        const submission = response.request();
        return (
          submission.isNavigationRequest() &&
          submission.resourceType() === 'document' &&
          submission.method() === 'POST' &&
          new URL(submission.url()).pathname === '/tuple-probes'
        );
      }),
      page.locator('#to-submit').click(),
    ]);
    await popup.waitForURL(sentUrl, { waitUntil: 'load' });
    expect(posted.request().headers()['x-openelement-action']).toBeUndefined();
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
