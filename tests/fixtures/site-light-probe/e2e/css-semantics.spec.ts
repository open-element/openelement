/**
 * E2E: component-CSS semantics after the build's processing (alpha15 S lane,
 * S-C2/S-11).
 *
 * One shadow component's authored sheet carries the constructs a component
 * stylesheet must keep across the pipeline (Vite's CSS processing → the emitted
 * content-addressed asset → the constructed sheet the shadow root parses when
 * the runtime adopts it / the marked link it declares):
 *
 *   1. CSS nesting — `& .nested-target` inside `.nested-owner`;
 *   2. `@keyframes` — the host's animation resolves and runs;
 *   3. `@property` — the registered custom property keeps its typed syntax: an
 *      unset element and an element whose value the syntax rejects both compute
 *      the registered initial value;
 *   4. `:host` and `:host ::slotted(...)` — the slotted light child is styled by
 *      the shadow sheet's `::slotted()` rule ONLY;
 *   5. the boundary holds: the light-DOM twin of the nested selector is not
 *      matched by the shadow sheet, and the emitted asset is not `@scope`-wrapped
 *      (a shadow tree already is the boundary).
 *
 * `@import` and `@font-face` already have their proofs in `asset-resolution.spec.ts`
 * and are deliberately not restated here.
 *
 * Run: pnpm --dir tests/fixtures/site-light-probe run build
 *      pnpm --dir tests/fixtures/site-light-probe run e2e:browsers
 */

import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SEMANTICS_TAG = 'semantics-probe';

const DIST = new URL('../dist/', import.meta.url);
const CLIENT_ASSETS_DIR = new URL('client/assets/', DIST);

/** The emitted asset whose bytes are the semantics sheet (its selectors are unique). */
function semanticsAsset(): string {
  for (const name of readdirSync(CLIENT_ASSETS_DIR)) {
    if (!name.endsWith('.css')) continue;
    const css = readFileSync(new URL(name, CLIENT_ASSETS_DIR), 'utf8');
    if (css.includes('.nested-owner')) return css;
  }
  throw new Error('no emitted stylesheet carries the semantics-probe sheet');
}

const SOURCE_SHEET = readFileSync(
  new URL('../app/islands/semantics-probe.css', import.meta.url),
  'utf8',
);

test('the emitted asset keeps the sheet unscoped and carries its constructs', () => {
  const css = semanticsAsset();
  expect(css.includes('@scope ('), 'a shadow sheet is never scope-wrapped').toBe(false);
  // The registered property survives as a real at-rule with its descriptors
  // intact — a minifier that dropped `inherits:false` or mangled `syntax`
  // would silently change the property's meaning.
  expect(css.replace(/\s+/g, '')).toContain(
    '@property--probe-ratio{syntax:"<number>";inherits:false;initial-value:.5}',
  );
  // The authored constructs are present in substance (minified spelling; the
  // descendants' combinators stay whitespace-separated, so these match as-is).
  expect(css).toContain('@keyframes probe-pulse');
  expect(css).toMatch(/\.nested-owner \.nested-target\s*\{/);
  expect(css).toMatch(/:host ::slotted\(\.probe-slot\)\s*\{/);
  // Provenance sanity: the authored source declares all four probe mechanisms.
  for (const marker of [
    '@property --probe-ratio',
    '@keyframes probe-pulse',
    '::slotted(.probe-slot)',
  ]) {
    expect(SOURCE_SHEET, `the fixture sheet declares ${marker}`).toContain(marker);
  }
});

test('nesting, ::slotted and the shadow boundary hold', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const measured = await page.evaluate(
    ([tag]) => {
      const host = document.querySelector(tag);
      const root = host?.shadowRoot;
      if (!root) throw new Error('the semantics probe has no shadow root');
      const nested = root.querySelector('.nested-target');
      const owner = root.querySelector('.nested-owner');
      const slotted = document.querySelector(`${tag} .probe-slot`);
      const twin = document.querySelector('p.nested-target');
      const read = (element: Element | null): string =>
        element ? getComputedStyle(element).color : 'missing';
      return {
        nested: read(nested),
        owner: read(owner),
        slotted: read(slotted),
        twin: read(twin),
        hostDisplay: host ? getComputedStyle(host).display : 'missing',
      };
    },
    [SEMANTICS_TAG] as const,
  );

  // Nesting flattened to the authored meaning.
  expect(measured.owner, 'the owner rule applies').toEqual('rgb(9, 8, 7)');
  expect(measured.nested, 'the nested & rule applies inside the shadow tree').toEqual(
    'rgb(4, 5, 6)',
  );
  // `::slotted()` reaches the page-authored light child...
  expect(measured.slotted, 'the ::slotted rule styles the slotted light child').toEqual(
    'rgb(1, 2, 3)',
  );
  // ...and the shadow sheet stops at the boundary.
  expect(measured.twin, 'the light-DOM twin is not matched by the shadow sheet').not.toEqual(
    'rgb(4, 5, 6)',
  );
  expect(measured.hostDisplay, 'the :host rule applies').toEqual('block');
});

test('the keyframe animation resolves and runs', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const animation = await page.evaluate(
    ([tag]) => {
      const host = document.querySelector(tag);
      if (!host) throw new Error('missing semantics probe');
      const animations = (
        host as HTMLElement & { getAnimations?: () => Animation[] }
      ).getAnimations?.();
      return {
        name: getComputedStyle(host).animationName,
        playState: animations?.[0]?.playState ?? 'none',
      };
    },
    [SEMANTICS_TAG] as const,
  );

  expect(animation.name, 'the @keyframes rule resolves by name').toEqual('probe-pulse');
  expect(animation.playState, 'the host animation is running').toEqual('running');
});

test('the registered custom property keeps its typed syntax in the document scope', async ({
  page,
}) => {
  // The LIGHT root's sheet becomes a document `<link>`, and `@property`
  // registration is observable in the document scope in every engine — even
  // from inside the generated `@scope (light-probe-page)` wrapper (measured on
  // all three engines; the shadow-scope half is pinned by the next test).
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const measured = await page.evaluate(() => {
    const read = (selector: string): number =>
      Number.parseFloat(
        getComputedStyle(document.querySelector(selector)!).getPropertyValue('--probe-doc-ratio'),
      );
    return {
      unset: read('.doc-ratio-default'),
      invalid: read('.doc-ratio-invalid'),
    };
  });

  expect(
    measured.unset,
    'inherits:false + initial-value: an element inside the scope computes the initial value',
  ).toEqual(0.5);
  expect(
    measured.invalid,
    'a value the registered syntax rejects falls back to the initial value',
  ).toEqual(0.5);
});

test('a shadow-tree sheet does not register its @property (platform boundary)', async ({
  page,
}) => {
  // Measured boundary, deliberately pinned: `@property` registers from DOCUMENT
  // sheets only. Inside a shadow-tree sheet — whether the DSD's own link or an
  // adopted constructed sheet — every configured engine keeps the property
  // UNREGISTERED, so its value is the declared token text and it inherits like
  // any plain custom property. The build still carries the rule into the
  // emitted asset (asserted above); a shadow component that needs a registered
  // property must register it from a document-scope sheet.
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const measured = await page.evaluate(
    ([tag]) => {
      const root = document.querySelector(tag)?.shadowRoot;
      if (!root) throw new Error('the semantics probe has no shadow root');
      const read = (selector: string): string => {
        const element = root.querySelector(selector);
        return element
          ? getComputedStyle(element).getPropertyValue('--probe-ratio').trim()
          : 'missing';
      };
      return {
        host: getComputedStyle(root.host).getPropertyValue('--probe-ratio').trim(),
        unset: read('.ratio-default'),
        invalid: read('.ratio-invalid'),
      };
    },
    [SEMANTICS_TAG] as const,
  );

  expect(Number.parseFloat(measured.host), 'the :host declaration applies').toEqual(0.25);
  expect(
    Number.parseFloat(measured.unset),
    'unregistered: the value inherits into the subtree (no initial-value fallback)',
  ).toEqual(0.25);
  expect(
    measured.invalid,
    'unregistered: the syntax rejects nothing, so the token text is kept',
  ).toEqual('not-a-number');
});
