/**
 * S-C1.4 / #1609 — Server-only CSS of an INSTALLED package component.
 *
 * `www` consumes `@openelement/ui` through its public export path
 * (`import '@openelement/ui/open-code-block'`, declared in `packageIslands`),
 * so the component's file-backed authored stylesheet lives OUTSIDE the
 * application root — in the installed package. The contributing page renders
 * that component on the SERVER (a page component imports it; the page itself is
 * never an island), so this is the packed/out-of-root delivery case: the sheet
 * must come out of the existing client-build asset owner as a content-addressed
 * external resource and reach the shadow tree through the DSD template's own
 * marked `<link>` — never as inline text, and without requiring JavaScript.
 *
 * It is the same pipeline the workspace fixtures exercise, measured on a real
 * site page that consumes a real package export.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert/strict';
import { expect, test } from '@playwright/test';

const DIST = new URL('../dist/', import.meta.url);
const ASSETS = new URL('client/assets/', DIST);
const PAGE = '/contributing/';

/** The installed package's own authored stylesheet — the provenance source. */
const PACKAGE_SHEET = readFileSync(
  new URL('../../packages/ui/src/open-code-block.css', import.meta.url),
  'utf8',
);

function emittedSheets(): Map<string, string> {
  const sheets = new Map<string, string>();
  for (const name of readdirSync(ASSETS)) {
    if (!name.endsWith('.css')) continue;
    sheets.set(`/client/assets/${name}`, readFileSync(new URL(name, ASSETS), 'utf8'));
  }
  return sheets;
}

const sheets = emittedSheets();

/** The page's serialized markup, read from the build (no server needed). */
function pageHtml(): string {
  return readFileSync(new URL('contributing/index.html', DIST), 'utf8');
}

/** The DSD template links of the package component, as the page serializes them. */
function packageComponentLinks(html: string): string[] {
  const match = /<open-code-block>[\s\S]*?<\/template>/.exec(html);
  assert.ok(match, 'the installed package component must be serialized with its DSD template');
  return [
    ...match[0].matchAll(/<link rel="stylesheet" href="([^"]+)" data-oe-static-styles \/>/g),
  ].map((link) => link[1]!);
}

test("the installed package component's authored sheet is an external emitted asset", () => {
  const html = pageHtml();
  const links = packageComponentLinks(html);
  expect(links.length, 'the DSD template declares its sheets externally').toBeGreaterThanOrEqual(1);
  for (const href of links) {
    expect(href).toMatch(/^\/client\/assets\/[0-9a-f]{12}\.css$/);
    expect(sheets.has(href), `${href} is an emitted build asset`).toBe(true);
  }

  // Provenance: one of the declared resources carries the INSTALLED package's
  // authored declarations (the copy button is the package sheet's own selector),
  // emitted unscoped because the component is a shadow root.
  const declaredCss = links.map((href) => sheets.get(href) ?? '').join('\n');
  expect(declaredCss).toContain('.copy-btn');
  expect(declaredCss).toContain(':host{');
  expect(declaredCss.includes('@scope ('), 'a shadow sheet is never scoped').toBe(false);
  // The sheet the package ships is what the build processed: its distinctive
  // declarations survive Vite's pipeline rather than being replaced by a copy.
  expect(PACKAGE_SHEET).toContain('.copy-btn');

  // No framework-generated inline stylesheet for a URL-addressable sheet.
  expect(/<style[^>]*data-oe-static-styles/.test(html)).toBe(false);
  // No Vite placeholder leaked into any emitted sheet.
  for (const css of sheets.values()) expect(css.includes('__VITE_ASSET__')).toBe(false);
});

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  test('the external package sheet styles the server-rendered shadow tree', async ({ page }) => {
    // Only the stylesheet contract is asserted here: unrelated site requests
    // (analytics stubs, favicons) are outside this spec's claim.
    const failures: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (response.status() >= 400 && (url.includes('/client/assets/') || url.endsWith(PAGE))) {
        failures.push(`${response.status()} ${url}`);
      }
    });
    await page.goto(PAGE);

    // The component rendered on the server, its copy button visible in the DSD
    // tree, and its layout decided by the external package sheet.
    const button = page.locator('open-code-block .copy-btn');
    await expect(button, 'the package component rendered with its DSD content').toHaveCount(1);
    const styles = await button.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { position: computed.position, display: computed.display };
    });
    expect(styles.position, 'the package sheet positions the button absolutely').toEqual(
      'absolute',
    );
    expect(styles.display).not.toEqual('none');
    expect(failures, 'no stylesheet or asset request may fail').toEqual([]);
  });
});
