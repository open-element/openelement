/**
 * ui dogfood — open-tabs behavioral evidence (#1226).
 *
 * Observed in a real browser on the compiled framework:
 * - WAI-ARIA tabs wiring applied to the live light-DOM children (roles,
 *   aria-selected/aria-controls/aria-labelledby, roving tabindex, hidden);
 * - click selection;
 * - ArrowLeft/ArrowRight (wrapping) + Home/End keyboard pattern with focus
 *   following selection;
 * - reconnect/dispose: the decorate effect is off while detached (stale ARIA
 *   is observable) and re-established on reconnect without duplicating the
 *   per-tab click wiring.
 *
 * The page shell is a shadow-open DSD element, so document-level queries go
 * through the shadow-walker helpers (helpers.ts).
 */
import { expect, type Page, test } from '@playwright/test';
import { deepFirstExpr } from './helpers.ts';

/** Waits until open-tabs has activated and decorated its light-DOM children. */
async function waitForTabs(page: Page): Promise<void> {
  await page.waitForFunction(
    `customElements.get('open-tabs') !== undefined && ` +
      `${deepFirstExpr('#main-tabs [slot="tab"]')}?.getAttribute('role') === 'tab'`,
  );
}

/** Reads the decoration state of the tabs/panels (page context). */
const readTabStateExpr = `(() => {
  const host = ${deepFirstExpr('#main-tabs')};
  if (!host) return null;
  const tabs = [...host.querySelectorAll('[slot="tab"]')];
  const panels = [...host.querySelectorAll('[slot="panel"]')];
  return {
    selected: tabs.map((t) => t.getAttribute('aria-selected')),
    tabindices: tabs.map((t) => t.getAttribute('tabindex')),
    panelHidden: panels.map((p) => p.hasAttribute('hidden')),
  };
})()`;

/** True when the deepest focused tab carries the generated id suffix. */
function deepActiveTabIs(index: number): boolean {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return (active?.id ?? '').endsWith(`-tab-${index}`);
}

test.describe('open-tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tabs');
    await waitForTabs(page);
  });

  test('decorates the light-DOM children with the WAI-ARIA tabs wiring', async ({ page }) => {
    // tablist lives in the shadow root; tabs/panels are decorated in place.
    await expect(page.locator('#main-tabs [role="tablist"]')).toHaveCount(1);
    await expect(page.locator('#main-tabs [role="tab"]')).toHaveCount(3);
    await expect(page.locator('#main-tabs [role="tabpanel"]')).toHaveCount(3);

    expect(await page.evaluate(readTabStateExpr)).toEqual({
      selected: ['true', 'false', 'false'],
      tabindices: ['0', '-1', '-1'],
      panelHidden: [false, true, true],
    });

    // aria-controls / aria-labelledby pair up with the per-instance ids.
    const pairing = await page.evaluate(`(() => {
      const host = ${deepFirstExpr('#main-tabs')};
      const tab = host?.querySelector('[slot="tab"]');
      const panel = host?.querySelector('[slot="panel"]');
      return {
        controls: tab?.getAttribute('aria-controls'),
        labelledby: panel?.getAttribute('aria-labelledby'),
        tabId: tab?.id,
        panelId: panel?.id,
      };
    })()`);
    expect(pairing.controls).toBe(pairing.panelId);
    expect(pairing.labelledby).toBe(pairing.tabId);
  });

  test('click selects a tab and switches panels', async ({ page }) => {
    await page.locator('#main-tabs [slot="tab"]', { hasText: 'Beta' }).click();
    expect(await page.evaluate(readTabStateExpr)).toEqual({
      selected: ['false', 'true', 'false'],
      tabindices: ['-1', '0', '-1'],
      panelHidden: [true, false, true],
    });
    await expect(page.locator('#main-tabs [slot="panel"]', { hasText: 'Beta' })).toBeVisible();
    await expect(page.locator('#main-tabs [slot="panel"]', { hasText: 'Alpha' })).toBeHidden();
  });

  test('keyboard: ArrowRight/ArrowLeft wrap, Home/End jump, focus follows selection', async ({ page }) => {
    await page.locator('#main-tabs [slot="tab"]', { hasText: 'Alpha' }).focus();
    await page.keyboard.press('ArrowRight');
    expect((await page.evaluate(readTabStateExpr))?.selected).toEqual(['false', 'true', 'false']);
    expect(await page.evaluate(deepActiveTabIs, 1)).toBe(true);

    // Wrap backwards past the first tab.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect((await page.evaluate(readTabStateExpr))?.selected).toEqual(['false', 'false', 'true']);
    expect(await page.evaluate(deepActiveTabIs, 2)).toBe(true);

    await page.keyboard.press('Home');
    expect((await page.evaluate(readTabStateExpr))?.selected).toEqual(['true', 'false', 'false']);
    expect(await page.evaluate(deepActiveTabIs, 0)).toBe(true);

    await page.keyboard.press('End');
    expect((await page.evaluate(readTabStateExpr))?.selected).toEqual(['false', 'false', 'true']);
    expect(await page.evaluate(deepActiveTabIs, 2)).toBe(true);
  });

  test('reconnect/dispose: effects switch off while detached and re-sync on reconnect', async ({ page }) => {
    // Detach, write the selection while the decorate effect is disposed, and
    // observe the ARIA wiring stay stale; reconnect must re-sync exactly once.
    const stale = await page.evaluate(`(() => {
      const host = ${deepFirstExpr('#main-tabs')};
      const target = ${deepFirstExpr('#tabs-move-target')};
      const detached = document.createElement('div');
      detached.appendChild(host); // disconnected: kernel + effect dispose
      host.active = 2;
      const tabs = [...host.querySelectorAll('[slot="tab"]')];
      const staleSelected = tabs.map((t) => t.getAttribute('aria-selected'));
      target.appendChild(host); // reconnected: claim + activation re-run
      return staleSelected;
    })()`);
    // While detached the effect was off: the write did not re-decorate.
    expect(stale).toEqual(['true', 'false', 'false']);

    // Reconnect re-activates: the effect's first run applies active=2.
    await expect.poll(() => page.evaluate(readTabStateExpr)).toEqual({
      selected: ['false', 'false', 'true'],
      tabindices: ['-1', '-1', '0'],
      panelHidden: [true, true, false],
    });

    // The per-tab click wiring was attached once (WeakSet-guarded): a single
    // click selects exactly one tab after the move.
    await page.locator('#main-tabs [slot="tab"]', { hasText: 'Alpha' }).click();
    expect((await page.evaluate(readTabStateExpr))?.selected).toEqual(['true', 'false', 'false']);
  });
});
