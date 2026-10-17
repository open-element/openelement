/**
 * S-C1.4 / #1609 — server-only LIGHT DOM CSS on a request-time dynamic route.
 *
 * `/styled/:id` is an ordinary `renderIntent: { mode: 'dynamic' }` route: never
 * prerendered, served by the generated request-time server through the
 * fixture's own `e2e/server.ts` harness. The page and its nested badge are
 * rendered by the server alone — the badge is admitted with
 * `{ hydrate: 'none', ssr: true }`, so no client JavaScript exists for it — and
 * both sheets must be discovered from the server-rendered module graph and
 * delivered as external, content-addressed resources in the ORIGINAL head.
 *
 * The Shadow/DSD path has its own independent control
 * (`shadow-dsd-admission.spec.ts`); this suite deliberately contains no shadow
 * component, so the two delivery paths are proven separately.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert/strict';
import { expect, test } from '@playwright/test';

const PORT = process.env.REQUEST_TIME_E2E_PORT ?? '4180';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DIST = new URL('../dist/', import.meta.url);
const ASSETS = new URL('client/assets/', DIST);

const ROUTE = '/styled/42';
const PAGE_COLOR = 'rgb(10, 10, 10)';
const BADGE_COLOR = 'rgb(0, 110, 90)';
const SHARED_COLOR = 'rgb(20, 40, 60)';

function emittedSheets(): Map<string, string> {
  const sheets = new Map<string, string>();
  for (const name of readdirSync(ASSETS)) {
    if (!name.endsWith('.css')) continue;
    sheets.set(`/client/assets/${name}`, readFileSync(new URL(name, ASSETS), 'utf8'));
  }
  return sheets;
}

const sheets = emittedSheets();

function assetCarrying(needle: string): { href: string; css: string } {
  for (const [href, css] of sheets) if (css.includes(needle)) return { href, css };
  throw new Error(`no emitted sheet carries ${needle} (assets: ${[...sheets.keys()].join(', ')})`);
}

test('both server-only sheets are emitted externally, scoped, with resolved assets', () => {
  const page = assetCarrying('.styled-page');
  const badge = assetCarrying('.styled-badge');
  assert.ok(page.css.startsWith('@scope (styled-page) {'), page.css.slice(0, 60));
  assert.ok(badge.css.startsWith('@scope (styled-badge) {'), badge.css.slice(0, 60));
  expect(new Set([page.href, badge.href]).size, 'two distinct resources').toEqual(2);

  // The shared sheet has exactly ONE home: Vite inlines the import into the
  // sheet that declared it, so the rules are neither duplicated nor lost.
  const sharedHomes = [...sheets.values()].filter((css) =>
    css.includes('.styled-shared{color:#14283c;letter-spacing:2px}'),
  );
  expect(sharedHomes.length, 'the shared rules live in exactly one sheet').toEqual(1);
  expect(sharedHomes[0]).toEqual(page.css);

  // The nested sheet's relative image went through Vite's CSS pipeline: no
  // relative path and no placeholder survives, and the target is an emitted
  // file served from the asset directory.
  assert.equal(/url\(\s*['"]?\.{1,2}\//.test(badge.css), false);
  assert.equal(badge.css.includes('__VITE_ASSET__'), false);
  const imageUrl = /url\(([^)]+)\)/.exec(badge.css)?.[1] ?? '';
  assert.match(imageUrl, /^\/client\/assets\/styled-badge-texture-[\w-]+\.png$/);
  assert.ok(
    readdirSync(ASSETS).some((name) => imageUrl.endsWith(name)),
    `the image target exists (${imageUrl})`,
  );
});

test('the request-time response renders the tree and declares both sheets in the original head', async () => {
  const response = await fetch(`${ORIGIN}${ROUTE}`, { headers: { accept: 'text/html' } });
  expect(response.status).toEqual(200);
  expect(response.headers.get('content-type') ?? '').toContain('text/html');
  const html = await response.text();

  // Real component tree, not a shell: page, nested badge and the parameter.
  expect(html).toContain('<styled-page id-text="id=42"');
  expect(html).toContain('<styled-badge');
  expect(html).toContain('id=42');
  expect(html).toContain('styled-badge');

  // Final HTML ordering: every sheet link is inside the original head.
  const headOpen = html.indexOf('<head');
  const headClose = html.indexOf('</head>');
  const bodyOpen = html.indexOf('<body');
  expect(headClose).toBeGreaterThan(headOpen);
  expect(bodyOpen).toBeGreaterThan(headClose);
  const linkOffsets = [...html.matchAll(/<link rel="stylesheet"/g)].map((m) => m.index!);
  expect(linkOffsets.length, 'both sheets are declared').toBeGreaterThanOrEqual(2);
  for (const offset of linkOffsets) {
    expect(offset).toBeGreaterThan(headOpen);
    expect(offset, 'no stylesheet link after </head>').toBeLessThan(headClose);
  }
  // No framework inline stylesheet anywhere: URL-addressable sheets are links.
  expect(/<style[^>]*data-oe-static-styles/.test(html)).toBe(false);
});

test('the declared resources resolve with CSS, and the page sheet is the emitted one', async () => {
  const response = await fetch(`${ORIGIN}${ROUTE}`, { headers: { accept: 'text/html' } });
  const html = await response.text();
  const declared = [
    ...new Set([...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]!)),
  ];
  for (const href of declared) {
    expect(href).toMatch(/^\/client\/assets\/[0-9a-f]{12}\.css$/);
    const asset = await fetch(`${ORIGIN}${href}`);
    expect(asset.status, `GET ${href}`).toEqual(200);
    expect(asset.headers.get('content-type') ?? '').toContain('text/css');
  }
  const declaredCss = declared.map((href) => sheets.get(href) ?? '').join('\n');
  expect(declaredCss).toContain('.styled-page');
  expect(declaredCss).toContain('.styled-badge');
  expect(declaredCss).toContain('.styled-shared');
});

/** Computed styles of the server-only tree, read without any client script. */
function computedStyles(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const pick = (selector: string, prop: string): string => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).getPropertyValue(prop) : 'missing';
    };
    return {
      page: pick('.styled-page', 'color'),
      param: pick('.styled-page .styled-shared', 'color'),
      badge: pick('.styled-badge', 'color'),
      badgeBackground: pick('.styled-badge', 'background-image'),
    };
  });
}

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  test('the external sheets style the server-only Light tree', async ({ page }) => {
    const failures: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(ROUTE);
    const styles = await computedStyles(page);
    expect(styles.page).toEqual(PAGE_COLOR);
    expect(styles.param, 'the shared sheet applies').toEqual(SHARED_COLOR);
    expect(styles.badge).toEqual(BADGE_COLOR);
    expect(styles.badgeBackground, 'the emitted image URL resolves').toContain('/assets/');
    expect(failures, 'no stylesheet or asset request may fail').toEqual([]);
  });
});
