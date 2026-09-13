/**
 * ui dogfood — open-dialog behavioral evidence (#1226).
 *
 * Observed in a real browser on the compiled framework:
 * - the SSR-open dialog enters the top layer as :modal at hydration (#1030);
 * - trigger activation opens a modal dialog with native focus containment;
 * - Escape closes and returns focus to the trigger;
 * - the close affordance fires exactly one open-dialog-close event;
 * - :state(open)/:state(closed) track the modal session.
 *
 * The page shell is a shadow-open DSD element, so document-level queries go
 * through the shadow-walker helpers (helpers.ts).
 */
import { expect, type Page, test } from '@playwright/test';
import { deepAllExpr, deepFirstExpr } from './helpers.ts';

/** Waits until open-dialog is defined and both instances have activated. */
async function waitForDialogs(page: Page): Promise<void> {
  await page.waitForFunction(
    `customElements.get('open-dialog') !== undefined && ` +
      `${deepAllExpr('open-dialog')}.every((host) => ` +
      `host.shadowRoot?.querySelector('dialog') !== null && ` +
      `(host.matches(':state(open)') || host.matches(':state(closed)')))`,
  );
}

/**
 * The /dialog page carries an SSR-open modal dialog: while it is open the
 * rest of the page is inert (top layer), so interactive tests close it first.
 */
async function closeSsrOpenDialog(page: Page): Promise<void> {
  await page.evaluate(`${deepFirstExpr('#ssr-open-dialog')}.close()`);
  await page.waitForFunction(
    `${deepFirstExpr('#ssr-open-dialog')}?.matches(':state(closed)') ?? false`,
  );
}

/** Deepest active element, descending through open shadow roots. */
function deepActiveDescriptor(): string {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active ? active.id || active.tagName.toLowerCase() : '';
}

/**
 * True when focus sits inside an open-dialog: either within its shadow tree
 * or on slotted light-DOM content (whose root node is the page tree).
 */
function focusInsideOpenDialog(): boolean {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  let node: Element | null = active;
  while (node) {
    if (node.tagName.toLowerCase() === 'open-dialog') return true;
    if (node.closest('open-dialog')) return true;
    const root = node.getRootNode() as ShadowRoot;
    node = (root?.host as Element | undefined) ?? null;
  }
  return false;
}

test.describe('open-dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dialog');
    await waitForDialogs(page);
  });

  test('SSR-rendered open attribute becomes a top-layer modal at hydration (#1030)', async ({ page }) => {
    const host = page.locator('#ssr-open-dialog');
    await expect
      .poll(() =>
        page.evaluate(
          `${deepFirstExpr('#ssr-open-dialog')}` +
            `?.shadowRoot?.querySelector('dialog')?.matches(':modal') ?? false`,
        )
      )
      .toBe(true);
    await expect(host).toHaveAttribute('open', '');
    await expect(host).toHaveJSProperty('open', true);

    // close() clears the reflected attribute, leaves the top layer and flips
    // the custom state.
    await closeSsrOpenDialog(page);
    await expect(host).not.toHaveAttribute('open', '');
    const closed = await page.evaluate(`(() => {
      const el = ${deepFirstExpr('#ssr-open-dialog')};
      return {
        stateClosed: el?.matches(':state(closed)') ?? false,
        modal: el?.shadowRoot?.querySelector('dialog')?.matches(':modal') ?? true,
        open: el?.shadowRoot?.querySelector('dialog')?.open ?? true,
      };
    })()`);
    expect(closed).toEqual({ stateClosed: true, modal: false, open: false });
  });

  test('trigger opens a modal dialog; Tab stays contained; Escape closes and returns focus', async ({ page }) => {
    await closeSsrOpenDialog(page);
    const trigger = page.locator('#dialog-trigger');
    await trigger.focus();
    await page.keyboard.press('Enter');

    const host = page.locator('open-dialog').first();
    await expect(host).toHaveAttribute('open', '');
    const modal = await page.evaluate(
      `${deepFirstExpr('open-dialog')}` +
        `?.shadowRoot?.querySelector('dialog')?.matches(':modal') ?? false`,
    );
    expect(modal).toBe(true);

    // Focus moved into the dialog (delegatesFocus + native showModal).
    await expect.poll(() => page.evaluate(focusInsideOpenDialog)).toBe(true);

    // Focus containment: cycling Tab never reaches page content outside the
    // dialog's focus scope. Chromium/Firefox walk every focusable in the
    // dialog (with a document-boundary stop at <body>, observed natively);
    // WebKit's default keynav skips buttons and cycles document <-> <dialog>.
    // The containment contract is engine-independent; per-button
    // reachability is not.
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      seen.add(await page.evaluate(deepActiveDescriptor));
    }
    expect(seen.has('after-dialog')).toBe(false);
    expect(seen.has('dialog-trigger')).toBe(false);
    if (test.info().project.name !== 'webkit') {
      expect(seen.has('dialog-inner-action')).toBe(true);
      expect(seen.has('dialog-footer-action')).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(host).not.toHaveAttribute('open', '');
    // Native focus return to the pre-dialog focused element (the trigger).
    expect(await page.evaluate(deepActiveDescriptor)).toBe('dialog-trigger');
  });

  test('close affordance closes once and dispatches exactly one open-dialog-close', async ({ page }) => {
    await closeSsrOpenDialog(page);
    await page.evaluate(() => {
      (window as unknown as { __closeEvents: number }).__closeEvents = 0;
      document.addEventListener('open-dialog-close', () => {
        (window as unknown as { __closeEvents: number }).__closeEvents++;
      });
    });

    await page.locator('#dialog-trigger').click();
    const host = page.locator('open-dialog').first();
    await expect(host).toHaveAttribute('open', '');

    // The close button lives in the open shadow root (Playwright pierces it).
    await page.locator('open-dialog .dialog-close').first().click();
    await expect(host).not.toHaveAttribute('open', '');
    const state = await page.evaluate(() => ({
      events: (window as unknown as { __closeEvents: number }).__closeEvents,
      stateClosed:
        document.querySelector('dialog-page')?.shadowRoot?.querySelector('open-dialog')?.matches(
          ':state(closed)',
        ) ?? false,
    }));
    expect(state.events).toBe(1);
    expect(state.stateClosed).toBe(true);
  });
});
