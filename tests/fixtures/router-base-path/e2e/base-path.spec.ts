/**
 * E2E: the style-delivery contract at a NON-ROOT base (alpha15 S lane,
 * S-C2/S-12).
 *
 * The fixture builds the S-C1.2/S-C1.4 delivery shape under `base: '/sub/'`:
 * a static (SSG) page and a request-time STREAMED route, each carrying a
 * light-root sheet (document head link), a nested light-root sheet, and a
 * nested shadow-root sheet (DSD template link). Over real HTTP:
 *
 *   1. the SSG page's original head declares every light sheet as a marked
 *      `<link>` whose href carries `/sub/`, and every declared href answers
 *      200 `text/css` with the authored rules;
 *   2. the request-time streamed response's FIRST flush already contains
 *      `</head>` and those marked links — the deferred frame arrives later, so
 *      no stylesheet link is appended after the head was sent;
 *   3. no framework inline `<style data-oe-static-styles>` node exists for a
 *      URL-addressable sheet, and the shadow sheet is declared inside its own
 *      DSD template (still base-prefixed);
 *   4. with JavaScript disabled, every configured engine renders the styled
 *      content (computed colors) at the base path.
 *
 * Run: pnpm --dir tests/fixtures/router-base-path run build
 *      pnpm --dir tests/fixtures/router-base-path run e2e:browsers
 */

import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const DIST = new URL('../dist/', import.meta.url);
const CLIENT_ASSETS_DIR = new URL('client/assets/', DIST);
const BASE = '/sub';

/** Every emitted client stylesheet, keyed by its base-prefixed public href. */
function emittedStyleAssets(): Map<string, string> {
  const assets = new Map<string, string>();
  for (const name of readdirSync(CLIENT_ASSETS_DIR)) {
    if (!name.endsWith('.css')) continue;
    assets.set(
      `${BASE}/client/assets/${name}`,
      readFileSync(new URL(name, CLIENT_ASSETS_DIR), 'utf8'),
    );
  }
  return assets;
}

const assets = emittedStyleAssets();

/** The marked stylesheet links of a document's head, in order. */
function headStyleLinks(html: string): string[] {
  const headClose = html.indexOf('</head>');
  expect(headClose, 'the response carries a head').toBeGreaterThan(-1);
  const head = html.slice(0, headClose);
  return [...head.matchAll(/<link rel="stylesheet" href="([^"]+)" data-oe-static-styles \/>/g)].map(
    (match) => match[1]!,
  );
}

test('the SSG page declares base-prefixed marked links in its original head', async ({
  request,
}) => {
  const response = await request.get(`${BASE}/`);
  expect(response.status()).toBe(200);
  const html = await response.text();

  const links = headStyleLinks(html);
  // The page's own sheet and the nested light component's sheet (one link
  // each) — the shadow component's sheet is declared inside its DSD template.
  expect(links.length, 'both light sheets are declared in the head').toBeGreaterThanOrEqual(2);
  for (const href of links) {
    expect(href, 'every declared resource carries the configured base').toMatch(
      /^\/sub\/client\/assets\/[0-9a-f]{12}\.css$/,
    );
    expect(assets.has(href), `${href} is an emitted build asset`).toBe(true);
    const asset = await request.get(href);
    expect(asset.status(), `${href} resolves`).toBe(200);
    expect(asset.headers()['content-type'] ?? '').toContain('text/css');
  }
  // Every URL-addressable sheet is external: no framework inline node.
  expect(/<style[^>]*data-oe-static-styles/.test(html)).toBe(false);
  // The shadow sheet rides its own DSD template, base-prefixed like the rest.
  expect(html).toMatch(
    /<subpage-card>[\s\S]*?<link rel="stylesheet" href="\/sub\/client\/assets\/[0-9a-f]{12}\.css" data-oe-static-styles \/>/,
  );
});

// The streamed request-time page was REMOVED with the class lane (F16):
// `renderIntent.stream` is a class-page-only channel, this line's owner retired
// it, and the replacement streaming carrier is scheduled separately. Its two
// assertions — a first flush carrying the original head, and the no-JS computed
// style of the streamed shell — retired with the capability rather than being
// re-pointed at something that no longer exists.

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  test('the base-path pages are styled by their declared links alone', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('load');

    const home = await page.evaluate(() => {
      const note = document.querySelector('subpage-note .subpage-note');
      const document_ = document.querySelector('.subpage-document');
      return {
        note: note ? getComputedStyle(note).color : 'missing',
        document: document_ ? getComputedStyle(document_).color : 'missing',
      };
    });
    expect(home.note, 'the nested light component is styled with no JS').toEqual(
      'rgb(10, 120, 40)',
    );
    expect(home.document).toEqual('rgb(20, 40, 60)');

    // The streamed route's half of this test retired with the capability (see the
    // note where that test was). What remains is the assertion the fixture exists
    // for: a page and its nested light component are BOTH styled from document
    // links alone.
  });
});

/** Read chunks until the accumulated text contains `needle`; return it. */
