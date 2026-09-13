/**
 * ui dogfood — root-boundary and claim evidence (#1226).
 *
 * Boundaries, observed in a real browser on the compiled framework:
 * - shadow-open (every @openelement/ui primitive): host.shadowRoot is
 *   reachable, content pierceable;
 * - light (consumer-authored dogfood-light): no shadow root at all, content
 *   inline in the page tree;
 * - shadow-closed (consumer-authored dogfood-closed): content renders (native
 *   DSD) while host.shadowRoot stays null.
 *
 * Claim: a customElements.define wrapper captures the browser-parsed DSD
 * nodes before the island bundle upgrades the elements; after hydration the
 * same node references must still be in place — a fresh re-render would have
 * replaced them.
 *
 * The page shell is a shadow-open DSD element, so document-level queries go
 * through the shadow-walker helpers (helpers.ts).
 */
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { deepFirstExpr, deepQueryFirstFn } from './helpers.ts';

const PORT = process.env.UI_DOGFOOD_E2E_PORT ?? '4197';

test.describe('root boundaries', () => {
  test('open ui primitive exposes its shadow root; light and closed roots hold their contracts', async ({ page }) => {
    await page.goto('/boundaries');
    await page.waitForFunction(() => customElements.get('open-badge') !== undefined);

    const boundaries = await page.evaluate(`(() => {
      const badge = ${deepFirstExpr('#open-boundary')};
      const light = ${deepFirstExpr('dogfood-light')};
      const closed = ${deepFirstExpr('dogfood-closed')};
      return {
        openShadow: badge?.shadowRoot != null,
        lightShadow: light?.shadowRoot ?? null,
        closedShadow: closed?.shadowRoot ?? null,
      };
    })()`);
    expect(boundaries.openShadow).toBe(true);
    expect(boundaries.lightShadow).toBeNull();
    expect(boundaries.closedShadow).toBeNull();

    // Light-root content is ordinary, pierceable markup.
    await expect(page.locator('#light-content')).toHaveText('light root boundary content');
    // The badge's slotted text renders through the open shadow root.
    await expect(page.locator('#open-boundary')).toHaveText('open shadow boundary');
    // The closed root renders server-side (native DSD) even though its
    // shadow tree is unreachable from script.
    await expect(page.locator('dogfood-closed')).toBeVisible();
    const closedBox = await page.locator('dogfood-closed').boundingBox();
    expect(closedBox?.height ?? 0).toBeGreaterThan(0);
  });

  test('SSR/DSD renders all boundary content with JavaScript disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/boundaries`);
    await expect(page.locator('#light-content')).toHaveText('light root boundary content');
    await expect(page.locator('#open-boundary')).toHaveText('open shadow boundary');
    await expect(page.locator('dogfood-closed')).toBeVisible();
    await context.close();
  });
});

test.describe('hydration claims the server-rendered DOM', () => {
  test('open-tabs upgrades in place (node identity preserved)', async ({ page }) => {
    // Runs before any page script: capture the browser-parsed DSD nodes at
    // the moment the island bundle defines the element.
    await page.addInitScript(`(() => {
      const deepFirst = (${deepQueryFirstFn});
      window.__claimProbe = {};
      const originalDefine = customElements.define.bind(customElements);
      customElements.define = (name, ctor, options) => {
        const host = deepFirst(document, name);
        if (host?.shadowRoot) {
          window.__claimProbe[name] = {
            shadowChild: host.shadowRoot.querySelector('.tabs'),
            firstLightChild: host.firstElementChild,
            lightChildCount: host.childElementCount,
          };
        }
        return originalDefine(name, ctor, options);
      };
    })()`);

    await page.goto('/tabs');
    await page.waitForFunction(
      `customElements.get('open-tabs') !== undefined && ` +
        `${deepFirstExpr('#main-tabs [slot="tab"]')}?.getAttribute('role') === 'tab'`,
    );

    const claim = await page.evaluate(`(() => {
      const probe = window.__claimProbe['open-tabs'];
      const host = (${deepQueryFirstFn})(document, '#main-tabs');
      if (!probe || !host) return null;
      return {
        sameShadowNode: probe.shadowChild === host.shadowRoot?.querySelector('.tabs'),
        sameLightChild: probe.firstLightChild === host.firstElementChild,
        lightChildCountBefore: probe.lightChildCount,
        lightChildCountAfter: host.childElementCount,
      };
    })()`);
    // Claim, not fresh render: the parsed DSD shadow node and the light-DOM
    // children are the same objects the browser parsed from the HTML.
    expect(claim).toEqual({
      sameShadowNode: true,
      sameLightChild: true,
      lightChildCountBefore: 6,
      lightChildCountAfter: 6,
    });
  });
});
