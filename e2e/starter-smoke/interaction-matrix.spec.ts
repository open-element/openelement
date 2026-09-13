/**
 * Client-side interaction matrix for the starter surface (#936).
 *
 * The starter's own routes (contact form loop, counter island, in-app nav)
 * exercised the way a user would. Tests 1-2 are the #937/#938 repros: they
 * were RED against the published alpha.15 stack and have gated the Wave 1
 * fixes (green) since that train landed.
 */
import { expect, test } from '@playwright/test';

test.describe('form loop', () => {
  // #937/#938 repros — RED on the published alpha.15 stack, green since the
  // Wave 1 fixes landed; they now gate those fixes.
  test('enhanced submit morphs #thanks without a full reload (#937)', async ({ page }) => {
    await page.goto('/contact');
    await page.evaluate(() => {
      (window as unknown as { __morphDoc?: number }).__morphDoc = 1;
    });
    await page.getByPlaceholder('you@example.com').fill('ada@example.com');
    await page.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page.locator('#thanks')).toBeVisible({ timeout: 10_000 });
    const marker = await page.evaluate(
      () => (window as unknown as { __morphDoc?: number }).__morphDoc,
    );
    expect(marker).toBe(1);
  });

  test('validation failure morphs #error without a full reload (#937)', async ({ page }) => {
    await page.goto('/contact');
    await page.evaluate(() => {
      (window as unknown as { __morphDoc2?: number }).__morphDoc2 = 1;
    });
    await page.getByPlaceholder('you@example.com').fill('not-an-email');
    await page.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page.locator('#error')).toBeVisible({ timeout: 10_000 });
    const marker = await page.evaluate(
      () => (window as unknown as { __morphDoc2?: number }).__morphDoc2,
    );
    expect(marker).toBe(1);
  });

  test('no-JS native POST is accepted, PRG lands on #thanks (#938)', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/contact');
    await page.getByPlaceholder('you@example.com').fill('grace@example.com');
    await page.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page).toHaveURL(/subscribed=grace%40example\.com/);
    await expect(page.locator('#thanks')).toBeVisible();
    await context.close();
  });
});

test.describe('hydration timing', () => {
  test('client-only island renders and binds signals without DSD (#939)', async ({ page }) => {
    await page.goto('/');
    const ticker = page.locator('only-ticker');
    await expect(ticker).toBeVisible();
    const span = ticker.locator('#tick');
    await expect(span).toHaveText('0');
    await ticker.getByRole('button', { name: 'tick' }).click();
    await expect(span).toHaveText('1');
  });
  // Diagnosed during the v0.44 consumer migration (alpha.8): the compiled
  // capture/replay mechanism installs one document-level capture listener
  // (ensurePreHydrationClickCapture). For a shadow-rooted island nested in
  // the page's shadow tree, the captured event.target is retargeted to the
  // outer page host before the listener sees it, and the claiming island's
  // isInside(root, target) check (parentNode walk from the retargeted host)
  // can never reach the island's shadow root — the recorded click is consumed
  // without replay. Replay therefore only works for light-root island content
  // with no shadow boundary between the target and the capture root, which
  // the starter's shadow-DSD island layout does not satisfy. Framework-side
  // fix (per-root capture on unclaimed DSD roots, or composedPath-based
  // target recording) is tracked separately; until then this stays fixme
  // rather than weakening the assertion.
  test.fixme('click before idle hydration is replayed after hydration (#942)', async ({ page }) => {
    // Hold the idle callback so the island module cannot evaluate before the
    // click: the click lands in the pre-hydration window and must be replayed
    // by the capture/replay mechanism once the island hydrates.
    await page.addInitScript(() => {
      const original = globalThis.requestIdleCallback;
      globalThis.requestIdleCallback = ((fn: unknown) =>
        globalThis.setTimeout(() =>
          (fn as () => void)(), 2500)) as typeof original;
    });
    await page.goto('/');
    const counter = page.locator('my-counter');
    await expect(counter).toBeVisible();
    await page.evaluate(() => {
      // Islands live inside the page element's shadow tree (#562) — a
      // light-DOM querySelector never sees them (the page root is light in
      // v0.44, so the direct querySelector finds the host first).
      const deep = (root: Document | ShadowRoot): Element | null => {
        const direct = root.querySelector('my-counter');
        if (direct) return direct;
        for (const el of root.querySelectorAll('*')) {
          const shadow = (el as HTMLElement).shadowRoot;
          if (shadow) {
            const found = deep(shadow);
            if (found) return found;
          }
        }
        return null;
      };
      const el = deep(document);
      el!.shadowRoot!.querySelectorAll('button')[1].click();
    });
    await expect(counter.locator('#count')).toHaveText('1', {
      timeout: 10_000,
    });
  });
});

test.describe('navigation', () => {
  // Diagnosed 2026-08 (#944 round-4 leftover): still red, but not for a
  // framework reason. The server now sends `private, no-cache` on request-time
  // GET 200s (4056fafa), which Chromium allows into the bfcache; a real Chrome
  // (channel: 'chrome') run restores the page — goBack() hangs waiting for a
  // `load` event that a bfcache restore never fires. The blocker is the
  // harness: Playwright's bundled Chromium launches with
  // `--disable-back-forward-cache` by default (playwright-core
  // chromiumSwitches.js), and overriding it via
  // launchOptions.ignoreDefaultArgs still does not restore in headless shell
  // (a window marker set before leaving is gone after goBack). Activating
  // this test needs a bfcache-capable browser channel in CI plus
  // `goBack({ waitUntil: 'commit' })` below instead of waitForLoadState('load').
  test.fixme('island state survives back/forward (bfcache, #943)', async ({ page }) => {
    await page.goto('/');
    await page.locator('my-counter').getByRole('button', { name: '+' }).click();
    await expect(page.locator('my-counter #count')).toHaveText('1');
    await page.goto('/blog');
    await page.goBack();
    await page.waitForLoadState('load');
    await expect(page.locator('my-counter #count')).toHaveText('1');
    await page.locator('my-counter').getByRole('button', { name: '+' }).click();
    await expect(page.locator('my-counter #count')).toHaveText('2');
  });

  // #943: was fixme-red against alpha.15 — the original repro page was too
  // short to scroll at the default 720px viewport (max scrollY=0), so the
  // test could never pass. The framework-side fix is the entry-codegen
  // relaxation of request-time GET 200s from no-store to private,no-cache
  // (covered by the Router request-time parity gate); this test gates
  // the user-visible outcome — back/forward restores the scroll position —
  // on a genuinely scrollable starter page (narrow viewport).
  test('scroll position is restored on back navigation (#943)', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 420 });
    await page.goto('/blog/welcome');
    await page.evaluate(() => globalThis.scrollTo(0, 9999));
    await page.waitForTimeout(300);
    const yBefore = await page.evaluate(() => globalThis.scrollY);
    expect(yBefore).toBeGreaterThan(100);
    await page.goto('/');
    await page.goBack();
    await page.waitForTimeout(300);
    const y = await page.evaluate(() => globalThis.scrollY);
    expect(y).toBeGreaterThan(100);
  });
});
