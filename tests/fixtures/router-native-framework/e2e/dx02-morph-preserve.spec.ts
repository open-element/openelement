/**
 * DX-02 browser automation — morph + preserve contracts on the native fixture.
 *
 * Existing coverage this file deliberately does NOT repeat:
 *   - `app-flow.spec.ts` pins the enhanced 422 re-render ("the error is morphed
 *     in and the title echo survives") and the PRG target rendering;
 *   - `enhance-guards.spec.ts` pins the interception guards (no-JS, target,
 *     cross-origin, GET, anchors) and, since FRM-07A, the `open:enhance-ready`
 *     readiness barrier before a click can observe an enhanced state;
 *   - `continuation-regression.spec.ts` pins the base-target fallback and the
 *     disposed-form late-response contracts on this native fixture.
 *
 * Gaps this file adds (alpha15 DX-02, review "automation ≠ screen-reader"
 * scope item):
 *   1. TIMING — an enhanced PRG submit morphs into the created page without a
 *      full reload, observed through event waits (response registered before the
 *      click, URL/DOM awaited) instead of fixed sleeps;
 *   2. PRESERVE — the `data-open-preserve` subtree exemption, with a positive
 *      control proving the same morph DOES update the same node when the
 *      attribute is absent (so the exemption assertion is not vacuous);
 *   3. PRESERVE — node identity, control state and focus survive the 422 morph
 *      (`data-open-preserve`, #603 control-state and focus-restore contracts in
 *      `morph-align.ts` / `morph-focus-restore.ts`).
 *
 * Automation is NOT screen-reader testing: these are DOM/behaviour assertions.
 * Screen-reader verification stays manual (see
 * `docs/release/evidence/alpha15/dx02-browser-automation.md`).
 */
import { expect, type Page, test } from '@playwright/test';

/**
 * Arm the enhance-readiness recorder BEFORE the first navigation (the
 * `open:enhance-ready` signal fires from the ready-time scan in
 * form-enhance.ts; a listener attached after `page.goto` resolves can miss it).
 */
async function armEnhanceReady(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener(
      'open:enhance-ready',
      () => {
        (window as unknown as { __enhanceReady?: boolean }).__enhanceReady = true;
      },
      { once: true },
    );
  });
}

/** Resolve only after the enhancement's ready-time scan: the interceptor is attached. */
async function waitForEnhanceReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as never as { __enhanceReady?: boolean }).__enhanceReady === true,
  );
}

/** Set a window marker that survives anything but a full page reload. */
async function markWindow(page: Page, name: string): Promise<void> {
  await page.evaluate((marker) => {
    (window as unknown as Record<string, number>)[marker] = 1;
  }, name);
}

/** The deep active element: focus lands inside open shadow roots (#603 helper shape). */
function deepActiveElementId(): string {
  let active: Element | null = document.activeElement;
  while (active && (active as HTMLElement).shadowRoot) {
    const deeper = (active as HTMLElement).shadowRoot?.activeElement;
    if (!deeper) break;
    active = deeper;
  }
  return active?.id ?? '';
}

test.describe('DX-02 morph timing: an enhanced PRG submit morphs in place', () => {
  test('a valid submit morphs into the created note without a full reload', async ({
    page,
  }, info) => {
    await armEnhanceReady(page);
    await page.goto('/notes/new');
    await waitForEnhanceReady(page);

    const title = 'DX02 morph ' + info.project.name;
    await markWindow(page, '__dx02Morph');
    await page.fill('#title', title);

    // Register the response wait BEFORE the click: a response that completed
    // before the listener exists would otherwise wait out the full timeout
    // (the same race FRM-07A removed from enhance-guards.spec.ts).
    const createdPost = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/notes/new'),
    );
    await page.click('#submit');
    const response = await createdPost;

    // The fetch channel carries the PRG status in the response (the browser's
    // fetch follows it; the enhancer consumes the followed HTML and morphs it
    // in place instead of navigating). Playwright's waitForResponse surfaces
    // the POST's own response, i.e. the 303 and its Location.
    expect(response.request().headers()['x-openelement-action']).toBe('enhance');
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toMatch(/^\/notes\/note-\d+\?created=1$/);
    await page.waitForURL(/\/notes\/note-\d+\?created=1$/);
    await expect(page.locator('#note-title')).toHaveText(title);
    // The morph is not a navigation: the JavaScript context (and therefore the
    // window marker) survives the URL change.
    expect(await page.evaluate(() => (window as never as Record<string, number>).__dx02Morph)).toBe(
      1,
    );
  });
});

test.describe('DX-02 preserve: data-open-preserve exempts a subtree', () => {
  test('the exempted subtree is untouched while the same morph updates its sibling', async ({
    page,
  }) => {
    await armEnhanceReady(page);
    await page.goto('/notes/new');
    await waitForEnhanceReady(page);

    // #last-intent exists in both the live and the re-rendered document (it is
    // selected by id inside the page element's shadow root — Playwright
    // locators pierce it, document.querySelector does not), so the morph
    // would normally sync it to the incoming "intent=create" echo. Exempt it
    // and stamp live-only state on it.
    const intentEcho = page.locator('#last-intent');
    await intentEcho.evaluate((target) => {
      target.setAttribute('data-open-preserve', '');
      target.setAttribute('data-dx02-live', 'preserved');
      target.textContent = 'live-only';
    });

    const invalidPost = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/notes/new'),
    );
    await page.fill('#title', 'ab'); // < 3 chars: the action answers 422
    await page.click('#submit');
    const response = await invalidPost;
    expect(response.status()).toBe(422);

    // The morph ran: the server's error block is inserted by the same morph
    // that must leave the exempted subtree alone.
    await expect(page.locator('#error')).toHaveText('title must be at least 3 characters');

    // The exemption holds for both the subtree text and the live-only
    // attribute; the incoming document carries neither of them.
    await expect(page.locator('#last-intent')).toHaveText('live-only');
    expect(await page.locator('#last-intent').getAttribute('data-dx02-live')).toBe('preserved');
    expect(await page.locator('#last-intent').getAttribute('data-open-preserve')).toBe('');
  });

  test('positive control: without the attribute the same morph DOES update the node', async ({
    page,
  }) => {
    // Same flow, same node, no `data-open-preserve`. The echo landing proves
    // the previous test's unchanged text is the exemption's effect and not an
    // upstream failure to morph at all.
    await armEnhanceReady(page);
    await page.goto('/notes/new');
    await waitForEnhanceReady(page);

    const invalidPost = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/notes/new'),
    );
    await page.fill('#title', 'ab');
    await page.click('#submit');
    expect((await invalidPost).status()).toBe(422);
    await expect(page.locator('#last-intent')).toHaveText('intent=create');
  });
});

test.describe('DX-02 preserve: node identity, control state and focus survive the morph', () => {
  test('an id-matched control keeps its node, typed value and focus', async ({ page }) => {
    await armEnhanceReady(page);
    await page.goto('/notes/new');
    await waitForEnhanceReady(page);

    await page.fill('#title', 'ab');
    await page.fill('#body', 'typed body text');
    // Hold the live textarea's element handle so the assertion compares object
    // identity, not just query results.
    const bodyBefore = await page.locator('#body').elementHandle();
    expect(bodyBefore).toBeTruthy();
    await page.focus('#title');

    // Enter in the single-line title input submits implicitly without moving
    // focus; the morph then runs under the focused control.
    const invalidPost = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/notes/new'),
    );
    await page.keyboard.press('Enter');
    expect((await invalidPost).status()).toBe(422);
    await expect(page.locator('#error')).toHaveText('title must be at least 3 characters');

    // Same node object: the id-keyed alignment reused the live control.
    const bodyAfter = await page.locator('#body').elementHandle();
    expect(bodyAfter).toBeTruthy();
    expect(await bodyBefore!.evaluate((node, other) => node === other, bodyAfter)).toBe(true);
    // #603: a control the user touched keeps its live value (the incoming
    // document renders both fields empty).
    await expect(page.locator('#body')).toHaveValue('typed body text');
    // #603: focus survives the morph because the control survived it.
    expect(await page.evaluate(deepActiveElementId)).toBe('title');
  });
});
