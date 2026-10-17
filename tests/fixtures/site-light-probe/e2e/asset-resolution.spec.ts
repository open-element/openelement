/**
 * E2E: component-CSS resource resolution (alpha15 S lane, S-C1.3 follow-up).
 *
 * A component sheet is not a document stylesheet: its bytes are consumed twice —
 * as the emitted `.css` asset a `<link>` points at (the light path) and as the
 * text a constructed `CSSStyleSheet` parses (the shadow path). A relative
 * `url()` or an `@import` left in those bytes resolves against the ASSET's own
 * location, not the authoring file's, so the same CSS that works in dev
 * (`url()` rewritten relative to the source file) breaks in production unless
 * the emitted bytes went through the build's own CSS processing.
 *
 * This spec pins the observable consequence on three engines:
 *
 *   1. the light card's `background-image` resolves to a URL the server serves
 *      (200), and its `@font-face` really loads (`document.fonts.check`);
 *   2. the shadow card's adopted sheet has its `@import` INLINED (the imported
 *      token applies) and its image loads;
 *   3. no emitted asset references a relative path that only existed in the
 *      source tree, and no stylesheet request 404s.
 *
 * Run: pnpm --dir tests/fixtures/site-light-probe run build
 *      pnpm --dir tests/fixtures/site-light-probe run e2e:browsers
 */

import { readdirSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert/strict';
import { expect, test } from '@playwright/test';

const CARD_TAG = 'light-probe-card';
const SHADOW_TAG = 'probe-shadow-card';

const DIST = new URL('../dist/', import.meta.url);
const CLIENT_ASSETS_DIR = new URL('client/assets/', DIST);

interface EmittedAsset {
  href: string;
  css: string;
}

/** Every emitted client stylesheet, keyed by its public href. */
function emittedStyleAssets(): Map<string, EmittedAsset> {
  const assets = new Map<string, EmittedAsset>();
  for (const name of readdirSync(CLIENT_ASSETS_DIR)) {
    if (!name.endsWith('.css')) continue;
    assets.set(`/client/assets/${name}`, {
      href: `/client/assets/${name}`,
      css: readFileSync(new URL(name, CLIENT_ASSETS_DIR), 'utf8'),
    });
  }
  return assets;
}

/** Every emitted non-CSS asset (images, fonts) actually present in the build. */
function emittedResourceFiles(): Set<string> {
  return new Set(readdirSync(CLIENT_ASSETS_DIR).filter((name) => !name.endsWith('.css')));
}

const assets = emittedStyleAssets();
const shadowAsset = [...assets.values()].find((asset) => asset.css.includes('.shadow-card'));

test('every emitted stylesheet references only resolved, served resources', () => {
  assert.ok(assets.size > 0, 'fixture emitted no stylesheets; build first');
  const emitted = emittedResourceFiles();

  for (const asset of assets.values()) {
    // No relative reference survives into an emitted asset: a `url(./x.png)` or
    // a leftover `@import './y.css'` would resolve against /client/assets/.
    assert.equal(
      /url\(\s*['"]?\.{1,2}\//.test(asset.css),
      false,
      `${asset.href} carries a relative url() reference`,
    );
    assert.equal(
      /@import/.test(asset.css),
      false,
      `${asset.href} still carries an unresolved @import`,
    );
    // Every referenced emitted file exists.
    for (const [, url] of asset.css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (url!.startsWith('data:')) continue;
      const name = url!.split('/').pop();
      assert.ok(
        emitted.has(name!),
        `${asset.href} references ${url}, which the build did not emit (have: ${[...emitted].join(', ')})`,
      );
    }
  }
});

test('the shadow sheet inlines its import and keeps one resolved image', () => {
  assert.ok(shadowAsset, 'no emitted stylesheet carries the shadow card rules');
  assert.ok(
    shadowAsset.css.includes('rgb(0,90,90)') || shadowAsset.css.includes('#005a5a'),
    `the imported token is not inlined: ${shadowAsset.css.slice(0, 200)}`,
  );
  assert.match(shadowAsset.css, /url\([^)]*(assets\/|data:)/);
});

test('the light card paints its own asset and loads its own font', async ({ page }) => {
  const failures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/');
  await page.waitForFunction((tag) => customElements.get(tag) !== undefined, CARD_TAG, {
    timeout: 30_000,
  });
  await page.waitForFunction((tag) => customElements.get(tag) !== undefined, SHADOW_TAG, {
    timeout: 30_000,
  });

  const measured = await page.evaluate(
    async ([cardTag]) => {
      const shell = document.querySelector(cardTag)?.querySelector('.card-shell');
      if (!shell) throw new Error('card shell missing');
      const background = getComputedStyle(shell).backgroundImage;
      const url = /url\(["']?(.*?)["']?\)/.exec(background)?.[1] ?? '';
      const fetched = url.startsWith('data:')
        ? { status: 200, type: 'data:' }
        : await fetch(url).then((response) => ({
            status: response.status,
            type: response.headers.get('content-type') ?? '',
          }));
      return {
        background,
        url,
        fetched,
        fontLoaded: document.fonts.check('16px ProbeCard'),
        fontFamily: getComputedStyle(shell.querySelector('.card-mark')!).fontFamily,
      };
    },
    [CARD_TAG],
  );

  expect(measured.url, `computed background-image: ${measured.background}`).not.toBe('');
  expect(measured.fetched.status, `the painted asset ${measured.url} must be served`).toBe(200);
  expect(measured.fontFamily, 'the authored family reaches the element').toContain('ProbeCard');
  expect(measured.fontLoaded, `the @font-face file must load (${measured.url})`).toBe(true);
  expect(failures, 'no stylesheet or asset request may fail').toEqual([]);
});

test('the shadow card parses an inlined import and a resolved image', async ({ page }) => {
  const failures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/');
  await page.waitForFunction((tag) => customElements.get(tag) !== undefined, SHADOW_TAG, {
    timeout: 30_000,
  });

  const measured = await page.evaluate(
    async ([shadowTag]) => {
      const host = document.querySelector(shadowTag)!;
      const root = host.shadowRoot;
      if (!root) throw new Error('shadow root missing');
      // The shadow sheet's resource, as the server-declared link delivers it.
      const link = root.querySelector('link[data-oe-static-styles]');
      const href = link?.getAttribute('href') ?? '';
      const text = await fetch(href).then((response) => response.text());
      // The client consumes the SAME bytes through a constructed sheet — the
      // operation a `@import` or an unresolved url() makes impossible.
      const sheet = new CSSStyleSheet();
      let constructError = '';
      try {
        sheet.replaceSync(text);
      } catch (error) {
        constructError = String(error);
      }
      const importedRule = [...sheet.cssRules].find((rule) =>
        rule.cssText.includes('--probe-shadow-imported-token'),
      );
      const imageUrl = /url\(([^)]+)\)/.exec(text.replace(/^[\s\S]*?\.shadow-card/, ''))?.[1] ?? '';
      const card = root.querySelector('.shadow-card');
      if (!card) throw new Error('shadow card missing');
      const imported = root.querySelector('.probe-shadow-imported');
      return {
        href,
        constructError,
        importedRule: importedRule?.cssText.slice(0, 80) ?? '',
        sheets: sheet.cssRules.length,
        imageUrl: imageUrl.replace(/["']/g, ''),
        borderColor: getComputedStyle(card).borderColor,
        importedColor: imported ? getComputedStyle(imported).color : 'missing',
      };
    },
    [SHADOW_TAG],
  );

  expect(measured.href, 'the shadow root declares its sheet resource').not.toBe('');
  expect(measured.constructError, 'a constructed sheet must accept the emitted bytes').toBe('');
  expect(measured.sheets, 'the emitted bytes parsed into rules').toBeGreaterThan(0);
  expect(measured.importedRule, 'the imported file is inlined, not left as an @import').not.toBe(
    '',
  );
  // The imported file's token reaches the shadow tree through the link too.
  expect(measured.borderColor, 'the imported custom property applies').toBe('rgb(0, 90, 90)');
  expect(measured.importedColor, 'the imported rule applies inside the shadow tree').toBe(
    'rgb(120, 60, 0)',
  );
  expect(measured.imageUrl, 'the shadow sheet names a resolved asset').toContain('/assets/');
  expect(failures, 'no stylesheet or asset request may fail').toEqual([]);
});

test.describe('resolved resources without client JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the server-declared sheets name served assets for the first paint', async ({ page }) => {
    const failures: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    await page.goto('/');

    const measured = await page.evaluate(
      ([cardTag, shadowTag]) => {
        const shell = document.querySelector(cardTag)?.querySelector('.card-shell');
        const root = document.querySelector(shadowTag)?.shadowRoot;
        const shadowCard = root?.querySelector('.shadow-card');
        return {
          lightBackground: shell ? getComputedStyle(shell).backgroundImage : 'missing',
          lightFont: shell ? getComputedStyle(shell.querySelector('.card-mark')!).fontFamily : '',
          shadowBackground: shadowCard ? getComputedStyle(shadowCard).backgroundImage : 'missing',
          shadowBorder: shadowCard ? getComputedStyle(shadowCard).borderColor : 'missing',
          shadowImported: root?.querySelector('.probe-shadow-imported') !== null,
        };
      },
      [CARD_TAG, SHADOW_TAG] as const,
    );

    // The paint happens on the first response: every URL the server wrote into
    // the emitted sheets is the emitted asset, both inside a shadow tree (the
    // DSD link) and in the document.
    expect(measured.lightBackground).toContain('/assets/');
    expect(measured.lightFont).toContain('ProbeCard');
    expect(measured.shadowBackground).toContain('/assets/');
    expect(measured.shadowBorder, 'the inlined import applies without JS').toBe('rgb(0, 90, 90)');
    expect(measured.shadowImported, 'the imported class reaches the DSD-rendered tree').toBe(true);
    expect(failures, 'no stylesheet or asset request may fail').toEqual([]);
  });
});
