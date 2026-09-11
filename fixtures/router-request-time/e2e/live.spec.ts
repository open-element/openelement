/**
 * Request-time rendering E2E (0.42.0-alpha.1).
 *
 * Proves that renderIntent: { mode: 'dynamic' } routes are rendered per
 * request (not prerendered), that islands hydrate on request-time pages
 * exactly like on static pages, and that static routes are untouched.
 */
import { expect, test } from '@playwright/test';
import { createIslandScheduler } from '../../../packages/router/src/vite/internal/ssg/island-scheduler.ts';

test.describe('request-time rendering', () => {
  test('GET /live renders loader data per request', async ({ request }) => {
    const first = await request.get('/live?x=42');
    expect(first.ok()).toBe(true);
    const firstHtml = await first.text();
    expect(firstHtml).toContain('x=42');

    const second = await request.get('/live?x=99');
    expect(second.ok()).toBe(true);
    const secondHtml = await second.text();
    expect(secondHtml).toContain('x=99');
    expect(secondHtml).not.toContain('x=42');

    // Per-request proof: the nonce increments between requests, so the two
    // responses cannot both come from a prerendered file.
    const firstNonce = /nonce=(\d+)/.exec(firstHtml)?.[1];
    const secondNonce = /nonce=(\d+)/.exec(secondHtml)?.[1];
    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    expect(Number(secondNonce)).toBeGreaterThan(Number(firstNonce));
  });

  test('counter island hydrates on the request-time page', async ({ page }) => {
    await page.goto('/live?x=42');
    const button = page.locator('live-counter #increment');
    const count = page.locator('live-counter #count');
    await expect(button).toBeVisible();
    await button.click();
    await expect(count).toHaveText('1');
    await button.click();
    await expect(count).toHaveText('2');
  });

  test('GET / serves the prerendered static page', async ({ page, request }) => {
    const response = await request.get('/');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('request-time fixture home');

    await page.goto('/');
    await expect(page.locator('#home-marker')).toHaveText('request-time fixture home');
  });

  test('action route builds and responds to POST', async ({ request }) => {
    const response = await request.post('/form', {
      form: { message: 'hello-action' },
    });
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('echo=hello-action');
  });
});

test.describe('action protocol (ADR-0120, 0.42.0-alpha.2)', () => {
  test('validation failure returns 422 with the echo (no JS needed)', async ({ request }) => {
    const response = await request.post('/form', { form: { message: '  ' } });
    expect(response.status()).toBe(422);
    const html = await response.text();
    expect(html).toContain('message is required');
  });

  test('valid submission is a 303 PRG redirect, never a 200 render', async ({ request }) => {
    const response = await request.post('/form', {
      form: { message: 'hello-action' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('/form?echoed=hello-action');
  });

  test('named action via formaction dispatches to ?/shout', async ({ request }) => {
    const response = await request.post('/form?/shout', {
      form: { message: 'hi there' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('/live?x=HI%20THERE');
  });

  test('unknown named action is a defined 404', async ({ request }) => {
    const response = await request.post('/form?/nope', { form: { message: 'x' } });
    expect(response.status()).toBe(404);
  });

  test('fetch callers receive the ActionResult union', async ({ request }) => {
    const failure = await request.post('/form', {
      form: { message: '' },
      headers: { 'x-openelement-action': 'true' },
    });
    expect(failure.status()).toBe(422);
    expect(await failure.json()).toEqual({
      type: 'failure',
      status: 422,
      data: { error: 'message is required', message: '' },
    });

    const success = await request.post('/form', {
      form: { message: 'hello' },
      headers: { 'x-openelement-action': 'true' },
      maxRedirects: 0,
    });
    const body = await success.json();
    expect(body.type).toBe('redirect');
    expect(body.location).toBe('/form?echoed=hello');
  });

  test('full form loop works with JavaScript disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/form');
    await page.fill('#message', 'no-js-works');
    await page.click('#submit');
    await page.waitForURL('**/form?echoed=no-js-works');
    await expect(page.locator('#echo')).toHaveText('echo=no-js-works');

    await page.goto('/form');
    await page.click('#submit');
    await expect(page.locator('#error')).toHaveText('message is required');
    await context.close();
  });

  test('enhanced submit morphs the PRG target without a native POST', async ({ page }) => {
    await page.goto('/form');
    // Island state is the honest-path guard: a native reload would reset it,
    // so this test cannot pass through the no-JS path by accident.
    const button = page.locator('live-counter #increment');
    const count = page.locator('live-counter #count');
    await button.click();
    await expect(count).toHaveText('1');
    await page.fill('#message', 'enhanced-path');
    await page.click('#submit');
    await page.waitForURL('**/form?echoed=enhanced-path');
    await expect(page.locator('#echo')).toHaveText('echo=enhanced-path');
    await expect(count).toHaveText('1');
  });
});

test.describe('revalidation continuity (0.42.0-alpha.3)', () => {
  test('422 morph keeps a hydrated island alive and shows the failure echo', async ({ page }) => {
    await page.goto('/form');
    const button = page.locator('live-counter #increment');
    const count = page.locator('live-counter #count');
    await button.click();
    await button.click();
    await button.click();
    await expect(count).toHaveText('3');

    await page.click('#submit');
    await expect(page.locator('#error')).toHaveText('message is required');
    // The island survived the morph: its shadow state was not reset.
    await expect(count).toHaveText('3');
  });

  test('PRG morph preserves island state and updates the URL', async ({ page }) => {
    await page.goto('/form');
    const button = page.locator('live-counter #increment');
    const count = page.locator('live-counter #count');
    await button.click();
    await button.click();
    await expect(count).toHaveText('2');

    await page.fill('#message', 'morph-keeps-islands');
    await page.click('#submit');
    await page.waitForURL('**/form?echoed=morph-keeps-islands');
    await expect(page.locator('#echo')).toHaveText('echo=morph-keeps-islands');
    await expect(count).toHaveText('2');
  });

  test('mixed static/request-time navigation keeps both modes working', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#home-marker')).toHaveText('request-time fixture home');
    await page.goto('/live?x=mixed');
    await expect(page.locator('#x-value')).toHaveText('x=mixed');
    await page.goto('/');
    await expect(page.locator('#home-marker')).toHaveText('request-time fixture home');
  });
});

test.describe('validation recipes (0.42.0-alpha.4)', () => {
  test('zod recipe: 422 with the library message, then PRG success', async ({ request }) => {
    const failure = await request.post('/register', { form: { email: 'not-an-email' } });
    expect(failure.status()).toBe(422);
    expect(await failure.text()).toContain('a valid email is required');

    const success = await request.post('/register', {
      form: { email: 'ada@example.com' },
      maxRedirects: 0,
    });
    expect(success.status()).toBe(303);
    expect(success.headers()['location']).toBe('/register?welcome=ada%40example.com');
  });

  test('valibot recipe: 422 with the library message, then PRG success', async ({ request }) => {
    const failure = await request.post('/subscribe', { form: { email: 'nope' } });
    expect(failure.status()).toBe(422);
    expect(await failure.text()).toContain('a valid email is required');

    const success = await request.post('/subscribe', {
      form: { email: 'grace@example.com' },
      maxRedirects: 0,
    });
    expect(success.status()).toBe(303);
    expect(success.headers()['location']).toBe('/subscribe?welcome=grace%40example.com');
  });
});

test.describe('protocol hardening (ADR-0121, 0.42.0-alpha.5)', () => {
  test('prototype keys are not actions: ?/constructor is a defined 404 (#542)', async ({ request }) => {
    const response = await request.post('/form?/constructor', { form: { message: 'x' } });
    expect(response.status()).toBe(404);
    const toString = await request.post('/form?/toString', { form: { message: 'x' } });
    expect(toString.status()).toBe(404);
  });

  test('fetch callers receive an RFC 9457 problem+json 404 for unknown named actions (#549, #863)', async ({ request }) => {
    const response = await request.post('/form?/nope', {
      form: { message: 'x' },
      headers: { 'x-openelement-action': 'true' },
    });
    expect(response.status()).toBe(404);
    // #863: the action error channel speaks RFC 9457 problem+json.
    expect(response.headers()['content-type']).toContain('application/problem+json');
    expect(await response.json()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'No action named "nope" on this route.',
    });
  });

  test('fetch callers receive an RFC 9457 problem+json 404 for action-less routes (#549, #863)', async ({ request }) => {
    const response = await request.post('/live', {
      form: { x: '1' },
      headers: { 'x-openelement-action': 'true' },
    });
    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('application/problem+json');
    expect(await response.json()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'This route does not accept submissions.',
    });
  });

  test('the default PRG strips the action marker and keeps other query params (#548)', async ({ request }) => {
    const response = await request.post('/ping?/ping&keep=1', {
      form: { intent: 'ping' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('/ping?keep=1');
  });

  test('a 307 redirect from an action is coerced to 303 (#547)', async ({ request }) => {
    const response = await request.post('/ping?/mv307', {
      form: {},
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('/ping?moved=1');
  });

  test('an action returning a Response is a contract violation, never a response (#541)', async ({ request }) => {
    const response = await request.post('/ping?/raw', { form: {} });
    expect(response.status()).toBe(500);
    expect(await response.text()).not.toContain('<h1>raw</h1>');

    const fetchResponse = await request.post('/ping?/raw', {
      form: {},
      headers: { 'x-openelement-action': 'true' },
    });
    expect(fetchResponse.status()).toBe(500);
    expect(fetchResponse.headers()['content-type']).toContain('application/problem+json');
    const body = await fetchResponse.json();
    expect(body.type).toBe('about:blank');
    expect(body.status).toBe(500);
  });

  test('request-time GET 200s are revalidatable (private, no-cache); POST channels stay no-store and vary on the action header (#550)', async ({ request }) => {
    const get = await request.get('/live?x=cache');
    // #943: GET 200s are revalidatable (private, no-cache) for bfcache/scroll
    // restore; no-store is reserved for the POST/error channels below.
    expect(get.headers()['cache-control']).toBe('private, no-cache');

    const post = await request.post('/form', { form: { message: '' } });
    expect(post.status()).toBe(422);
    expect(post.headers()['cache-control']).toBe('no-store');
    expect(post.headers()['vary']).toContain('x-openelement-action');

    const redirect = await request.post('/form', {
      form: { message: 'cache-check' },
      maxRedirects: 0,
    });
    expect(redirect.status()).toBe(303);
    expect(redirect.headers()['cache-control']).toBe('no-store');
  });

  test('non-GET/POST methods are a defined 405 with Allow (#572)', async ({ request }) => {
    const response = await request.put('/form', { data: 'x=1' });
    expect(response.status()).toBe(405);
    expect(response.headers()['allow']).toBe('GET, HEAD, POST');
  });

  test('POST takes the same error-boundary channel as GET (#551)', async ({ request }) => {
    const get = await request.get('/boom');
    expect(get.status()).toBe(500);
    expect(await get.text()).toContain('boom boundary: boom-loader');

    const post = await request.post('/boom', { form: {} });
    expect(post.status()).toBe(500);
    expect(await post.text()).toContain('boom boundary: boom-loader');
  });

  test('the production JSON error channel scrubs internals (#558)', async ({ request }) => {
    const response = await request.post('/boom?/explode', {
      form: {},
      headers: { 'x-openelement-action': 'true' },
    });
    expect(response.status()).toBe(500);
    expect(response.headers()['content-type']).toContain('application/problem+json');
    const body = await response.json();
    expect(body.type).toBe('about:blank');
    expect(body.title).toBe('Internal Server Error');
    // The fixture is a production build: internals never leak.
    expect(body.detail).toBe('Internal Server Error');
  });

  test('a thrown action renders the error boundary on the HTML channel (#551)', async ({ request }) => {
    const response = await request.post('/boom?/explode', { form: {} });
    expect(response.status()).toBe(500);
    expect(await response.text()).toContain('boom boundary: boom-action');
  });

  test('the 422 echo escapes markup (#573)', async ({ request }) => {
    const payload = '"><img src=x onerror=alert(1)>';
    const response = await request.post('/register', { form: { email: payload } });
    expect(response.status()).toBe(422);
    const html = await response.text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

test.describe('morph continuity hardening (ADR-0121, 0.42.0-alpha.5)', () => {
  test('region-scoped morph updates only the region and keeps outside islands (#553)', async ({ page }) => {
    await page.goto('/regions');
    const count = page.locator('live-counter #count');
    await page.locator('live-counter #increment').click();
    await page.locator('live-counter #increment').click();
    await expect(count).toHaveText('2');

    await page.click('#submit');
    await expect(page.locator('#error')).toHaveText('message is required');
    // The island is outside the morphed region: untouched by construction.
    await expect(count).toHaveText('2');
    // The banner region was not targeted and is left alone.
    await expect(page.locator('#banner')).toHaveText('echo=');
  });

  test('data-open-preserve exempts a subtree inside the morphed region', async ({ page }) => {
    await page.goto('/regions');
    const details = page.locator('#preserved-details');
    await page.locator('#preserved-details summary').click();
    await expect(details).toHaveAttribute('open', /.*/);

    await page.click('#submit');
    await expect(page.locator('#error')).toHaveText('message is required');
    await expect(details).toHaveAttribute('open', /.*/);
  });

  test('a missing region target falls back to a full navigation (#553)', async ({ page }) => {
    await page.goto('/regions');
    await page.evaluate(() => {
      (window as unknown as { __stillHere: number }).__stillHere = 1;
    });
    await page.click('#missing');
    // Navigation wipes the JS context; a morph would have kept it.
    await page.waitForFunction(() =>
      (window as never as { __stillHere?: number }).__stillHere === undefined
    );
    await expect(page.locator('#banner')).toHaveText('echo=');
  });

  test('back after an enhanced PRG reloads the restored URL (#545)', async ({ page }) => {
    await page.goto('/form');
    await page.fill('#message', 'history-check');
    await page.click('#submit');
    await page.waitForURL('**/form?echoed=history-check');
    await expect(page.locator('#echo')).toHaveText('echo=history-check');

    await page.goBack();
    await page.waitForURL('**/form');
    // The popstate handler reloads, so the restored URL shows fresh content.
    await expect(page.locator('#echo')).toHaveText('echo=');
  });

  test('open:action-failure is cancelable and skips the default morph (#546)', async ({ page }) => {
    await page.goto('/form');
    await page.evaluate(() => {
      const form = document.querySelector('form-page')!.shadowRoot!.querySelector('form')!;
      form.addEventListener('open:action-failure', (event) => {
        (window as unknown as { __failureStatus: number }).__failureStatus =
          (event as CustomEvent).detail.status;
        event.preventDefault();
      });
    });
    await page.click('#submit');
    await page.waitForFunction(() =>
      (window as never as { __failureStatus?: number }).__failureStatus === 422
    );
    // preventDefault skipped the morph: the error paragraph never appeared.
    await expect(page.locator('#error')).toHaveCount(0);
  });

  test('a 500 response navigates instead of morphing the error page (#552)', async ({ page }) => {
    await page.goto('/boom');
    await expect(page.locator('#boundary')).toContainText('boom boundary');
    await page.evaluate(() => {
      (window as unknown as { __stillHere: number }).__stillHere = 1;
    });
    await page.click('#boom-submit');
    await page.waitForFunction(() =>
      (window as never as { __stillHere?: number }).__stillHere === undefined
    );
    await expect(page.locator('#boundary')).toContainText('boom boundary');
  });

  test('the URL fragment survives a 422 morph (#565)', async ({ page }) => {
    await page.goto('/form#top');
    await page.click('#submit');
    await expect(page.locator('#error')).toHaveText('message is required');
    expect(page.url()).toContain('#top');
  });

  test('the enhanced submit includes the submitter name/value in the body (#544)', async ({ page }) => {
    await page.goto('/ping');
    const post = page.waitForResponse((r) =>
      r.request().method() === 'POST' && r.url().includes('/ping')
    );
    await page.click('#ping');
    const response = await post;
    // The named submit button travels in the enhanced body: without it the
    // action 422s with 'intent missing'; with it the action succeeds (303).
    expect(response.status()).toBe(303);
    await expect(page.locator('#intent-error')).toHaveCount(0);
  });

  test('island state survives a list prepend (#554; positional morph in v0.44)', async ({ page }) => {
    await page.goto('/items');
    // v0.44 grammar note: the compiled each-Region item template carries one
    // {item.<field>} text slot and no per-item attribute slots, so rows can
    // no longer emit id attributes (li#row-a). The morph client aligns the
    // list positionally; the assertions below pin island state SURVIVAL and
    // fresh-row hydration instead of id-keyed identity.
    const rowA = page.locator('ul > li', { has: page.getByText('a', { exact: true }) });
    await rowA.locator('live-counter #increment').click();
    await rowA.locator('live-counter #increment').click();
    await expect(rowA.locator('live-counter #count')).toHaveText('2');

    await page.click('#prepend');
    await page.waitForURL('**/items?items=new*');
    // The prepend morphs the list in place: all three rows exist, the
    // pre-existing island subtrees survive (state intact), and the fresh row
    // hydrates from the server render.
    await expect(page.locator('ul > li')).toHaveCount(3);
    await expect(page.locator('ul > li').first().locator('span.row-label')).toHaveText('new');
    const counts = await page.locator('live-counter #count').allTextContents();
    expect(counts).toEqual(['2', '0', '0']);
  });
});

test.describe('param routes and the generated matcher (#556)', () => {
  test('GET /item/42 renders params.id per request', async ({ request }) => {
    const response = await request.get('/item/42');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('id=42');
  });

  test('different param values render different pages', async ({ request }) => {
    const first = await (await request.get('/item/42')).text();
    const second = await (await request.get('/item/7')).text();
    expect(first).toContain('id=42');
    expect(second).toContain('id=7');
    expect(second).not.toContain('id=42');
  });

  test('a pathname outside the route table stays on the static/404 path', async ({ request }) => {
    const response = await request.get('/item');
    expect(response.status()).toBe(404);
  });

  test('POST /item/42 with an empty note is a 422 re-render', async ({ request }) => {
    const response = await request.post('/item/42', { form: { note: '  ' } });
    expect(response.status()).toBe(422);
    const html = await response.text();
    expect(html).toContain('note is required');
    expect(html).toContain('id=42');
  });

  test('POST /item/42 with a valid note is a 303 PRG to the same item', async ({ request }) => {
    const response = await request.post('/item/42', {
      form: { note: 'hello-item' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('/item/42?noted=hello-item');
  });
});

test.describe('round-2 morph client fixes (0.42.0-alpha.6)', () => {
  test('an explicit form action wins over the page URL (#576)', async ({ page }) => {
    await page.goto('/ping');
    const post = page.waitForResponse((r) =>
      r.request().method() === 'POST' && r.url().includes('/form')
    );
    await page.click('#to-form');
    const response = await post;
    expect(response.status()).toBe(422);
    // The enhanced POST hit /form (its 422 page), not /ping.
    await expect(page.locator('#error')).toHaveText('message is required');
  });

  test('back after a reload following an enhanced submit reloads again (#578)', async ({ page }) => {
    await page.goto('/form');
    await page.fill('#message', 'nav-guard');
    await page.click('#submit');
    await page.waitForURL('**/form?echoed=nav-guard');
    await expect(page.locator('#echo')).toHaveText('echo=nav-guard');
    await page.reload();
    // History shape after a reload differs across engines (Firefox grows an
    // extra entry); walk back until the pre-submit URL is reached.
    for (let i = 0; i < 3 && !page.url().endsWith('/form'); i++) await page.goBack();
    // The invariant §10 promises: displayed content always matches the URL.
    // With a memory-only guard (pre-fix) a bfcache/persisted restore shows
    // the morphed page at the pre-submit URL — stale.
    if (page.url().endsWith('/form')) {
      await expect(page.locator('#echo')).toHaveText('echo=');
    } else {
      await expect(page.locator('#echo')).toHaveText('echo=nav-guard');
    }
  });

  test('a morphed-in island instance shows the server render and hydrates (#579)', async ({ page }) => {
    await page.goto('/items');
    await page.click('#prepend');
    await page.waitForURL('**/items?items=new*');
    // v0.44 positional morph: the prepended row reuses the first row's
    // position, so the freshly inserted island lives in the LAST row. Its
    // #count shows the server's render ('0'), not a blank client-initial
    // span — the island then hydrates and increments.
    const inserted = page.locator('ul > li').nth(2);
    const count = inserted.locator('live-counter #count');
    await expect(count).toHaveText('0');
    await inserted.locator('live-counter #increment').click();
    await expect(count).toHaveText('1');
  });

  test('rows keep order and island state through a reverse (#580; positional morph in v0.44)', async ({ page }) => {
    await page.goto('/items');
    const rowA = page.locator('ul > li', { has: page.getByText('a', { exact: true }) });
    await rowA.locator('live-counter #increment').click();
    await rowA.locator('live-counter #increment').click();
    await expect(rowA.locator('live-counter #count')).toHaveText('2');

    await page.click('#reverse');
    await page.waitForURL('**/items?items=b*');
    // Order flips and both islands survive with their state intact.
    await expect(page.locator('ul > li').first().locator('span.row-label')).toHaveText('b');
    const counts = await page.locator('live-counter #count').allTextContents();
    expect(counts).toEqual(['2', '0']);
  });

  test('a malformed form body is a defined 400 on both channels (#581)', async ({ request }) => {
    const html = await request.post('/form', {
      headers: { 'content-type': 'application/json' },
      data: '{"x":1}',
    });
    expect(html.status()).toBe(400);
    const json = await request.post('/form', {
      headers: { 'content-type': 'application/json', 'x-openelement-action': 'true' },
      data: '{"x":1}',
    });
    expect(json.status()).toBe(400);
    expect(json.headers()['content-type']).toContain('application/problem+json');
    const problem = await json.json();
    expect(problem.type).toBe('about:blank');
    expect(problem.title).toBe('Bad Request');
    expect(problem.status).toBe(400);
    expect(problem.detail).toBe('Could not parse the form body.');
  });

  test('405 carries no-store (#586)', async ({ request }) => {
    const response = await request.put('/form', { data: 'x=1' });
    expect(response.status()).toBe(405);
    expect(response.headers()['cache-control']).toBe('no-store');
  });

  test('an enhanced form inside an imported component enhances (#577)', async ({ page }) => {
    await page.goto('/shared');
    await page.evaluate(() => {
      (window as unknown as { __stillHere: number }).__stillHere = 1;
    });
    const post = page.waitForResponse((r) => r.request().method() === 'POST');
    await page.click('#shared-submit');
    await post;
    // Enhancement intercepted (fetch + morph): the JS context survives; a
    // native POST would have wiped it.
    expect(await page.evaluate(() => (window as never as { __stillHere?: number }).__stillHere))
      .toBe(1);
    await expect(page.locator('#error')).toHaveText('message is required');
  });
});

test.describe('morph/enhance robustness (0.42.0-alpha.13, #603-#606)', () => {
  test('a focused input keeps focus across a 422 morph (#603)', async ({ page }) => {
    await page.goto('/form');
    await page.locator('#message').click();
    // Enter submits implicitly WITHOUT moving focus to a button.
    await page.keyboard.press('Enter');
    await expect(page.locator('#error')).toHaveText('message is required');
    const activeId = await page.evaluate(() => {
      let active = document.activeElement;
      while (active && active.shadowRoot && active.shadowRoot.activeElement) {
        active = active.shadowRoot.activeElement;
      }
      return active ? active.id : null;
    });
    expect(activeId).toBe('message');
  });

  test('focus is restored by id when the focused control is replaced (#603)', async ({ page, request }) => {
    const html = await (await request.get('/form')).text();
    // The server "re-renders" the message field as a textarea (same id): the
    // morph must replace the input, then refocus the successor by id.
    const swapped = html.replace(
      '<input id="message" name="message" type="text" value="">',
      '<textarea id="message" name="message">draft</textarea>',
    );
    expect(swapped).not.toBe(html);
    await page.route('**/form**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({ status: 200, contentType: 'text/html', body: swapped });
    });
    await page.goto('/form');
    await page.locator('#message').click();
    await page.keyboard.type('draft');
    await page.keyboard.press('Enter');
    // The morph replaced the input with the textarea (async fetch round trip).
    await expect(page.locator('textarea#message')).toBeAttached();
    // Focus followed the id to the replacement control.
    const active = await page.evaluate(() => {
      let el = document.activeElement;
      while (el && el.shadowRoot && el.shadowRoot.activeElement) {
        el = el.shadowRoot.activeElement;
      }
      return el ? { id: el.id, tag: el.tagName } : null;
    });
    expect(active).toEqual({ id: 'message', tag: 'TEXTAREA' });
    // The text selection (caret at end of 'draft') was restored too.
    const caret = await page.evaluate(() => {
      const el = document.querySelector('form-page')!.shadowRoot!.querySelector(
        '#message',
      ) as HTMLTextAreaElement;
      return el.selectionStart;
    });
    expect(caret).toBe(5);
  });

  test('user-touched form controls keep their live state across a morph (#603)', async ({ page, request }) => {
    const html = await (await request.get('/form')).text();
    // Live page (injected below): checkbox WITHOUT checked, server-set with
    // value v1. Server response: checkbox WITH checked (it echoed the form
    // data), server-set bumped to v2, message re-rendered with an echo value.
    // The compiled serializer emits boolean-ish marker attributes quoted
    // (data-open-enhance=""), so the interception needle carries the quote
    // form; the morph behavior under assertion is unchanged.
    let intercepted = html.replace(
      '<form method="post" data-open-enhance="">',
      '<form method="post" data-open-enhance=""><input type="checkbox" id="agree" name="agree" checked><input id="server-set" name="server-set" type="text" value="from-server-v2">',
    );
    expect(intercepted).not.toBe(html);
    intercepted = intercepted.replace(
      '<input id="message" name="message" type="text" value="">',
      '<input id="message" name="message" type="text" value="server-echo">',
    );
    await page.route('**/form**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({ status: 200, contentType: 'text/html', body: intercepted });
    });
    await page.goto('/form');
    await page.evaluate(() => {
      const form = document.querySelector('form-page')!.shadowRoot!.querySelector('form')!;
      form.insertAdjacentHTML(
        'afterbegin',
        '<input type="checkbox" id="agree" name="agree"><input id="server-set" name="server-set" type="text" value="from-server-v1">',
      );
    });
    // Touch: check the box, type into #message; leave #server-set untouched.
    await page.locator('#agree').check();
    await page.locator('#message').fill('draft');
    await page.keyboard.press('Enter');
    // Wait for the morph to land (server-set follows the server: untouched).
    await expect(page.locator('#server-set')).toHaveValue('from-server-v2');
    const state = await page.evaluate(() => {
      const root = document.querySelector('form-page')!.shadowRoot!;
      const agree = root.querySelector('#agree') as HTMLInputElement;
      const message = root.querySelector('#message') as HTMLInputElement;
      const serverSet = root.querySelector('#server-set') as HTMLInputElement;
      return {
        agreeChecked: agree.checked,
        agreeHasAttr: agree.hasAttribute('checked'),
        messageValue: message.value,
        messageAttr: message.getAttribute('value'),
        serverSetAttr: serverSet.getAttribute('value'),
      };
    });
    // Touched controls: live property wins, the attribute is left alone.
    expect(state.agreeChecked).toBe(true);
    expect(state.agreeHasAttr).toBe(false);
    expect(state.messageValue).toBe('draft');
    expect(state.messageAttr).toBe('');
    // Untouched control: the server render wins (attribute AND property).
    expect(state.serverSetAttr).toBe('from-server-v2');
  });

  test('window scroll position survives an enhanced morph (#603)', async ({ page, request }) => {
    // The tall-page style must live on BOTH sides of the morph (the morph
    // syncs attributes away otherwise), so the response is intercepted and
    // carries the same <style> the live page gets injected below.
    const html = await (await request.get('/form')).text();
    const tallStyle = '<style>main{min-height:5000px}</style>';
    const intercepted = html.replace('<main>', '<main>' + tallStyle + '<p id="morph-landed">m</p>');
    expect(intercepted).not.toBe(html);
    await page.route('**/form**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({ status: 200, contentType: 'text/html', body: intercepted });
    });
    await page.goto('/form');
    // Wait for island hydration to settle (a late CSR re-render would drop
    // the injected style node and clamp the scroll mid-test).
    await page.locator('live-counter #increment').click();
    await expect(page.locator('live-counter #count')).toHaveText('1');
    await page.evaluate(() => {
      const main = document.querySelector('form-page')!.shadowRoot!.querySelector('main')!;
      main.insertAdjacentHTML('afterbegin', '<style>main{min-height:5000px}</style>');
      globalThis.scrollTo(0, 800);
    });
    expect(Math.abs((await page.evaluate(() => globalThis.scrollY)) - 800)).toBeLessThan(2);
    // requestSubmit, not click: any pointer/keyboard interaction auto-scrolls
    // the submit button (top of the page) into view and ruins the setup.
    await page.evaluate(() => {
      const form = document.querySelector('form-page')!.shadowRoot!.querySelector('form')!;
      form.requestSubmit();
    });
    await expect(page.locator('#morph-landed')).toBeAttached();
    // Firefox reports fractional scroll positions (devicePixelRatio rounding).
    expect(Math.abs((await page.evaluate(() => globalThis.scrollY)) - 800)).toBeLessThan(2);
  });

  test('a morph instantiates nested DSD templates recursively (#604)', async ({ page, request }) => {
    const html = await (await request.get('/form')).text();
    // Island-in-island: an outer DSD host whose shadow content carries a
    // live-counter with its own DSD template (the island's real markup, so
    // post-instantiation hydration aligns). The inner template is invisible
    // to querySelectorAll; without recursion it stays inert.
    const islandMatch = html.match(/<live-counter>[\s\S]*?<\/live-counter>/);
    expect(islandMatch).toBeTruthy();
    const nested = '<nested-host><template shadowrootmode="open"><p id="outer-marker">outer</p>' +
      islandMatch![0] +
      '</template></nested-host>';
    const intercepted = html.replace('<live-counter>', nested + '<live-counter>');
    expect(intercepted).not.toBe(html);
    await page.route('**/form**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({ status: 200, contentType: 'text/html', body: intercepted });
    });
    await page.goto('/form');
    await page.click('#submit');
    await expect(page.locator('#outer-marker')).toHaveText('outer');
    const innerState = await page.evaluate(() => {
      const outer = document.querySelector('form-page')!.shadowRoot!.querySelector('nested-host')!;
      const inner = outer.shadowRoot!.querySelector('live-counter')!;
      return {
        outerShadow: !!outer.shadowRoot,
        innerShadow: !!inner.shadowRoot,
        inertTemplate: !!inner.querySelector('template[shadowrootmode]'),
      };
    });
    // The inner template was consumed by recursive instantiation (it would
    // sit inert in the light DOM without #604), and the island hydrated the
    // server-instantiated shadow root.
    expect(innerState).toEqual({ outerShadow: true, innerShadow: true, inertTemplate: false });
    const nestedCounter = page.locator('nested-host live-counter');
    await nestedCounter.locator('#increment').click();
    await expect(nestedCounter.locator('#count')).toHaveText('1');
  });

  test('open:ready fires for the load strategy bucket (#605)', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __ready: string[] }).__ready = [];
      document.addEventListener('open:ready', (event) => {
        (window as unknown as { __ready: string[] }).__ready.push(
          (event as CustomEvent).detail.strategy,
        );
      });
    });
    await page.goto('/form');
    await expect(page.locator('live-counter #increment')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as never as { __ready: string[] }).__ready))
      .toContain('load');
  });

  test('client:visible island inside page DSD loads on intersection (#606)', async ({ page }) => {
    // The REAL scheduler module, inlined exactly the way generateClientEntry
    // inlines it, drives this handcrafted page — no fixture rebuild needed.
    const schedulerSource = createIslandScheduler.toString();
    let islandFetches = 0;
    await page.route('**/virtual-entry.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `var __scheduler = (${schedulerSource})({
  log: { warn: function () {} },
  win: window,
  doc: document,
  map: { 'x-vis': function () { return import('/virtual-island.js'); } },
  strategies: { load: [], idle: [], visible: ['x-vis'], only: [] },
  onIslandLoaded: null,
});`,
      }));
    await page.route('**/virtual-island.js', (route) => {
      islandFetches++;
      return route.fulfill({
        contentType: 'text/javascript',
        body: `customElements.define('x-vis', class extends HTMLElement {
  connectedCallback() { this.setAttribute('data-hydrated', '1'); }
});`,
      });
    });
    await page.route('**/sandbox', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body>
<x-page><template shadowrootmode="open">
  <div style="height:5000px">spacer</div>
  <x-vis></x-vis>
</template></x-page>
<script>window.__ready = []; document.addEventListener('open:ready', function (e) { window.__ready.push(e.detail.strategy); });</script>
<script type="module" src="/virtual-entry.js"></script>
</body></html>`,
      }));
    await page.goto('/sandbox');
    // The island lives inside the page host's DSD shadow root — a light-DOM
    // querySelectorAll (the removed defineIsland path) never found it.
    await expect(page.locator('x-vis')).toBeAttached();
    expect(islandFetches).toBe(0);
    await page.evaluate(() => globalThis.scrollTo(0, 5000));
    await expect.poll(() => islandFetches).toBe(1);
    await expect(page.locator('x-vis')).toHaveAttribute('data-hydrated', '1');
    await expect
      .poll(() => page.evaluate(() => (window as never as { __ready: string[] }).__ready))
      .toContain('visible');
  });
});
