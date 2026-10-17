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

// The webServer port comes from the same env knob the Playwright config reads;
// the streaming read needs Node's own fetch (Playwright's `request` fixture
// buffers a body), so the origin is built here.
const ORIGIN = `http://127.0.0.1:${process.env.BASE_PATH_E2E_PORT ?? 4181}`;

test('the streamed request-time head is original, live and base-prefixed', async () => {
  const response = await fetch(`${ORIGIN}${BASE}/live?delay=400`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type') ?? '').toContain('text/html');
  // Streaming evidence: the document is sent without a content-length.
  expect(response.headers.get('content-length'), 'a streamed document is not length-prefixed').toBe(
    null,
  );

  // Read the response as it arrives: the first flush must already carry the
  // complete head (with the marked links) — the streamed document's head is
  // the ORIGINAL head, never a late append after the body started.
  const reader = response.body!.getReader();
  const firstChunk = await waitForFirstChunkContaining(reader, '</head>');
  const links = headStyleLinks(firstChunk);
  expect(links.length, 'the streamed head declares the light sheet link').toBeGreaterThanOrEqual(1);
  for (const href of links) {
    expect(href, 'the streamed head link carries the base').toMatch(
      /^\/sub\/client\/assets\/[0-9a-f]{12}\.css$/,
    );
  }
  expect(
    firstChunk.includes('deferred content resolved'),
    'the deferred frame is NOT part of the first flush',
  ).toBe(false);
  expect(/<style[^>]*data-oe-static-styles/.test(firstChunk)).toBe(false);
  // The shell of the streamed document (its rendered tree) is part of that
  // same flush: head + shell first, deferred frames later.
  expect(firstChunk).toContain('subpage-live');

  // The rendered document completes with the deferred content in a later frame.
  const rest = await drain(reader);
  expect(rest).toContain('deferred content resolved');
  expect(rest).toContain('</html>');
});

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

    await page.goto(`${BASE}/live`);
    await page.waitForLoadState('load');
    const live = await page.evaluate(() => {
      const shell = document.querySelector('subpage-live .subpage-live');
      return { color: shell ? getComputedStyle(shell).color : 'missing' };
    });
    expect(live.color, 'the streamed page is styled with no JS').toEqual('rgb(70, 20, 120)');
    // The deferred field's frame is inert without a client runtime, so the
    // server ships its no-JS twin beside it (the frame's <noscript>; the HTTP
    // test above asserts that twin's content). Assert the delivery shape here:
    // the twin is in the parsed document — a JS-disabled page must not depend
    // on the frame being applied.
    await expect(page.locator('noscript')).toHaveCount(1);
  });
});

/** Read chunks until the accumulated text contains `needle`; return it. */
async function waitForFirstChunkContaining(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for (let i = 0; i < 200; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.includes(needle)) return text;
  }
  throw new Error(`the stream never carried ${needle} (read ${text.length} chars)`);
}

/** The remainder of the stream, decoded. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}
