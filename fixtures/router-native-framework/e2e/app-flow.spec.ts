/**
 * App-flow-native E2E (Beta.2.2 #1339): the complete Native Framework Mode
 * application flow acceptance matrix, run in Chromium, Firefox and WebKit
 * against the built fixture (one shared server per run).
 *
 * The store is shared mutable server state and the three browser projects run
 * sequentially against it, so every stateful assertion is RELATIVE: counts are
 * captured before the action and compared after. On a fresh server the numbers
 * are exactly the seed values (2 notes, action count 0); later projects observe
 * higher baselines — the deltas are the contract.
 *
 * notFound channel note: a loader-thrown notFound() answers 404 with the
 * author's message on the framework status page (#922, pinned by the
 * request-time parity suite); the custom styled 404 page is the unmatched-path
 * channel (#923) and is proven separately against /no-such-page.
 */
import { type APIRequestContext, expect, test } from '@playwright/test';

/** Current store action-invocation counter, read off a dynamic page's header. */
async function actionCount(request: APIRequestContext): Promise<number> {
  const response = await request.get('/notes');
  expect(response.ok()).toBe(true);
  const value = response.headers()['x-action-count'];
  expect(value).toBeTruthy();
  return Number(value);
}

/** Number of note rows in a fresh SSR render of /notes (no browser state). */
async function noteRowCount(request: APIRequestContext): Promise<number> {
  const response = await request.get('/notes');
  expect(response.ok()).toBe(true);
  const html = await response.text();
  return (html.match(/<li><a href="\/notes\/[^"]+">/g) ?? []).length;
}

test.describe('SSR and native claim', () => {
  test('JS disabled: /notes is a full-document SSR render of both seed notes', async ({ browser, request }) => {
    // The wire format: the page host carries a DSD template with both rows and
    // the island's own DSD subtree — no client JS is needed to render.
    const html = await (await request.get('/notes')).text();
    expect(html).toContain('<notes-index><template shadowrootmode="open">');
    expect(html).toContain('Seed note one');
    expect(html).toContain('Seed note two');
    expect(html).toContain('<note-counter><template shadowrootmode="open">');

    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/notes');
    await expect(page.getByText('Seed note one', { exact: true })).toBeVisible();
    await expect(page.getByText('Seed note two', { exact: true })).toBeVisible();
    // The island's SSR render is visible without JS too (native DSD).
    await expect(page.locator('note-counter #count')).toHaveText('0');
    await context.close();
  });

  test('JS on: each note renders exactly once and the island activates in place', async ({ page }) => {
    await page.goto('/notes');
    // No duplicated SSR+CSR render: exactly one occurrence per seed note.
    await expect(page.getByText('Seed note one', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Seed note two', { exact: true })).toHaveCount(1);

    // The island shows the server render ('0'), then activates: clicks patch
    // the existing DSD nodes in place.
    const button = page.locator('note-counter #increment');
    const count = page.locator('note-counter #count');
    await expect(count).toHaveText('0');
    const ssrCount = await count.elementHandle();
    await button.click();
    await expect(count).toHaveText('1');
    await button.click();
    await expect(count).toHaveText('2');
    const activeCount = await count.elementHandle();
    expect(await ssrCount!.evaluate((node, candidate) => node === candidate, activeCount)).toBe(
      true,
    );
  });
});

test.describe('create flow (JS on)', () => {
  test(
    '422 re-render, then PRG success with the created flash',
    async ({ page, request }, info) => {
      const countBefore = await actionCount(request);
      const rowsBefore = await noteRowCount(request);
      const title = `Valid title ${info.project.name}`;

      await page.goto('/notes/new');
      // --- invalid: server-side validation after a native-valid submission ---
      const failedPost = page.waitForResponse((r) =>
        r.request().method() === 'POST' && r.url().includes('/notes/new')
      );
      await page.fill('#title', 'ab');
      await page.click('#submit');
      const failure = await failedPost;
      expect(failure.status()).toBe(422);
      // Exactly one action ran for this submission.
      expect(Number(failure.headers()['x-action-count'])).toBe(countBefore + 1);

      // Still on /notes/new; the error is morphed in and the title echo survives.
      await expect(page).toHaveURL(/\/notes\/new$/);
      await expect(page.locator('#error')).toHaveText('title must be at least 3 characters');
      await expect(page.locator('#title')).toHaveValue('ab');
      // The submitter reached the action even on the failure path.
      await expect(page.locator('#last-intent')).toHaveText('intent=create');

      // The store is unchanged: a fresh request still lists the old rows.
      expect(await noteRowCount(request)).toBe(rowsBefore);

      // --- valid: PRG to the detail page with the created flash ---
      const createdPost = page.waitForResponse((r) =>
        r.request().method() === 'POST' && r.url().includes('/notes/new')
      );
      await page.fill('#title', title);
      await page.fill('#body', 'Created through the enhanced path.');
      await page.click('#submit');
      const created = await createdPost;
      expect(created.status()).toBe(303);
      expect(created.headers()['location']).toMatch(/^\/notes\/note-\d+\?created=1$/);
      // The 303 carries x-action-count (proven at the HTTP layer in the error/
      // not-found suite) — WebKit does not surface custom headers of fetch
      // redirect-chain responses to Playwright, so the counter delta is asserted
      // through a fresh request instead.
      expect(await actionCount(request)).toBe(countBefore + 2);

      await page.waitForURL(/\/notes\/note-\d+\?created=1$/);
      await expect(page.locator('#note-title')).toHaveText(title);
      await expect(page.locator('#flash-created')).toHaveText('created=1');

      // The list now shows one more row, and the detail loader reports it.
      expect(await noteRowCount(request)).toBe(rowsBefore + 1);
      const detail = await request.get(created.headers()['location']!);
      expect(Number(detail.headers()['x-note-count'])).toBe(rowsBefore + 1);
    },
  );
});

test.describe('native validation ordering (JS on)', () => {
  test('an empty required title blocks the submit before any request fires', async ({ page, request }) => {
    const countBefore = await actionCount(request);
    const posts: string[] = [];
    await page.goto('/notes/new');
    page.on('request', (r) => {
      if (r.method() === 'POST') posts.push(r.url());
    });

    await page.fill('#title', 'to be cleared');
    await page.fill('#title', '');
    await page.click('#submit');
    // Constraint validation focuses the first invalid control — deterministic
    // proof the browser (not the action) rejected the submission. The input
    // lives in the page's shadow root, so walk the deep active element.
    await expect
      .poll(() =>
        page.evaluate(() => {
          let active = document.activeElement;
          while (active && active.shadowRoot && active.shadowRoot.activeElement) {
            active = active.shadowRoot.activeElement;
          }
          return active ? active.id : null;
        })
      )
      .toBe('title');
    const valueMissing = await page.locator('#title').evaluate(
      (el) => (el as HTMLInputElement).validity.valueMissing,
    );
    expect(valueMissing).toBe(true);

    expect(posts).toEqual([]);
    expect(await actionCount(request)).toBe(countBefore);
    await expect(page).toHaveURL(/\/notes\/new$/);
  });
});

test.describe('back/forward after an enhanced submit', () => {
  test('Back reloads /notes/new, Forward reloads the detail page', async ({ page }, info) => {
    const title = `History note ${info.project.name}`;
    await page.goto('/notes/new');
    await page.fill('#title', title);
    await page.fill('#body', 'Created for the history walk.');
    await page.click('#submit');
    await page.waitForURL(/\/notes\/note-\d+\?created=1$/);
    await expect(page.locator('#note-title')).toHaveText(title);

    // Back returns to the pre-submit URL; the popstate guard reloads so the
    // displayed content always matches the address bar (ADR-0121 §10). The
    // window marker proves the reload completed (fresh JS context) before the
    // next history step — without it a same-tick goForward races the
    // in-flight reload in Firefox and is coalesced away (#578 shape).
    await page.evaluate(() => {
      (window as unknown as { __preBack: number }).__preBack = 1;
    });
    await page.goBack();
    await page.waitForURL(/\/notes\/new$/);
    await page.waitForFunction(() =>
      (window as never as { __preBack?: number }).__preBack === undefined
    );
    await expect(page.locator('h1')).toHaveText('new note');
    await expect(page.locator('#error')).toHaveCount(0);

    await page.evaluate(() => {
      (window as unknown as { __preForward: number }).__preForward = 1;
    });
    await page.goForward();
    await page.waitForURL(/\/notes\/note-\d+\?created=1$/);
    await page.waitForFunction(() =>
      (window as never as { __preForward?: number }).__preForward === undefined
    );
    await expect(page.locator('#note-title')).toHaveText(title);
    await expect(page.locator('#flash-created')).toHaveText('created=1');
  });
});

test.describe('JS-disabled native POST matrix', () => {
  test('invalid create is a native 422 re-render; valid create is a 303 PRG', async ({
    browser,
    request,
  }, info) => {
    const rowsBefore = await noteRowCount(request);
    const countBefore = await actionCount(request);
    const title = `No-JS note ${info.project.name}`;

    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    // --- invalid: the native POST re-renders with 422, error visible ---
    await page.goto('/notes/new');
    await page.fill('#title', 'ab');
    await page.click('#submit');
    await expect(page).toHaveURL(/\/notes\/new$/);
    await expect(page.locator('#error')).toHaveText('title must be at least 3 characters');
    await expect(page.locator('#title')).toHaveValue('ab');
    expect(await actionCount(request)).toBe(countBefore + 1);
    expect(await noteRowCount(request)).toBe(rowsBefore);

    // --- valid: native POST -> 303 -> detail page with the flash ---
    await page.goto('/notes/new');
    await page.fill('#title', title);
    await page.fill('#body', 'Created without JavaScript.');
    await page.click('#submit');
    await page.waitForURL(/\/notes\/note-\d+\?created=1$/);
    await expect(page.locator('#note-title')).toHaveText(title);
    await expect(page.locator('#flash-created')).toHaveText('created=1');
    // The mutation happened exactly once for this submission.
    expect(await actionCount(request)).toBe(countBefore + 2);
    expect(await noteRowCount(request)).toBe(rowsBefore + 1);
    // The submitter value reached the action on the native path too.
    await expect(page.locator('#last-intent')).toHaveText('intent=create');

    await context.close();
  });
});

test.describe('SSG/request-time separation', () => {
  test('the static home page keeps the build-time count after runtime mutations', async ({ page, request }) => {
    // The store has been mutated by earlier tests in this project run; the
    // prerendered artifact still carries the seed count captured at build time.
    const html = await (await request.get('/')).text();
    expect(html).toContain('build-count=2');
    expect(html).toContain('<title>app-flow-native fixture — home</title>');

    const rowsNow = await noteRowCount(request);
    await page.goto('/');
    await expect(page.locator('#build-count')).toHaveText('build-count=2');
    await expect(page).toHaveTitle('app-flow-native fixture — home');

    // The dynamic list reflects the current runtime store instead.
    await page.goto('/notes');
    await expect(page.locator('#note-count')).toHaveText(`note-count=${rowsNow}`);
    await expect(page.locator('ul > li')).toHaveCount(rowsNow);
  });
});

test.describe('error and not-found channels', () => {
  test('/boom answers 500 with the page error variant', async ({ request }) => {
    const response = await request.get('/boom');
    expect(response.status()).toBe(500);
    expect(await response.text()).toContain('boom boundary: boom-loader');
  });

  test('an unknown note id is a loader-notFound 404 carrying the message', async ({ browser, request }) => {
    const response = await request.get('/notes/does-not-exist');
    expect(response.status()).toBe(404);
    expect(await response.text()).toContain('note not found: does-not-exist');

    // Same channel in a real browser (JS off: pure SSR status page).
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const pageResponse = await page.goto('/notes/does-not-exist');
    expect(pageResponse!.status()).toBe(404);
    await expect(page.getByText('note not found: does-not-exist')).toBeVisible();
    await context.close();
  });

  test('an unmatched path renders the custom styled 404 page with status 404', async ({ browser, request }) => {
    const response = await request.get('/no-such-page');
    expect(response.status()).toBe(404);
    expect(await response.text()).toContain('app-flow-native styled not found');

    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const pageResponse = await page.goto('/no-such-page');
    expect(pageResponse!.status()).toBe(404);
    await expect(page.locator('#styled-404')).toHaveText('app-flow-native styled not found');
    await context.close();
  });

  test('the detail page carries the x-note-count channel header', async ({ request }) => {
    const rowsNow = await noteRowCount(request);
    const response = await request.get('/notes/seed-1');
    expect(response.ok()).toBe(true);
    expect(Number(response.headers()['x-note-count'])).toBe(rowsNow);
    expect(response.headers()['x-action-count']).toBeTruthy();
  });

  test('the 303 PRG response carries the action-count channel header', async ({ request }) => {
    const before = await actionCount(request);
    const response = await request.post('/notes/new', {
      form: { title: 'HTTP-layer PRG proof', body: '', intent: 'create' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toMatch(/^\/notes\/note-\d+\?created=1$/);
    expect(Number(response.headers()['x-action-count'])).toBe(before + 1);
  });
});

test.describe('submitter name/value', () => {
  test('the named submitter reaches the action on the enhanced path', async ({ page }, info) => {
    await page.goto('/notes/new');
    const post = page.waitForResponse((r) =>
      r.request().method() === 'POST' && r.url().includes('/notes/new')
    );
    await page.fill('#title', `Submitter note ${info.project.name}`);
    await page.click('#submit');
    const response = await post;
    // The intent traveled in the enhanced body (#544): without it the action
    // would record an empty intent.
    expect(response.status()).toBe(303);
    await page.waitForURL(/\/notes\/note-\d+\?created=1$/);
    await expect(page.locator('#last-intent')).toHaveText('intent=create');
  });

  test(
    'the named submitter reaches the action on the JS-disabled path',
    async ({ browser }, info) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto('/notes/new');
      await page.fill('#title', `Native submitter note ${info.project.name}`);
      await page.click('#submit');
      await page.waitForURL(/\/notes\/note-\d+\?created=1$/);
      await expect(page.locator('#last-intent')).toHaveText('intent=create');
      await context.close();
    },
  );
});

// ─── Resolved Document (#1326) ─────────────────────────────────────────────
// One resolution policy drives page meaning before serialization: the detail
// route's head resolver reads loader data/params; the static home carries a
// build-time canonical; neither 404 channel emits a canonical.

test.describe('resolved document (#1326)', () => {
  test('detail head resolves from loader data: title, canonical, hreflang alternates', async ({ request }) => {
    const response = await request.get('/notes/seed-1');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('<title>app-flow-native fixture — Seed note one</title>');
    expect(html).toContain(
      '<link rel="canonical" href="https://fixture.example.test/notes/seed-1">',
    );
    expect(html).toContain(
      '<link rel="alternate" href="https://fixture.example.test/notes/seed-1" hreflang="en">',
    );
    expect(html).toContain(
      '<link rel="alternate" href="https://fixture.example.test/zh/notes/seed-1" hreflang="zh">',
    );
  });

  test('the static home page carries its build-time canonical', async ({ request }) => {
    const response = await request.get('/');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('<link rel="canonical" href="https://fixture.example.test/">');
  });

  test('neither 404 channel emits a canonical link', async ({ request }) => {
    const loaderMiss = await request.get('/notes/does-not-exist');
    expect(loaderMiss.status()).toBe(404);
    expect(await loaderMiss.text()).not.toContain('rel="canonical"');
    const unmatched = await request.get('/definitely-not-a-route');
    expect(unmatched.status()).toBe(404);
    expect(await unmatched.text()).not.toContain('rel="canonical"');
  });

  test('the resolved head is deterministic across identical requests', async ({ request }) => {
    const headOf = (html: string) => html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    const first = headOf(await (await request.get('/notes/seed-1')).text());
    const second = headOf(await (await request.get('/notes/seed-1')).text());
    expect(second).toBe(first);
  });
});
