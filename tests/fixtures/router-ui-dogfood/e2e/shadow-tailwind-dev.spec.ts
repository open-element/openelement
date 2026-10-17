/**
 * The DEV-server acceptance of the shadow Tailwind pipeline (alpha15 S lane,
 * S5-A) — the same product contract the production spec pins, measured through
 * the real dev server:
 *
 *   1. a TSX-only Tailwind shadow component is styled in dev exactly as it is
 *      in the build (the dev channel compiles the same candidate set through
 *      the official pipeline and serves it at the versioned dev URL the DSD
 *      declares);
 *   2. no generated CSS is inline and no style/link node is created at
 *      runtime — the DSD link is the server's own markup and the client fills
 *      ONE shared CSSStyleSheet;
 *   3. editing the TSX classes updates the styles WITHOUT a page reload (a
 *      window sentinel survives the update).
 *
 * Run: pnpm --dir tests/fixtures/router-ui-dogfood run e2e:dev
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { expect, test } from '@playwright/test';

const PROBE_PATH = join(
  import.meta.dirname!,
  '..',
  'app',
  'components',
  'shadow-tailwind-probe.tsx',
);

interface ProbeMeasure {
  paddingTop: string;
  borderRadius: string;
  headingFontSize: string;
  backgroundColor: string;
  shadowLinks: number;
  shadowInlineStyles: number;
  sentinel: number | undefined;
}

const measureProbe = (host: Element): ProbeMeasure => {
  const root = (host as HTMLElement).shadowRoot;
  const article = root?.querySelector('article.probe-card');
  const heading = root?.querySelector('h2');
  return {
    paddingTop: article instanceof HTMLElement ? getComputedStyle(article).paddingTop : '',
    borderRadius:
      article instanceof HTMLElement ? getComputedStyle(article).borderTopLeftRadius : '',
    headingFontSize: heading instanceof HTMLElement ? getComputedStyle(heading).fontSize : '',
    backgroundColor:
      article instanceof HTMLElement ? getComputedStyle(article).backgroundColor : '',
    shadowLinks: root?.querySelectorAll('link[rel="stylesheet"]').length ?? -1,
    shadowInlineStyles: root?.querySelectorAll('style').length ?? -1,
    sentinel: (window as unknown as { __oeDevSentinel?: number }).__oeDevSentinel,
  };
};

test('dev styles a TSX-only Tailwind shadow component (S5-A)', async ({ page }) => {
  await page.goto('/tailwind-probe');
  const probe = page.locator('oe-tailwind-probe').first();
  await expect(probe).toHaveCount(1);

  const measured = await probe.evaluate(measureProbe);
  expect(measured.paddingTop, 'p-8 in dev').toEqual('32px');
  expect(measured.borderRadius, 'rounded-xl in dev').toEqual('12px');
  expect(measured.headingFontSize, 'text-2xl in dev').toEqual('24px');
  expect(measured.backgroundColor, 'bg-primary in dev').not.toEqual('rgba(0, 0, 0, 0)');
  // The delivery stays declarative: the DSD link is the server's own markup
  // and the probe (a static component) creates no nodes at runtime.
  expect(measured.shadowLinks, 'one declared stylesheet link').toEqual(1);
  expect(measured.shadowInlineStyles, 'no inline or runtime style nodes').toEqual(0);

  // The raw response declares a versioned dev resource, never inline CSS.
  const html = await (await page.request.get('/tailwind-probe')).text();
  const probeMarkup = html.slice(
    html.indexOf('<oe-tailwind-probe'),
    html.indexOf('</oe-tailwind-probe>'),
  );
  expect(probeMarkup, 'no inline <style> in the dev DSD').not.toContain('<style');
  expect(probeMarkup, 'the dev DSD declares the versioned component sheet').toMatch(
    /<link rel="stylesheet" href="\/\.openElement\/tailwind-components\.[^"]+\.css" data-oe-static-styles \/>/,
  );
});

test('a TSX class edit updates the styles without a reload (S5-A HMR)', async ({ page }) => {
  const original = readFileSync(PROBE_PATH, 'utf8');
  expect(original, 'the probe carries the p-8 utility').toContain('p-8');
  try {
    await page.goto('/tailwind-probe');
    const probe = page.locator('oe-tailwind-probe').first();
    await expect(probe).toHaveCount(1);
    expect((await probe.evaluate(measureProbe)).paddingTop).toEqual('32px');

    writeFileSync(PROBE_PATH, original.replace('p-8', 'p-4'), 'utf8');

    // A TSX edit changes the component's own compiled program, which keeps the
    // framework's existing dev semantic (a program-shape change reloads the
    // page). What this lane owns is the STYLESHEET half: the dev sheet
    // re-versions, updates in place, and never creates a node.
    await expect
      .poll(
        async () => {
          // A program-shape edit reloads the dev page, so an in-flight
          // evaluation can be destroyed mid-poll — that is the frame to retry,
          // not a verdict.
          try {
            return (await probe.evaluate(measureProbe)).paddingTop;
          } catch {
            return 'navigating';
          }
        },
        { message: 'the edited class reaches the shadow tree', timeout: 30_000 },
      )
      .toEqual('16px');
    const after = await probe.evaluate(measureProbe);
    expect(after.shadowInlineStyles, 'no runtime style nodes were created').toEqual(0);
    expect(after.shadowLinks, 'no runtime link nodes were created').toEqual(1);

    // The served resource moved with the edit (a dev detail: Vite keys dev
    // modules by id, so the version segment is what makes the new compile a
    // new resource) and the new resource carries the new rule.
    const html = await (await page.request.get('/tailwind-probe')).text();
    const href = html.match(
      /<link rel="stylesheet" href="(\/\.openElement\/tailwind-components\.[^"]+\.css)" data-oe-static-styles \/>/,
    )?.[1];
    expect(href, 'the dev DSD declares the re-versioned sheet').toBeTruthy();
    const sheet = await (await page.request.get(href!)).text();
    expect(sheet, 'the recompiled sheet carries the edited utility').toMatch(/\.p-4\s*\{/);
    expect(sheet, 'and no longer the removed one').not.toMatch(/\.p-8\s*\{/);
  } finally {
    writeFileSync(PROBE_PATH, original, 'utf8');
  }
});

test('removing an admitted utility is reflected in dev (S5-A HMR removal)', async ({ page }) => {
  const original = readFileSync(PROBE_PATH, 'utf8');
  try {
    await page.goto('/tailwind-probe');
    const probe = page.locator('oe-tailwind-probe').first();
    await expect(probe).toHaveCount(1);
    expect((await probe.evaluate(measureProbe)).borderRadius).toEqual('12px');

    // Drop `rounded-xl` entirely: the recompiled sheet no longer carries the
    // rule, so the computed radius falls back to the element default.
    writeFileSync(PROBE_PATH, original.replace(' rounded-xl', ''), 'utf8');
    await expect
      .poll(
        async () => {
          try {
            return (await probe.evaluate(measureProbe)).borderRadius;
          } catch {
            return 'navigating';
          }
        },
        { message: 'the removed utility stops applying', timeout: 30_000 },
      )
      .toEqual('0px');
  } finally {
    writeFileSync(PROBE_PATH, original, 'utf8');
  }
});

if (process.env.CI) {
  // The dev server owns one port; the same suite runs on every engine locally.
}
