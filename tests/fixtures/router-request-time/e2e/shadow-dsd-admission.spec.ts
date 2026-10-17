/**
 * S-C1.4 / #1609 control experiment — one Shadow/DSD island, two render modes.
 *
 * `probe-panel` (`root: 'shadow-open'`, `defineIslandConfig({ hydrate: 'load',
 * ssr: true, dsd: true })`, one authored declaration, one marker) is rendered by
 * the IDENTICAL markup from two hosts:
 *
 *   - `/panel-static`  — a prerendered static route (dist/panel-static/index.html)
 *   - `/panel-dynamic` — an ordinary request-time route
 *     (`renderIntent: { mode: 'dynamic' }`, served by dist/server/index.js)
 *
 * Render mode is the only independent variable. Both must deliver the same
 * component tree, the same DSD template and the same external stylesheet
 * resource — for a shadow-root component the delivery channel is the DSD
 * template's own marked `<link>`, not a document-head link.
 *
 * Measured RED before the fixture was corrected: the same component nested in a
 * LIGHT-root page serialized as an opaque bare host in both modes. With the
 * host page declared `shadow-open` (the shape the known-good `/live` page uses)
 * both modes are GREEN — the boundary is the host contract, not the render mode
 * and not the CSS pipeline.
 */

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert/strict';
import { expect, test } from '@playwright/test';

const ORIGIN = `http://127.0.0.1:${process.env.REQUEST_TIME_E2E_PORT ?? '4180'}`;
const DIST = new URL('../dist/', import.meta.url);
const PANEL_COLOR = 'rgb(11, 77, 133)';

/** The DSD template of the nested shadow component, as serialized. */
function panelTemplate(html: string): string {
  const match = /<probe-panel>[\s\S]*?<\/probe-panel>/.exec(html);
  assert.ok(match, 'the nested shadow host must be serialized');
  return match[0];
}

test('the prerendered static route serializes the nested Shadow/DSD component', () => {
  const html = readFileSync(new URL('panel-static/index.html', DIST), 'utf8');
  const template = panelTemplate(html);
  assert.ok(template.includes('<template shadowrootmode="open">'), template);
  assert.ok(template.includes('probe-panel-marker'), template);
  // The sheet is the DSD channel's business: an EXTERNAL, emitted, marked link
  // inside the shadow template — never inlined text.
  const link = /<link rel="stylesheet" href="([^"]+)" data-oe-static-styles \/>/.exec(template);
  assert.ok(link, template);
  assert.match(link[1]!, /^\/client\/assets\/[0-9a-f]{12}\.css$/);
  const sheet = readFileSync(new URL(`.${link[1]!}`, DIST), 'utf8');
  assert.ok(sheet.includes('.probe-panel-body'), sheet);
  // No framework-generated inline stylesheet anywhere in the document.
  assert.equal(/<style[^>]*data-oe-static-styles/.test(html), false);
});

test('the request-time dynamic route serializes the same component identically', async () => {
  const response = await fetch(`${ORIGIN}/panel-dynamic?id=7`, {
    headers: { accept: 'text/html' },
  });
  expect(response.status).toEqual(200);
  expect(response.headers.get('content-type') ?? '').toContain('text/html');
  const html = await response.text();

  // The dynamic parameter reached the route's page through loader + typed props.
  expect(html).toContain('id-text="id=7"');
  expect(html).toContain('id=7</p>');

  const template = panelTemplate(html);
  expect(template).toContain('<template shadowrootmode="open">');
  expect(template).toContain('probe-panel-marker');
  const link = /<link rel="stylesheet" href="([^"]+)" data-oe-static-styles \/>/.exec(template);
  expect(link, `the shadow template carries its external sheet (${template})`).not.toBeNull();
  expect(link![1]).toMatch(/^\/client\/assets\/[0-9a-f]{12}\.css$/);
  expect(html.includes('<style data-oe-static-styles'), 'no framework inline stylesheet').toBe(
    false,
  );

  // The same resource identity the static route declares — one asset, two
  // render modes, no mode-specific URL.
  const staticHtml = readFileSync(new URL('panel-static/index.html', DIST), 'utf8');
  expect(link![1]).toEqual(
    /<link rel="stylesheet" href="([^"]+)" data-oe-static-styles \/>/.exec(staticHtml)![1],
  );
});

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  for (const route of ['/panel-static', '/panel-dynamic?id=7']) {
    test(`the DSD sheet styles the shadow tree without JS (${route})`, async ({ page }) => {
      const failures: string[] = [];
      page.on('response', (response) => {
        if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
      });
      await page.goto(route);
      // Playwright's CSS engine pierces the (declarative) shadow root, so the
      // assertion reads the element the DSD template produced.
      const inner = page.locator('probe-panel .probe-panel-body');
      await expect(inner, 'the DSD template rendered its content').toHaveCount(1);
      expect(await inner.textContent()).toContain('probe panel marker');
      expect(await inner.evaluate((el) => getComputedStyle(el).color)).toEqual(PANEL_COLOR);
      expect(failures, 'no stylesheet or asset request may fail').toEqual([]);
    });
  }
});
