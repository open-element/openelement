/**
 * E2E: Light-mode in-place activation after a delayed upgrade (#1148).
 *
 * ADR-0142 acceptance on the real SSR -> delayed-upgrade path: the
 * /probe-light page ships a server-rendered `renderMode = 'light'` island
 * (open-light-probe, hydrate 'load') whose host carries the internal
 * `data-oe-light` provenance marker. The spec holds the island's chunk
 * response with page.route so client.js evaluates (installing the
 * pre-hydration click capture) while the element stays undefined, then:
 *
 *   1. Asserts the SSR markup is present in light DOM and the element is not
 *      upgraded (customElements.get(...) === undefined).
 *   2. Types into the static input, clicks the button once (queued for
 *      replay by the capture listener), then restores input focus and a
 *      selection range — all before the chunk is released.
 *   3. Releases the chunk and waits for the delayed upgrade.
 *   4. Proves IN PLACE activation: identical host/input/button/span nodes,
 *      preserved value/selection/focus, the pre-upgrade click replayed
 *      exactly once (counter '1', not '2'), live bindings afterwards
 *      (one more click -> '2'), and no shadow root attached.
 *   5. Asserts the matched path emits no structured SSR/hydration mismatch
 *      diagnostic (any degrade would mean the DOM was re-rendered).
 *
 * Runs on all three configured browser projects (Chromium, Firefox, WebKit).
 *
 * Note: never assert via networkidle before the release — the held chunk
 * request keeps the network busy by construction. The statically imported
 * shared-runtime chunk in client.js must never be the one held here (see the
 * comment above CHUNK_URL_PATTERN).
 */

import { expect, test } from '@playwright/test';

// The island chunk hash changes with every build; match by prefix. client.js
// statically imports ONE island chunk for its shared runtime helpers —
// holding that chunk would stall the whole loader (no click capture, no
// replay). The build check below pins that the probe chunk is not it.
const CHUNK_URL_PATTERN = '**/client/islands/island-open-light-probe-*.js';

interface PreUpgradeRefs {
  host: Element;
  input: HTMLInputElement;
  button: Element;
  span: Element;
}

test.describe('light-mode in-place activation', () => {
  test('SSR light island activates in place after a delayed upgrade, replaying the pre-upgrade click exactly once', async ({ page }) => {
    const mismatchWarnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('SSR/hydration mismatch')) {
        mismatchWarnings.push(msg.text());
      }
    });

    // Hold the island chunk: the loader's dynamic import stays pending until
    // releaseChunk() lets the route continue. `finally` releases the gate so
    // a failing assertion can never strand the route handler.
    let chunkRequested = false;
    let releaseChunk!: () => void;
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    await page.route(CHUNK_URL_PATTERN, async (route) => {
      chunkRequested = true;
      await chunkGate;
      await route.continue();
    });

    try {
      // domcontentloaded, not load: WebKit holds the window load event until
      // the pending dynamic import of the held chunk resolves, which would
      // deadlock this test. Module scripts still evaluate before
      // DOMContentLoaded, so the click capture listener is installed either
      // way.
      await page.goto('/probe-light', { waitUntil: 'domcontentloaded' });

      // client.js has evaluated by the load event (module scripts block it):
      // the click capture listener is installed and the chunk import is in
      // flight. Poll to prove the held request is the one this test gates on.
      await expect.poll(() => chunkRequested).toBe(true);

      // ── SSR state, element not upgraded ──────────────────────────────
      const host = page.locator('open-light-probe');
      await expect(host).toHaveAttribute('data-oe-light', '');
      await expect(host).toHaveClass('probe-host');
      const input = page.locator('open-light-probe input.probe-input');
      const button = page.locator('open-light-probe .probe-button');
      const counter = page.locator('open-light-probe .probe-count');
      await expect(counter).toHaveText('0');

      const notUpgraded = await page.evaluate(() =>
        customElements.get('open-light-probe') === undefined
      );
      expect(notUpgraded).toBe(true);

      // Capture node references before the upgrade for identity checks.
      await page.evaluate(() => {
        const host = document.querySelector('open-light-probe');
        if (!host) throw new Error('open-light-probe host missing from SSR DOM');
        const refs: PreUpgradeRefs = {
          host,
          input: host.querySelector('input.probe-input') as HTMLInputElement,
          button: host.querySelector('.probe-button') as Element,
          span: host.querySelector('.probe-count') as Element,
        };
        if (!refs.input || !refs.button || !refs.span) {
          throw new Error('probe SSR subtree incomplete');
        }
        (window as unknown as { __pre: PreUpgradeRefs }).__pre = refs;
      });

      // ── Interact while undefined ───────────────────────────────────────
      await input.pressSequentially('typed-before-upgrade');
      await expect(input).toHaveValue('typed-before-upgrade');

      // The pre-upgrade click: captured by the document-level listener and
      // replayed once the island's bindings are live (ADR-0142, #942/#1148).
      await button.click();

      // Clicking the button may move focus to it (Chromium) or leave it on
      // the input (Firefox/WebKit); restore a deterministic state to assert
      // against after the upgrade.
      await input.focus();
      await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 5));

      // ── Release the chunk: delayed upgrade runs ────────────────────────
      releaseChunk();
      await page.waitForFunction(() => customElements.get('open-light-probe') !== undefined);

      // The replayed click increments the bound counter exactly once.
      await expect(counter).toHaveText('1');

      // ── In-place activation proof ──────────────────────────────────────
      const post = await page.evaluate(() => {
        const pre = (window as unknown as { __pre: PreUpgradeRefs }).__pre;
        const host = document.querySelector('open-light-probe');
        return {
          sameHost: pre.host === host,
          sameInput: pre.input === host?.querySelector('input.probe-input'),
          sameButton: pre.button === host?.querySelector('.probe-button'),
          sameSpan: pre.span === host?.querySelector('.probe-count'),
          noShadowRoot: host?.shadowRoot === null,
          stillMarked: host?.hasAttribute('data-oe-light') ?? false,
          inputValue: pre.input.value,
          selectionStart: pre.input.selectionStart,
          selectionEnd: pre.input.selectionEnd,
          inputFocused: document.activeElement === pre.input,
        };
      });
      expect(post).toEqual({
        sameHost: true,
        sameInput: true,
        sameButton: true,
        sameSpan: true,
        noShadowRoot: true,
        stillMarked: true,
        // The pre-upgrade typed value is not clobbered by activation.
        inputValue: 'typed-before-upgrade',
        selectionStart: 2,
        selectionEnd: 5,
        inputFocused: true,
      });

      // ── Live bindings after activation ─────────────────────────────────
      await button.click();
      await expect(counter).toHaveText('2');

      // The matched SSR DOM must activate without the mismatch diagnostic;
      // a degrade would have re-rendered the subtree (and lost node identity).
      expect(mismatchWarnings).toEqual([]);
    } finally {
      releaseChunk();
    }
  });
});
