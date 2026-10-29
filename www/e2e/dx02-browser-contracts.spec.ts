/**
 * DX-02 browser automation — the site-level timing / 390px / keyboard contracts.
 *
 * This file exists because the alpha15 review's manual browser checklist (timing,
 * morph, preserve, 390px, keyboard) had no repeatable automated counterpart on
 * the Site. Coverage that already exists and is deliberately NOT repeated here:
 *   - 390px long-form overflow: `page-structure.spec.ts` ("long-form pages do not
 *     scroll horizontally at 390px");
 *   - mobile header disclosure by pointer: `site-shell-behaviors.spec.ts`;
 *   - keyboard focus rings on the UI components of `/contributing`:
 *     `ui-behaviour-matrix.spec.ts` ("focus-visible rings on a real keyboard
 *     path");
 *   - scroll/timing of the cinematic hero scenes and marquee:
 *     `cinematic-home.spec.ts`;
 *   - theme toggle semantics: `theme-system.spec.ts`;
 *   - lazy island chunk gating: `search.spec.ts`.
 *
 * Gaps this file adds:
 *   1. TIMING — the document is complete and usable with every island chunk
 *      blocked, so island load is observed as a timing boundary, not a
 *      correctness dependency;
 *   2. 390px — the home page does not scroll horizontally and its heading stays
 *      inside the viewport at 390x844;
 *   3. KEYBOARD — the real Tab path through the site chrome paints a visible,
 *      unclipped ring at every stop, and the skip link activates;
 *   4. KEYBOARD + 390px — the mobile documentation disclosure opens from the
 *      keyboard and its links are reachable and activatable.
 *
 * Automation is NOT screen-reader testing. These assertions are DOM/geometry/
 * computed-style facts; screen-reader verification stays manual (see
 * `docs/release/evidence/alpha15/dx02-browser-automation.md`). The morph/
 * preserve half of the same checklist lives in the native fixture's
 * `e2e/dx02-morph-preserve.spec.ts`.
 *
 * Engine capability note: the macOS WebKit build's default Tab path visits only
 * `[tabindex]` elements, so it cannot reach authored links. That row records an
 * `N/A` annotation plus the capability assertion (same convention as
 * `ui-behaviour-matrix.spec.ts`) instead of pretending to measure a path the
 * engine does not have. Linux WebKit (the CI engine) does reach links, so the
 * CI run asserts the full path.
 */
import { expect, type Page, test } from '@playwright/test';

interface FocusStop {
  key: string;
  label: string;
  href: string | null;
  outlineStyle: string;
  outlineWidth: number;
  outlineOffset: number;
  outlineColor: string;
  clippedBy: string | null;
  offscreen: boolean;
  inHeader: boolean;
}

/**
 * Measure the focused element's ring from its geometry (the probe shape
 * `ui-behaviour-matrix.spec.ts` established): the tree is walked through open
 * shadow roots, and the ring box is intersected with every scroll-clipping
 * ancestor across shadow boundaries. The additions here are `label`, `href`
 * and `inHeader`, so this file can name and scope the stops the real Tab path
 * reached.
 */
const FOCUS_PROBE = `(() => {
  let element = document.activeElement;
  while (element && element.shadowRoot && element.shadowRoot.activeElement) {
    element = element.shadowRoot.activeElement;
  }
  if (!element) return null;
  const style = getComputedStyle(element);
  const width = Number.parseFloat(style.outlineWidth) || 0;
  const offset = Number.parseFloat(style.outlineOffset) || 0;
  const rect = element.getBoundingClientRect();
  const ring = {
    left: rect.left - width - offset,
    top: rect.top - width - offset,
    right: rect.right + width + offset,
    bottom: rect.bottom + width + offset,
  };
  const parentOf = (node) => {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const describe = (node) =>
    node.tagName.toLowerCase() +
    (node.getAttribute('part') ? '::part(' + node.getAttribute('part') + ')' : '');
  let clippedBy = null;
  for (let node = parentOf(element); node && clippedBy === null; node = parentOf(node)) {
    const owner = getComputedStyle(node);
    const clipsX = owner.overflowX !== 'visible';
    const clipsY = owner.overflowY !== 'visible';
    if (!clipsX && !clipsY) continue;
    const box = node.getBoundingClientRect();
    const leavesX = clipsX && (ring.left < box.left || ring.right > box.right);
    const leavesY = clipsY && (ring.top < box.top || ring.bottom > box.bottom);
    if (leavesX || leavesY) {
      clippedBy = describe(node) + ' {' + owner.overflowX + '/' + owner.overflowY + '}';
    }
  }
  let inHeader = false;
  for (let node = element; node; node = parentOf(node)) {
    if (node.tagName === 'HEADER') {
      inHeader = true;
      break;
    }
  }
  const label =
    element.getAttribute('aria-label') ||
    (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  return {
    key: describe(element),
    label,
    href: element instanceof HTMLAnchorElement ? element.getAttribute('href') : null,
    outlineStyle: style.outlineStyle,
    outlineWidth: width,
    outlineOffset: offset,
    outlineColor: style.outlineColor,
    clippedBy,
    offscreen:
      ring.bottom <= 0 || ring.top >= innerHeight || ring.right <= 0 || ring.left >= innerWidth,
    inHeader,
  };
})()`;

/** Press Tab once and measure the stop the engine actually moved focus to. */
async function pressTab(page: Page): Promise<FocusStop | null> {
  await page.keyboard.press('Tab');
  return (await page.evaluate(FOCUS_PROBE)) as FocusStop | null;
}

/** Press Tab up to `limit` times until the focused stop matches `predicate`. */
async function tabUntil(
  page: Page,
  predicate: (stop: FocusStop) => boolean,
  limit = 30,
): Promise<FocusStop> {
  for (let index = 0; index < limit; index += 1) {
    const stop = await pressTab(page);
    if (stop && predicate(stop)) return stop;
  }
  throw new Error(`the Tab path did not reach the expected stop within ${limit} presses`);
}

/**
 * Does this engine's default Tab path reach authored links? The macOS WebKit
 * build visits only `[tabindex]` elements (and, with a disclosure, its
 * summary), never an `<a>`; Linux WebKit — the CI engine — reaches links.
 * The rows below are N/A on the former and asserted in full on the latter,
 * the `ui-behaviour-matrix.spec.ts` convention.
 */
async function walkTabPathForLinks(
  page: Page,
  presses = 12,
): Promise<{ reached: boolean; stops: FocusStop[] }> {
  const stops: FocusStop[] = [];
  for (let index = 0; index < presses; index += 1) {
    const stop = await pressTab(page);
    if (!stop) continue;
    stops.push(stop);
    if (stop.key === 'a') return { reached: true, stops };
  }
  return { reached: false, stops };
}

/** The ring every in-page stop must paint (same bar as ui-behaviour-matrix). */
function expectVisibleRing(stop: FocusStop): void {
  // `auto` is the user agent's own focus ring — the honest indicator a control
  // inside a package component's shadow tree gets where the site baseline
  // cannot reach.
  expect(['solid', 'auto'], `${stop.key} (${stop.label}) paints a visible indicator`).toContain(
    stop.outlineStyle,
  );
  expect(stop.outlineWidth, `${stop.key} (${stop.label}) outline width`).toBeGreaterThanOrEqual(1);
  if (stop.outlineStyle === 'solid') {
    expect(stop.outlineOffset, `${stop.key} outline offset`).toBeGreaterThanOrEqual(0);
    expect(stop.outlineColor, `${stop.key} outline colour`).not.toBe('rgba(0, 0, 0, 0)');
  }
  expect(stop.offscreen, `${stop.key} ring has pixels inside the viewport`).toBe(false);
  expect(stop.clippedBy, `${stop.key} ring is not cut off by a scrolling ancestor`).toBeNull();
}

test.describe('DX-02 timing: the document does not depend on island chunks', () => {
  test('the page is complete and its links usable with every island chunk blocked', async ({
    page,
  }) => {
    const blocked: string[] = [];
    await page.route('**/client/islands/*.js', (route) => {
      blocked.push(route.request().url());
      return route.abort('failed');
    });

    const response = await page.goto('/');
    expect(response?.status(), 'the document itself is served').toBeLessThan(400);
    // The timing contract: island load is about interaction, never about the
    // document. The shell, the heading and the navigation are server-rendered.
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link').first(),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeAttached();
    await expect(page.locator('main#main-content')).toBeAttached();
    expect(
      await page.evaluate(() => document.readyState),
      'the load event fired without waiting on blocked island chunks',
    ).toBe('complete');
    // The interception is real: the client entry + at least one island chunk
    // were requested and blocked.
    expect(blocked.length, `blocked island requests: ${blocked.join(', ')}`).toBeGreaterThanOrEqual(
      2,
    );
  });
});

test.describe('DX-02 390px: viewport behaviour', () => {
  test('home does not scroll horizontally and its heading stays inside 390x844', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const metrics = await page.evaluate(() => {
      const heading = document.querySelector('main h1') ?? document.querySelector('h1');
      const rect = heading?.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        headingLeft: rect?.left ?? -1,
        headingRight: rect?.right ?? -1,
      };
    });
    expect(metrics.clientWidth).toBe(390);
    expect(metrics.documentScrollWidth, 'document scrollWidth at 390px').toBe(390);
    expect(metrics.bodyScrollWidth, 'body scrollWidth at 390px').toBeLessThanOrEqual(390);
    expect(metrics.headingLeft).toBeGreaterThanOrEqual(0);
    expect(metrics.headingRight).toBeLessThanOrEqual(390);

    // The desktop navigation is replaced by the disclosure at this width.
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
    const headerDisclosure = page.locator('header details').first();
    await expect(headerDisclosure).toBeVisible();
    await expect(headerDisclosure.locator('summary')).toBeVisible();
  });

  test('home inner surface does not clip the sources caption at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const metrics = await page.evaluate(() => {
      const root = document.querySelector('.page-home');
      return {
        rootClientWidth: root?.clientWidth ?? -1,
        rootScrollWidth: root?.scrollWidth ?? -1,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });
    // No page-level scrollbar at the 320 floor.
    expect(metrics.documentScrollWidth).toBe(320);
    // The page root clips decorative overflow by design, but its own scroll box
    // must stay flush: the sources caption used to poke 3px past it.
    expect(metrics.rootScrollWidth, '.page-home scrollWidth vs clientWidth at 320px').toBe(
      metrics.rootClientWidth,
    );
  });
});

test.describe('DX-02 keyboard: chrome path', () => {
  test('every chrome stop of the real Tab path paints a visible, unclipped ring', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const capability = await walkTabPathForLinks(page);
    if (!capability.reached) {
      testInfo.annotations.push({
        type: 'N/A',
        description:
          "this engine's default Tab path reaches no authored link (macOS WebKit); the chrome ring row is not measured on it",
      });
      // The capability probe: what this engine CAN do is stated, not traded
      // for a weaker ring assertion. The CI engine (Linux WebKit) reaches
      // links, so the full assertion runs there.
      expect(capability.stops.some((stop) => stop.key === 'a')).toBe(false);
      return;
    }
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Stop at the banner boundary: engine-specific media focus stops below the
    // chrome (Firefox tabs to the hero video) are not site chrome and are
    // outside this row.
    const stops: FocusStop[] = [];
    for (let index = 0; index < 16; index += 1) {
      const stop = await pressTab(page);
      if (!stop) break;
      const isChrome = stop.label === 'Skip to main content' || stop.inHeader;
      if (!isChrome && stops.length >= 6) break;
      if (isChrome) stops.push(stop);
    }
    expect(
      stops.length,
      `chrome Tab path stops: ${stops.map((stop) => stop.label).join(' | ')}`,
    ).toBeGreaterThanOrEqual(6);
    for (const stop of stops) expectVisibleRing(stop);

    // The path reaches the shell controls a reader actually uses; each is
    // identified by its accessible name, not by a class.
    const labels = stops.map((stop) => stop.label);
    expect(labels, `chrome Tab path stops: ${labels.join(' | ')}`).toContain(
      'Skip to main content',
    );
    expect(labels).toContain('openElement');
    expect(labels).toContain('Search');
    expect(labels).toContain('Toggle theme');
    expect(
      stops.filter((stop) => stop.href !== null && stop.href.startsWith('/')).length,
      'the path reaches at least three in-site links',
    ).toBeGreaterThanOrEqual(3);
  });

  test('the skip link moves focus to the main landmark', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const capability = await walkTabPathForLinks(page);
    if (!capability.reached) {
      testInfo.annotations.push({
        type: 'N/A',
        description:
          "this engine's default Tab path reaches no authored link (macOS WebKit); the skip-link row is not measured on it",
      });
      expect(capability.stops.some((stop) => stop.key === 'a')).toBe(false);
      return;
    }
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const first = await tabUntil(page, (stop) => stop.label === 'Skip to main content');
    expect(first.href).toBe('#main-content');
    expectVisibleRing(first);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#main-content');
    expect(
      await page.evaluate(() => document.activeElement?.id),
      'the skip link focuses the main landmark it names',
    ).toBe('main-content');
  });
});

test.describe('DX-02 keyboard at 390px: the documentation disclosure', () => {
  test('opens from the keyboard and its first link is reachable and activatable', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/guide/getting-started/');
    await page.waitForLoadState('networkidle');

    const capability = await walkTabPathForLinks(page);
    if (!capability.reached) {
      testInfo.annotations.push({
        type: 'N/A',
        description:
          "this engine's default Tab path reaches no authored link (macOS WebKit); the 390px keyboard row is not measured on it",
      });
      expect(capability.stops.some((stop) => stop.key === 'a')).toBe(false);
      return;
    }
    await page.goto('/guide/getting-started/');
    await page.waitForLoadState('networkidle');

    const summary = await tabUntil(
      page,
      (stop) => stop.key === 'summary' && stop.label === 'Documentation',
    );
    expectVisibleRing(summary);
    // The disclosure starts closed; keyboard activation opens it.
    const disclosure = page.locator('main details').first();
    await expect(disclosure).not.toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(disclosure).toHaveAttribute('open', '');

    // The next stop is the first section link inside the opened disclosure.
    const link = disclosure
      .getByRole('navigation', { name: 'Documentation navigation' })
      .getByRole('link')
      .first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
    const stop = await pressTab(page);
    expect(stop, 'the Tab path continues into the opened disclosure').toBeTruthy();
    expect(stop!.href).toBe(href);
    expectVisibleRing(stop!);
    // The focused link is inside the 390px viewport horizontally.
    expect(
      await link.evaluate((element) => element.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(390);

    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname === href);
  });
});
