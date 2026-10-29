/**
 * E2E: the page-rail "§N" marker stays inside `open-page-rail`.
 *
 * www/site-chrome.css is the site's ONE linked document stylesheet, not a
 * component-scoped sheet: a rule without a tag prefix reaches every page and
 * every element. The rail's counter chip was declared as a bare `a::before`
 * (plus a bare `a[aria-current="location"]::before` for its current-state
 * ink), so every anchor on the site — header brand, primary nav, footer
 * columns, article links — rendered a generated "§N" prefix. This suite is
 * the regression contract for the host-scoped form
 * (`open-page-rail a::before` / `open-page-rail a[aria-current="location"]::before`).
 *
 * What the browser exposes: `getComputedStyle(el, '::before').content` does
 * NOT resolve `counter(rail-item)`. chromium, firefox and webkit all
 * serialize the specified token stream — `"§" counter(rail-item) "  "` — for
 * a generated counter marker, and `none` for an element no rule generates.
 * The literal numeral is render-only, so the 1..n sequence is asserted from
 * the wiring that fully determines it: each rail nav resets the counter to 0,
 * and each rail anchor's `::before` increments it by 1, one anchor after the
 * other in DOM order. If an engine ever resolves the counter in the computed
 * value, the spec asserts the literal §1..§n sequence instead.
 *
 * The suite uses no CDP surface, so it runs in all three engines.
 */

import { expect, test, type Page } from '@playwright/test';

const DESKTOP = { width: 1280, height: 900 };
const RAIL_ROUTES = ['/guide/getting-started/', '/zh/guide/getting-started/'] as const;
/** The banner brand link points at the locale root: `/` (en) or `/zh` (zh). */
const BRAND_SELECTOR = 'header a[href="/"], header a[href="/zh/"]';

/** The `::before` channel of one anchor. */
interface AnchorMarker {
  href: string | null;
  label: string;
  content: string;
  counterIncrement: string;
  counterReset: string;
  current: string | null;
  color: string;
}

interface RailNavMarkers {
  ariaLabel: string | null;
  counterReset: string;
  anchors: AnchorMarker[];
}

interface RailMarkers {
  railHosts: number;
  currentOutsideRail: number;
  /** `var(--color-primary)` resolved in this engine, for the current-ink check. */
  primaryColor: string;
  navs: RailNavMarkers[];
}

/**
 * The site's counter marker as a computed `content` value. It starts with the
 * quoted section sign; engines either keep the counter token (current
 * behaviour, all three engines) or resolve it to `"§1"`, `"§2"` (handled).
 */
const COUNTER_MARKER_START = '"§';

/** The only computed `content` values of an element no rule generates. */
const NO_GENERATED_CONTENT = new Set(['none', 'normal']);

/** `"§3"` -> 3; the counter-token form -> null. */
function resolvedMarkerNumber(content: string): number | null {
  const match = /^"§(\d+)/.exec(content);
  return match === null ? null : Number(match[1]);
}

/** Read the `::before` channel of every anchor matching `selector`. */
function readAnchorMarkers(page: Page, selector: string): Promise<AnchorMarker[]> {
  return page.evaluate((target) => {
    const read = (el: Element) => {
      const pseudo = getComputedStyle(el, '::before');
      return {
        href: el.getAttribute('href'),
        label: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        content: pseudo.getPropertyValue('content'),
        counterIncrement: pseudo.getPropertyValue('counter-increment'),
        counterReset: getComputedStyle(el).getPropertyValue('counter-reset'),
        current: el.getAttribute('aria-current'),
        color: pseudo.getPropertyValue('color'),
      };
    };
    return [...document.querySelectorAll(target)].map(read);
  }, selector);
}

/** Read every rail nav and the marker channel of the anchors inside it. */
function readRailMarkers(page: Page): Promise<RailMarkers> {
  return page.evaluate(() => {
    const railHosts = [...document.querySelectorAll('open-page-rail')];
    const navs = railHosts.flatMap((host) => [...host.querySelectorAll('nav')]);

    // The current-state ink is a token; resolve the same token in this engine
    // so the comparison is serialization-agnostic (oklch vs color(), etc.).
    const probe = document.createElement('span');
    probe.style.color = 'var(--color-primary)';
    document.body.append(probe);
    const primaryColor = getComputedStyle(probe).color;
    probe.remove();

    const currentOutsideRail = [...document.querySelectorAll('a[aria-current="location"]')].filter(
      (el) => el.closest('open-page-rail') === null,
    ).length;

    const read = (el: Element) => {
      const pseudo = getComputedStyle(el, '::before');
      return {
        href: el.getAttribute('href'),
        label: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        content: pseudo.getPropertyValue('content'),
        counterIncrement: pseudo.getPropertyValue('counter-increment'),
        counterReset: getComputedStyle(el).getPropertyValue('counter-reset'),
        current: el.getAttribute('aria-current'),
        color: pseudo.getPropertyValue('color'),
      };
    };

    return {
      railHosts: railHosts.length,
      currentOutsideRail,
      primaryColor,
      navs: navs.map((nav) => ({
        ariaLabel: nav.getAttribute('aria-label'),
        counterReset: getComputedStyle(nav).getPropertyValue('counter-reset').trim(),
        anchors: [...nav.querySelectorAll('a')].map(read),
      })),
    };
  });
}

/** Every anchor the query matches must carry no generated pseudo-element. */
function expectNoGeneratedMarker(markers: AnchorMarker[], where: string): void {
  expect(markers.length, `${where}: the selector must match at least one anchor`).toBeGreaterThan(
    0,
  );
  const generated = markers.filter((marker) => !NO_GENERATED_CONTENT.has(marker.content));
  expect(
    generated.map((marker) => `${marker.label} (${marker.href ?? 'no href'}) -> ${marker.content}`),
    `${where}: no anchor outside open-page-rail may render a generated ::before`,
  ).toEqual([]);
}

/** No anchor outside the rail may carry the section-marker channel. */
async function expectNoMarkerLeaks(page: Page): Promise<void> {
  const leaks = await page.evaluate(() => {
    const leaked: { label: string; href: string | null; content: string }[] = [];
    for (const el of document.querySelectorAll('a')) {
      if (el.closest('open-page-rail') !== null) continue;
      const content = getComputedStyle(el, '::before').getPropertyValue('content');
      if (!/\u00a7|counter\(rail-item\)/.test(content)) continue;
      leaked.push({
        label: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        href: el.getAttribute('href'),
        content,
      });
    }
    return leaked;
  });
  expect(leaks, 'every anchor outside the rail must be marker-free').toEqual([]);
}

test.describe('Site chrome: page-rail § marker is scoped to the rail', () => {
  test('the home page renders no generated § prefix on any chrome or content anchor', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Representative sample per the regression report: banner brand link,
    // every primary-nav link, every footer link, and the in-content links.
    expectNoGeneratedMarker(await readAnchorMarkers(page, BRAND_SELECTOR), 'banner brand');
    expectNoGeneratedMarker(await readAnchorMarkers(page, 'header nav a'), 'primary navigation');
    expectNoGeneratedMarker(await readAnchorMarkers(page, 'footer a'), 'footer');
    expectNoGeneratedMarker(await readAnchorMarkers(page, 'main a[href^="/"]'), 'main content');

    // The home layout mounts no rail, so the whole document must be clean.
    await expectNoMarkerLeaks(page);
  });

  for (const route of RAIL_ROUTES) {
    test(`${route} renders the § counter only on rail anchors, incrementing in DOM order`, async ({
      page,
    }) => {
      await page.setViewportSize(DESKTOP);
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      // The rail mounts on the reading layout and renders two outline copies
      // (desktop nav + the nav inside the mobile disclosure); each carries its
      // own `[counter-reset:rail-item]` utility and numbers from 1 separately.
      const rail = await readRailMarkers(page);
      expect(
        rail.railHosts,
        `${route}: the reading layout must mount open-page-rail`,
      ).toBeGreaterThan(0);
      expect(rail.navs.length, `${route}: the rail must render outline navs`).toBeGreaterThan(0);

      for (const nav of rail.navs) {
        const where = `${route} nav "${nav.ariaLabel ?? '(unlabeled)'}"`;

        // Every rail anchor renders the "§" marker; nothing else does.
        expect(nav.anchors.length, `${where}: the outline must carry rail anchors`).toBeGreaterThan(
          1,
        );
        const contents = nav.anchors.map((anchor) => anchor.content);
        for (const content of contents) {
          expect(
            content.startsWith(COUNTER_MARKER_START),
            `${where}: every rail anchor ::before must start with the § marker, got ${content}`,
          ).toBe(true);
        }
        for (const anchor of nav.anchors) {
          expect(anchor.href ?? '', `${where}: rail anchors are in-page outline links`).toMatch(
            /^#/,
          );
        }

        const numbers = contents.map(resolvedMarkerNumber);
        if (numbers.every((number) => number !== null)) {
          // An engine that resolves counters in the computed value: assert the
          // literal §1..§n sequence directly.
          expect(numbers, `${where}: the § number must increment 1..n in DOM order`).toEqual(
            numbers.map((_unused, index) => index + 1),
          );
        } else {
          // Current engines keep the counter unresolved (see the file header),
          // so prove the sequence from the counter wiring that determines it.
          for (const content of contents) {
            expect(content, `${where}: the marker must be the rail counter`).toMatch(
              /^"§"\s+counter\(rail-item\)/,
            );
          }
          expect(nav.counterReset, `${where}: the nav must reset rail-item to 0`).toMatch(
            /^rail-item\s+0$/,
          );
          for (const anchor of nav.anchors) {
            expect(
              anchor.counterIncrement,
              `${where}: each rail anchor ::before must increment rail-item by 1`,
            ).toMatch(/^rail-item\s+1$/);
            expect(
              anchor.counterReset,
              `${where}: a rail anchor must not reset the counter it increments`,
            ).toBe('none');
          }
        }

        // The current-state ink (`a[aria-current="location"]::before`) belongs
        // to the current rail entry only. Marking is scrollspy-owned, so its
        // presence is optional; the absence of an outside-rail location mark is
        // not.
        const current = nav.anchors.filter((anchor) => anchor.current === 'location');
        expect(current.length, `${where}: at most one current rail entry`).toBeLessThanOrEqual(1);
        const resting = nav.anchors.filter((anchor) => anchor.current !== 'location');
        for (const anchor of resting) {
          expect(
            anchor.color,
            `${where}: a non-current rail entry must not use the current-state ink`,
          ).not.toBe(rail.primaryColor);
        }
        if (current.length === 1) {
          expect(
            current[0].color,
            `${where}: the current rail entry ::before uses the primary ink`,
          ).toBe(rail.primaryColor);
        }
      }

      expect(
        rail.currentOutsideRail,
        `${route}: aria-current="location" must stay inside open-page-rail`,
      ).toBe(0);

      // Non-rail anchors on the same page stay marker-free.
      expectNoGeneratedMarker(await readAnchorMarkers(page, BRAND_SELECTOR), 'banner brand');
      expectNoGeneratedMarker(await readAnchorMarkers(page, 'header nav a'), 'primary navigation');
      expectNoGeneratedMarker(await readAnchorMarkers(page, 'footer a'), 'footer');
      expectNoGeneratedMarker(await readAnchorMarkers(page, 'main a[href^="/"]'), 'main content');
      await expectNoMarkerLeaks(page);
    });
  }
});
