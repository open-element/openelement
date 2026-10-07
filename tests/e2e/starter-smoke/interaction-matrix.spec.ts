/**
 * Client-side interaction matrix for the starter surface (#936, #1530
 * showcase form).
 *
 * The showcase starter retired the contact form and the only-ticker island:
 * the pre-hydration click replay and third-party-pressure gates keep running
 * against my-counter (idle), the client-only island gate runs against
 * live-timer (hydrate 'only', shadow-open), and the scroll-restore gate runs
 * on the landing page — the showcase's longest scrollable surface.
 */
import { expect, test } from '@playwright/test';

test.describe('hydration timing', () => {
  test("client-only island renders without SSR and ticks (live-timer, #939's class)", async ({
    page,
  }) => {
    await page.goto('/');
    const timer = page.locator('live-timer');
    await expect(timer).toBeVisible();
    // ssr:false means the island's DOM exists only after the client entry
    // builds it; the tick then advances from the document time origin.
    const first = await timer.locator('#elapsed').innerText();
    await expect(timer.locator('#elapsed')).not.toHaveText(first, { timeout: 5_000 });
  });

  // #942 (fixed): the document-level capture listener
  // (ensurePreHydrationClickCapture) observes a retargeted event.target (the
  // island host) for clicks originating inside the island's open shadow root.
  // The capture now resolves the original target through composedPath()[0],
  // so the claiming island's isInside(root, target) check sees the true
  // target and replays exactly once. Unit coverage (all three replay
  // invariants plus cross-island and removed-target cases) lives in
  // packages/element/__tests__/compiled-runtime/shadow-replay.test.ts; this
  // test gates the user-visible outcome on the real starter surface.
  test('click before idle hydration is replayed after hydration (#942)', async ({ page }) => {
    // Hold the idle callback so the island module cannot evaluate before the
    // click: the click lands in the pre-hydration window and must be replayed
    // by the capture/replay mechanism once the island hydrates.
    await page.addInitScript(() => {
      const original = globalThis.requestIdleCallback;
      globalThis.requestIdleCallback = ((fn: unknown) =>
        globalThis.setTimeout(() => (fn as () => void)(), 2500)) as typeof original;
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
  // Declared-island scoping: 64 undeclared third-party custom-element hosts
  // interacted before hydration must not exhaust the bounded pre-upgrade
  // queue — the real idle island click still replays exactly once. Uses only
  // public DOM APIs (no test-only internals).
  test('third-party pressure does not block idle replay (declared-island scoping)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = globalThis.requestIdleCallback;
      globalThis.requestIdleCallback = ((fn: unknown) =>
        globalThis.setTimeout(() => (fn as () => void)(), 2500)) as typeof original;
    });
    await page.goto('/');
    const counter = page.locator('my-counter');
    await expect(counter).toBeVisible();
    await page.evaluate(() => {
      const prefixes = ['sl', 'md-filled', 'ion', 'vaadin', 'lion', 'fast', 'mui', 't'];
      for (let i = 0; i < 64; i++) {
        const host = document.createElement(`${prefixes[i % prefixes.length]}-foreign-${i}`);
        const button = document.createElement('button');
        button.textContent = `foreign-${i}`;
        host.appendChild(button);
        document.body.appendChild(host);
        button.click();
      }
    });
    await page.evaluate(() => {
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
  // #943: was fixme-red against alpha.15 — the original repro page was too
  // short to scroll at the default 720px viewport (max scrollY=0), so the
  // test could never pass. The framework-side fix is the entry-codegen
  // relaxation of request-time GET 200s from no-store to private,no-cache
  // (covered by the Router request-time parity gate); this test gates
  // the user-visible outcome — back/forward restores the scroll position —
  // on a genuinely scrollable starter page (narrow viewport, the landing).
  test('scroll position is restored on back navigation (#943)', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 420 });
    await page.goto('/');
    await page.evaluate(() => globalThis.scrollTo(0, 9999));
    await page.waitForTimeout(300);
    const yBefore = await page.evaluate(() => globalThis.scrollY);
    expect(yBefore).toBeGreaterThan(100);
    await page.goto('/about');
    await page.goBack();
    await page.waitForTimeout(300);
    const y = await page.evaluate(() => globalThis.scrollY);
    expect(y).toBeGreaterThan(100);
  });
});
