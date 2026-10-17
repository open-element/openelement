/**
 * E2E: light-root CSS delivery — build-time scoping, document links, native
 * adoption (alpha15 S lane, S-C1.2).
 *
 * The fixture page is a light-root component whose nested content is a second
 * light-root island type (`open-light-probe`) and TWO instances of a third
 * (`light-probe-card`). All three have authored CSS; all three reuse the
 * `.probe-shared` class name, which an unrelated document element also uses.
 *
 * What this suite proves on real browsers (Chromium, Firefox, WebKit):
 *
 *   1. every light-root component with an emitted asset is declared by a
 *      marked `<link rel="stylesheet">` in the document head, and the emitted
 *      asset carries the build-time `@scope (<tag>)` wrapper;
 *   2. no runtime style/link node exists and no client bundle contains the
 *      retired runtime-scoping form or the retired sink's marker — the
 *      JS-disabled document is styled by the head links alone;
 *   3. scoping is isolation: two component types and the unrelated document
 *      element keep three different colors for one class name;
 *   4. N instances of one component share ONE emitted stylesheet (one link);
 *   5. SSR→CSR does not double-deliver: while the head link exists the client
 *      adopts nothing, and once the link is gone a reconnect adopts the sheet
 *      (styles never go missing, and adoption stays idempotent);
 *   6. a stylesheet asset that cannot be fetched is REPORTED (fail-closed)
 *      instead of silently injecting an inline fallback.
 *
 * Run: pnpm --dir tests/fixtures/site-light-probe run build
 *      pnpm --dir tests/fixtures/site-light-probe run e2e:browsers
 */

import { readFileSync, readdirSync } from 'node:fs';
import { strict as assert } from 'node:assert/strict';
import { expect, test } from '@playwright/test';

const PROBE_TAG = 'open-light-probe';
const CARD_TAG = 'light-probe-card';
const PAGE_TAG = 'light-probe-page';

/** `.probe-shared` in each of the three scopes that declare it. */
const PROBE_COLOR = 'rgb(200, 0, 0)'; // open-light-probe.css
const CARD_COLOR = 'rgb(0, 128, 0)'; // light-probe-card.css
const DOCUMENT_COLOR = 'rgb(64, 64, 64)'; // page-light-probe.css
/** `.probe-count`, declared by the probe island only. */
const PROBE_COUNT_COLOR = 'rgb(0, 0, 200)';

const DIST = new URL('../dist/', import.meta.url);
const CLIENT_ASSETS_DIR = new URL('client/assets/', DIST);
const RETIRED_SINK_MARKER = 'data-open-element-compiled-style';
/** The form `scopeCompiledLightCss` produced — the runtime must not carry it. */
const RETIRED_RUNTIME_SCOPE = '@scope (';

function readDist(relative: string): string {
  return readFileSync(new URL(relative, DIST), 'utf8');
}

/** Every emitted client stylesheet, keyed by its public href. */
function emittedStyleAssets(): Map<string, string> {
  const assets = new Map<string, string>();
  for (const name of readdirSync(CLIENT_ASSETS_DIR)) {
    if (!name.endsWith('.css')) continue;
    assets.set(`/client/assets/${name}`, readFileSync(new URL(name, CLIENT_ASSETS_DIR), 'utf8'));
  }
  return assets;
}

/** The emitted asset whose bytes are scoped to `tag`, as the page declares it. */
function assetFor(assets: Map<string, string>, tag: string): { href: string; css: string } {
  for (const [href, css] of assets) {
    if (css.startsWith(`@scope (${tag}) {`)) return { href, css };
  }
  throw new Error(`no emitted stylesheet is scoped to <${tag}>`);
}

const assets = emittedStyleAssets();
const probeAsset = assetFor(assets, PROBE_TAG);
const cardAsset = assetFor(assets, CARD_TAG);
/**
 * The PAGE component is rendered by the server alone: no island imports it, so
 * before S-C1.4 its sheet had no emitted asset and fell back to a
 * framework-generated inline `<style>` inside the page element. It now travels
 * the same protocol as every other component sheet (#1609).
 */
const pageAsset = assetFor(assets, PAGE_TAG);

/** Read one computed style value of the first match inside `host`. */
function computedStyle(
  page: import('@playwright/test').Page,
  host: string,
  selector: string,
  property: string,
): Promise<string> {
  return page.evaluate(
    ([hostTag, inner, prop]) => {
      const scope = document.querySelector(hostTag);
      const element = scope?.querySelector(inner);
      if (!element) throw new Error(`missing ${hostTag} ${inner}`);
      return getComputedStyle(element).getPropertyValue(prop);
    },
    [host, selector, property] as const,
  );
}

/** The `color` of the first match inside `host`. */
function computedColor(
  page: import('@playwright/test').Page,
  host: string,
  selector: string,
): Promise<string> {
  return computedStyle(page, host, selector, 'color');
}

test('the build emits content-addressed scoped assets and declares them in the document head', () => {
  const html = readDist('index.html');

  const head = html.slice(0, html.indexOf('</head>'));
  for (const asset of [probeAsset, cardAsset, pageAsset]) {
    // Parser-visible, marked, exactly once IN THE HEAD — the document is the
    // delivery for document-level light roots. The same asset may also be
    // declared inside a shadow template: content inside a shadow tree is
    // reached only from there, and that is the sibling assertion below.
    assert.equal(
      head.split(`href="${asset.href}" data-oe-static-styles`).length - 1,
      1,
      `${asset.href} must be declared exactly once in the document head`,
    );
  }
  // Scoped at build time: the asset the browser parses IS the scoped sheet.
  assert.ok(probeAsset.css.includes(`@scope (${PROBE_TAG}) {`));
  assert.ok(cardAsset.css.includes(`:scope{display:block}`));

  // The retired runtime sink left no trace in the document, and NO
  // framework-generated inline stylesheet exists: every component sheet,
  // server-only pages included, is an external resource declared in the head.
  assert.equal(html.includes(RETIRED_SINK_MARKER), false);
  assert.equal(
    /<style[^>]*data-oe-static-styles[^>]*>/.test(html),
    false,
    'no framework inline stylesheet may remain (the server-only fallback is retired)',
  );
  assert.ok(pageAsset.css.startsWith(`@scope (${PAGE_TAG}) {`));
});

test('no client bundle carries runtime scoping or the retired style sink', () => {
  const islandsDir = new URL('client/islands/', DIST);
  const bundles = readdirSync(islandsDir).filter((name) => name.endsWith('.js'));
  assert.ok(bundles.length > 0, 'fixture client bundles missing; build first');
  for (const name of bundles) {
    const code = readFileSync(new URL(name, islandsDir), 'utf8');
    assert.equal(
      code.includes(RETIRED_SINK_MARKER),
      false,
      `${name} carries the retired sink marker`,
    );
    assert.equal(
      code.includes(RETIRED_RUNTIME_SCOPE),
      false,
      `${name} carries runtime @scope generation`,
    );
  }
});

test('a light root inside a shadow template is declared, and styled, in THAT tree', async ({
  page,
}) => {
  // Audit C: the delivery root is the tree the content lands in. A document
  // stylesheet never matches elements inside a shadow tree, so a nested light
  // root must be reached from its ancestor's template — and the sheet it
  // declares there is the SAME marked link shape the document head uses.
  await page.goto('/');
  const observed = await page.evaluate(() => {
    const host = document.querySelector('probe-shadow-card');
    const shadow = host?.shadowRoot ?? null;
    const nested = shadow?.querySelector('light-probe-card.nested-light-card') ?? null;
    const inner = nested?.querySelector('.probe-shared') ?? null;
    return {
      hasShadow: shadow !== null,
      hasNested: nested !== null,
      nestedRendered: nested === null ? null : nested.getAttribute('count'),
      nestedColor: inner === null ? null : getComputedStyle(inner).color,
      shadowLinks:
        shadow === null
          ? 0
          : shadow.querySelectorAll('link[data-oe-static-styles][rel="stylesheet"]').length,
    };
  });
  assert.equal(observed.hasShadow, true, 'the shadow component rendered its DSD');
  assert.equal(observed.hasNested, true, 'the light-root child is inside the shadow tree');
  assert.ok(observed.shadowLinks > 0, 'the shadow template declares the sheets its content needs');
  assert.equal(
    observed.nestedColor,
    CARD_COLOR,
    'the scoped light sheet matched content inside the shadow tree',
  );
});

test('two component types and an unrelated element keep their own rules', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction((tag) => customElements.get(tag) !== undefined, CARD_TAG, {
    timeout: 30_000,
  });

  expect(await computedColor(page, CARD_TAG, '.probe-shared')).toBe(CARD_COLOR);
  expect(await computedColor(page, PROBE_TAG, '.probe-shared')).toBe(PROBE_COLOR);
  // The card's own sheet reaches the card (positive control for the isolation
  // claim above), and the probe island's class-only rule never does.
  expect(await computedStyle(page, CARD_TAG, '.card-mark', 'font-style')).toBe('italic');
  expect(await computedStyle(page, CARD_TAG, '.card-mark', 'color')).not.toBe(PROBE_COUNT_COLOR);
  expect(await computedColor(page, PROBE_TAG, '.probe-count')).toBe(PROBE_COUNT_COLOR);
  // The unrelated document element is NOT inside any component's scope.
  expect(await computedColor(page, PAGE_TAG, 'p.document-probe')).toBe(DOCUMENT_COLOR);
});

test('upgraded islands create no style node and do not re-deliver the linked sheet', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction((tag) => customElements.get(tag) !== undefined, PROBE_TAG, {
    timeout: 30_000,
  });

  expect(
    await page.evaluate(
      () => document.querySelectorAll('style[data-open-element-compiled-style]').length,
    ),
    'no runtime style node exists',
  ).toBe(0);
  // Both component types are delivered by their head links, so the document
  // adopts nothing: one resource, one delivery, no duplicate application.
  expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(0);
  expect(await computedColor(page, CARD_TAG, '.probe-shared')).toBe(CARD_COLOR);
});

test('every emitted sheet is served under the immutable cache contract (S-C2/S-14)', async ({
  page,
}) => {
  // Duplicate-delivery audit. The sheet object a client adapter hands back is
  // created SYNCHRONOUSLY (the WebKit race fix), so its fetch can coincide with
  // the declared link's own parse: the resource may legitimately be requested
  // twice — but it is CONTENT-ADDRESSED, so both the delivery and the cache
  // contract must make the second one free. A hashed `.css` asset served with
  // `no-cache` would pay a network round trip per coincidence, which is the
  // defect this pins (the static-serve immutable rule must recognize the style
  // assets' name shape).
  const responses: Array<{ href: string; cacheControl: string }> = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/client/assets/') && url.pathname.endsWith('.css')) {
      responses.push({
        href: url.pathname,
        cacheControl: response.headers()['cache-control'] ?? '',
      });
    }
  });
  await page.goto('/');
  await page.waitForLoadState('load');
  expect(responses.length, 'the page loads its declared sheets').toBeGreaterThan(0);
  for (const { href, cacheControl } of responses) {
    expect(href, 'every requested stylesheet is a content-addressed asset').toMatch(
      /^\/client\/assets\/[0-9a-f]{12}\.css$/,
    );
    expect(cacheControl, `${href} must be immutable`).toContain('immutable');
    expect(cacheControl, `${href} must not require revalidation`).not.toContain('no-cache');
  }
});

test('once the link is gone a reconnect adopts the sheet, keeping styles and adding no node', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction((tag) => customElements.get(tag) !== undefined, CARD_TAG, {
    timeout: 30_000,
  });

  const adoptedAfterReconnect = await page.evaluate((cardHref) => {
    for (const link of document.querySelectorAll('link[data-oe-static-styles]')) {
      if (link.getAttribute('href') === cardHref) link.remove();
    }
    const host = document.querySelector('light-probe-card');
    if (!host) throw new Error('card host missing');
    const parent = host.parentNode;
    if (!parent) throw new Error('card host detached');
    host.remove();
    parent.appendChild(host);
    return { adopted: document.adoptedStyleSheets.length };
  }, cardAsset.href);

  expect(adoptedAfterReconnect.adopted, 'the reconnect adopts the sheet object').toBe(1);
  expect(await computedColor(page, CARD_TAG, '.probe-shared')).toBe(CARD_COLOR);

  // Idempotent: another reconnect adds nothing twice, and still no node.
  const afterSecond = await page.evaluate(() => {
    const host = document.querySelector('light-probe-card');
    const parent = host?.parentNode;
    if (!host || !parent) throw new Error('card host missing');
    host.remove();
    parent.appendChild(host);
    return {
      adopted: document.adoptedStyleSheets.length,
      nodes: document.querySelectorAll('style[data-open-element-compiled-style]').length,
    };
  });
  expect(afterSecond.adopted).toBe(1);
  expect(afterSecond.nodes).toBe(0);
  expect(await computedColor(page, CARD_TAG, '.probe-shared')).toBe(CARD_COLOR);
});

test('an unfetchable stylesheet asset is reported, never replaced by an inline fallback', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route(`**${cardAsset.href}`, (route) => route.abort());

  await page.goto('/');
  await page.waitForFunction((tag) => customElements.get(tag) !== undefined, CARD_TAG, {
    timeout: 30_000,
  });

  await page.evaluate((cardHref) => {
    for (const link of document.querySelectorAll('link[data-oe-static-styles]')) {
      if (link.getAttribute('href') === cardHref) link.remove();
    }
    const host = document.querySelector('light-probe-card');
    const parent = host?.parentNode;
    if (!host || !parent) throw new Error('card host missing');
    host.remove();
    parent.appendChild(host);
  }, cardAsset.href);

  await expect
    .poll(() => errors.join('\n'), { timeout: 30_000 })
    .toContain('a component style sheet could not be loaded');
  expect(
    await page.evaluate(
      () => document.querySelectorAll('style[data-open-element-compiled-style]').length,
    ),
    'the failure is reported, not papered over with an inline node',
  ).toBe(0);
  expect(await page.evaluate(() => document.querySelector('light-probe-card') !== null)).toBe(true);
});

test.describe('computed styles without client JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the server-declared stylesheets style the light DOM with no JS at all', async ({
    page,
  }) => {
    await page.goto('/');

    expect(await computedColor(page, CARD_TAG, '.probe-shared')).toBe(CARD_COLOR);
    expect(await computedColor(page, PROBE_TAG, '.probe-shared')).toBe(PROBE_COLOR);
    expect(await computedColor(page, PAGE_TAG, 'p.document-probe')).toBe(DOCUMENT_COLOR);
    expect(await computedColor(page, PROBE_TAG, '.probe-count')).toBe(PROBE_COUNT_COLOR);
  });
});
