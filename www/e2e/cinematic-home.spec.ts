import { expect, test, type Page } from '@playwright/test';
import { installCommand } from '../app/data/_generated-install-command.ts';
import { SOURCE_VERSION } from '../app/data/_generated-release-line.ts';
import { packageCountPhrase } from '../app/data/version.ts';

/**
 * The hero media stack, as selectors the band guard below matches on: the
 * mascot island, its `<figure class="stage">`, the poster `<img>`, the live
 * `<canvas>` and the absolutely positioned stage wrapper.
 */
const HERO_MEDIA_SELECTOR = 'open-dragon-live-gaze, canvas, .stage, .poster, .hero-stage';

/**
 * Scrolls the stats strip into the lower half of the viewport and waits for
 * the scroll island to settle `--hero-exit` — the state in which the exit
 * transform moves the hero stage downward. The bug this guard pins only
 * exists while that transform is live, so no reduced-motion emulation here.
 */
async function parkStripBelowFold(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const strip = document.querySelector('index-index .spec-strip');
          const hero = document.querySelector('index-index .hero-main');
          if (!strip || !hero) return -1;
          if (strip.getBoundingClientRect().top > innerHeight) {
            window.scrollTo(0, Math.max(0, strip.getBoundingClientRect().top - innerHeight * 0.3));
          }
          return Number(hero.style.getPropertyValue('--hero-exit') || 0);
        }),
      { message: 'the scroll island settles --hero-exit' },
    )
    .toBeGreaterThan(0.5);
}

/**
 * Page-side half of the band guard. Runs inside the browser (passed to
 * page.evaluate, so it must be self-contained):
 *
 *  - `spill`: the hero media stack must not hit-test at any point of the
 *    chrome bands below the hero — the stats strip (the row whose contrast is
 *    guarded here) and the marquee that follows it. The mascot stage is
 *    absolutely positioned; while `--hero-exit` translates it down it used to
 *    paint OVER both, which are in-flow content below the hero.
 *  - `inks`: the strip's text elements and the color they paint with.
 */
const stripGuardSample = (selector: string) => {
  const strip = document.querySelector('index-index .spec-strip') as HTMLElement | null;
  const marquee = document.querySelector('index-index .marquee') as HTMLElement | null;
  if (!strip) return { spill: ['index-index .spec-strip missing'], inks: [] as string[] };
  const rect = strip.getBoundingClientRect();
  const bottom = (marquee ?? strip).getBoundingClientRect().bottom;
  const hits = new Set<string>();
  const stepX = Math.max(24, Math.round(rect.width / 12));
  for (let x = 8; x < rect.width - 8; x += stepX) {
    for (const y of [rect.top + 4, rect.top + rect.height / 2, rect.bottom - 4, bottom - 4]) {
      for (const el of document.elementsFromPoint(x, y)) {
        if (el.matches(selector)) hits.add(el.tagName.toLowerCase());
      }
    }
  }
  const inks: string[] = [];
  for (const el of strip.querySelectorAll('.version-line, .spec-fact, .spec-cell small')) {
    inks.push(getComputedStyle(el).color);
  }
  return { spill: [...hits], inks };
};

/** The luminance span of the pixels a page.screenshot clip contains. */
const luminanceSpan = async (
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<{ min: number; max: number }> => {
  const shot = await page.screenshot({ clip });
  return page.evaluate(
    async (dataUrl: string) => {
      const channel = (c: number): number => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2d context unavailable');
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let min = 1;
      let max = 0;
      for (let i = 0; i < data.length; i += 4) {
        const l =
          0.2126 * channel(data[i]) + 0.7152 * channel(data[i + 1]) + 0.0722 * channel(data[i + 2]);
        if (l < min) min = l;
        if (l > max) max = l;
      }
      return { min, max };
    },
    `data:image/png;base64,${shot.toString('base64')}`,
  );
};

/**
 * WCAG relative luminance of a computed color string. Computed colors come
 * back in whatever modern function the engine normalized them to (oklch since
 * the @theme token table), and only a canvas resolves every supported
 * function into sRGB.
 */
const inkLuminance = (page: Page, value: string): Promise<number> =>
  page.evaluate((css: string) => {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) throw new Error('2d context unavailable');
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const { data } = ctx.getImageData(0, 0, 1, 1);
    const channel = (c: number): number => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(data[0]) + 0.7152 * channel(data[1]) + 0.0722 * channel(data[2]);
  }, value);

const contrastRatio = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

test.describe('Cinematic homepage', () => {
  test('keeps the product story and starter available without animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByText('THE WEB,', { exact: true })).toBeVisible();
    await expect(page.getByText('Start building', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('The server writes HTML.')).toBeVisible();
    // The starter command is generated truth (#1414): assert the rendered page
    // shows the create CLI's canonical string, not a copy that could drift.
    await expect(page.getByText(installCommand)).toBeVisible();
  });

  test('the spec strip states its facts and the version block stays one line', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/');
    const home = page.locator('index-index');
    // Four fact cells: the one-line version block plus three sentence facts
    // (E2 §2). The count is pinned so a silent re-add of a label grid fails.
    await expect(home.locator('.spec-strip .spec-cell')).toHaveCount(4);
    // The version line is generated truth: source version, release-state
    // package count, and the shared-version fact, on one nowrap row.
    const versionLine = home.locator('.version-line');
    await expect(versionLine).toHaveText(
      `v${SOURCE_VERSION} · ${packageCountPhrase('en')} · one version`,
    );
    await expect(versionLine).toHaveAttribute(
      'href',
      'https://www.npmjs.com/package/@openelement/element',
    );
    // The fact cells keep their exact sentence copy (E1-5/E1-7 corrections).
    await expect(home.locator('.spec-strip')).toContainText('3 browser engines in CI');
    await expect(home.locator('.spec-strip')).toContainText('element: 0 third-party runtime deps');
    await expect(home.locator('.spec-strip')).toContainText('DSD server output');
    // The index/sentence pair no longer renders a "four packages" graph cell.
    await expect(home.locator('.spec-strip')).not.toContainText('four packages');
  });

  test('the stats strip keeps its copy on the page ground while the hero exits', async ({
    page,
  }) => {
    // The band regression this guards (F lane, owner screenshot 2026-10-09):
    // the hero stage is absolutely positioned and translates down as
    // `--hero-exit` grows; with no clip on .hero-main it painted over the
    // in-flow stats strip, so the copy sat on raw photography — measured on
    // the pre-fix build, the dark theme's white ink fell to 2.7:1 and the
    // light theme's near-black ink to 1.3:1, with the image's own claw
    // detail sitting inside the strip's page-ground bands. Two independent
    // guards, in both themes: the hero media must not reach the strip's band
    // at all, and the background under each text element must clear AA
    // against its ink.
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1024, height: 900 });
      await page.goto('/');
      await parkStripBelowFold(page);

      const { spill, inks } = await page.evaluate(stripGuardSample, HERO_MEDIA_SELECTOR);
      expect(
        spill,
        `${theme}: the hero media stack paints inside the stats strip band (${spill.join(', ')})`,
      ).toEqual([]);

      // Hide the ink only (visibility keeps geometry) so each text element's
      // own line box screenshots as pure background.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll(
          'index-index .spec-strip .version-line, index-index .spec-strip .spec-fact, index-index .spec-strip small',
        )) {
          (el as HTMLElement).style.visibility = 'hidden';
        }
      });
      const boxes = await page
        .locator(
          'index-index .spec-strip .version-line, index-index .spec-strip .spec-fact, index-index .spec-strip .spec-cell small',
        )
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return {
              label: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30),
              x: Math.max(0, Math.round(r.left) - 2),
              y: Math.max(0, Math.round(r.top) - 2),
              width: Math.ceil(r.width) + 4,
              height: Math.ceil(r.height) + 4,
            };
          }),
        );
      expect(boxes.length, `${theme}: the strip's text elements are present`).toBeGreaterThan(0);

      for (const [index, box] of boxes.entries()) {
        const ink = await inkLuminance(page, inks[index] ?? '');
        const { min, max } = await luminanceSpan(page, box);
        const worst = Math.min(contrastRatio(ink, min), contrastRatio(ink, max));
        expect(
          worst,
          `${theme}: "${box.label}" sits on a background at ${min.toFixed(3)}..${max.toFixed(3)} ` +
            `(ink ${ink.toFixed(3)}); worst contrast ${worst.toFixed(2)}:1, AA needs 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('the hero keeps horizontal scroll inside the code block only (§1)', async ({ page }) => {
    // The pre-redesign grid pinned its right column at 320px, which pushed the
    // page wide at narrow viewports and left two horizontal scrollbars in §1
    // (the grid itself plus the code block). Both are gone: the document
    // never scrolls sideways and the code block is the one scroll owner.
    for (const width of [1024, 768, 480, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.locator('index-index .scene-split')).toBeVisible();
      const state = await page.evaluate(() => {
        const root = document.querySelector('index-index');
        const pre = root?.querySelector('.scene-art pre');
        const split = root?.querySelector('.scene-split');
        return {
          docScrollWidth: document.documentElement.scrollWidth,
          docClientWidth: document.documentElement.clientWidth,
          preClientWidth: pre?.clientWidth ?? 0,
          preScrollWidth: pre?.scrollWidth ?? 0,
          splitScrollWidth: split?.scrollWidth ?? 0,
          splitClientWidth: split?.clientWidth ?? 0,
        };
      });
      expect(state.docScrollWidth, `document overflows horizontally at ${width}px`).toEqual(
        state.docClientWidth,
      );
      expect(state.splitScrollWidth, `§1 grid overflows its own width at ${width}px`).toEqual(
        state.splitClientWidth,
      );
      expect(
        state.preScrollWidth,
        `code block has no scrollable width at ${width}px`,
      ).toBeGreaterThanOrEqual(state.preClientWidth);
    }
  });

  test('the slotted code surface survives the component @scope in every engine', async ({
    page,
  }) => {
    // The <pre> is slotted light DOM inside open-code-block, and a component
    // sheet compiles to `@scope (<tag>)` — which WebKit does not apply across
    // a shadow-host boundary (measured 2026-10-09: a plain descendant rule
    // inside the scope applied, the slotted `<pre>` stayed unstyled, and §1
    // overflowed the page). The surface therefore lives in the document sheet
    // (www/site-css.ts). This pins the properties that carry it plus the one
    // invariant that makes the two surfaces one look: the home block and an
    // article fence must agree on padding/border/radius/scroll, so a move back
    // into a scoped sheet (or a fork of the two declarations) fails here in
    // every configured engine instead of only on WebKit.
    const surface = (locator: ReturnType<typeof page.locator>) =>
      locator.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          padding: [cs.paddingTop, cs.paddingLeft],
          radius: cs.borderTopLeftRadius,
          border: cs.borderTopWidth,
          overflow: cs.overflowX,
          background: cs.backgroundColor,
          color: cs.color,
        };
      });

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/');
    const block = page.locator('index-index .scene-art pre');
    await expect(block).toBeVisible();
    const blockSurface = await surface(block);
    // Not the UA default: the pre's own padding/scroll come from the site rule.
    expect(blockSurface.padding).toEqual(['16px', '16px']);
    expect(blockSurface.overflow).toEqual('auto');
    // A hairline border (the declaration is 0.5px; the computed value snaps to
    // whole device pixels, so assert non-zero rather than the raw string).
    expect(parseFloat(blockSurface.border)).toBeGreaterThan(0);

    await page.goto('/guide/getting-started');
    const fence = page.locator('open-reading-shell .article-content pre').first();
    await expect(fence).toBeVisible();
    // The invariant that makes the two surfaces one look: identical computed
    // padding, radius, border width, scroll and surface colors.
    expect(await surface(fence)).toEqual(blockSurface);
  });

  test('the marquee stays decorative: hidden from the a11y tree, stilled under reduced motion, held on hover', async ({
    page,
  }) => {
    await page.goto('/');
    const marquee = page.locator('index-index .marquee');
    const strip = marquee.locator('span');
    await expect(marquee).toHaveAttribute('aria-hidden', 'true');
    await expect(strip).toHaveCSS('animation-name', 'marquee');
    await expect(strip).toHaveCSS('animation-play-state', 'running');
    // Reading the strip: pointing at it holds the strip still. Pausing (rather
    // than lengthening the duration) is deliberate — the animation's progress
    // is a fraction of its duration, so a duration change would jump the strip
    // mid-flight instead of slowing it.
    await marquee.hover();
    await expect(strip).toHaveCSS('animation-play-state', 'paused');
    await page.mouse.move(0, 0);
    await expect(strip).toHaveCSS('animation-play-state', 'running');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(strip).toHaveCSS('animation-name', 'none');
  });

  test('renders a transparent theme-aware logo linked to the current locale home', async ({
    page,
  }) => {
    await page.goto('/zh/guide/getting-started');
    // The logo is the site-name link inside the banner landmark.
    const logo = page.getByRole('banner').getByRole('link', { name: 'openElement' });
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('href', '/zh');
    await expect
      .poll(() => logo.evaluate((element) => getComputedStyle(element).backgroundImage))
      .toBe('none');
    const mark = logo.locator('.logo-glyph');
    await expect(mark).toBeVisible();
    const initialColor = await mark.evaluate((element) => getComputedStyle(element).color);
    // theme-init follows prefers-color-scheme, so the initial theme varies by
    // environment; toggle to the opposite of the current theme instead of
    // assuming a fixed starting point.
    await page.evaluate(() => {
      const current =
        document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', current);
    });
    const toggledColor = await mark.evaluate((element) => getComputedStyle(element).color);
    expect(toggledColor).not.toBe(initialColor);
  });

  test('view-source hero and scroll scenes work without hijacking scroll', async ({ page }) => {
    await page.goto('/');
    const home = page.locator('index-index');
    const dragon = home.locator('open-dragon-live-gaze');
    await expect(dragon).toHaveCount(1);
    await expect(dragon.locator('video')).toHaveCount(1);
    const idleView = dragon.locator('video.idle-view');
    await expect(idleView).toHaveAttribute('muted', '');
    await expect(idleView).toHaveAttribute('playsinline', '');
    await expect(idleView).toHaveAttribute('loop', '');
    await expect(idleView).toHaveAttribute('preload', 'none');
    await expect(idleView).not.toHaveAttribute('autoplay', '');
    await expect(idleView).toHaveAttribute(
      'src',
      'https://assets.openelement.org/site/v1/dragon/dragon-idle.mp4',
    );
    await expect(idleView).toHaveAttribute('crossorigin', 'anonymous');
    const poster = dragon.locator('img.poster');
    await expect(poster).toHaveCount(1);
    await expect(poster).toHaveAttribute(
      'src',
      'https://assets.openelement.org/site/v1/dragon/frames/f27.webp',
    );
    await expect(poster).toHaveAttribute('crossorigin', 'anonymous');
    await expect(dragon.locator('canvas')).toHaveCount(1);
    await expect(home.locator('.marquee span').first()).toBeVisible();
    const strategies = home.locator('.strategy');
    await expect(strategies).toHaveCount(4);
    await expect(strategies.nth(1).locator('.tag-default')).toHaveText('DEFAULT');
    await strategies.nth(1).scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        strategies.nth(1).evaluate((element) => Number(getComputedStyle(element).opacity)),
      )
      .toBeGreaterThan(0.5);
    const rows = home.locator('.output-row');
    await expect(rows).toHaveCount(3);
    await rows.nth(1).scrollIntoViewIfNeeded();
    await expect(rows.nth(1)).toHaveClass(/active/);
  });

  test('the dragon watches the cursor and stays alive when it parks', async ({ page }) => {
    // Linux Firefox can report pointer:none in a headless/remote session even
    // though Playwright is delivering real mouse PointerEvents. Pin that
    // environment so the test covers event capability, not the media-query
    // snapshot that caused #1353's source and fresh-clone gates to fail.
    await page.addInitScript(() => {
      const nativeMatchMedia = globalThis.matchMedia.bind(globalThis);
      globalThis.matchMedia = (query) => {
        const result = nativeMatchMedia(query);
        if (query === '(pointer: fine)') {
          Object.defineProperty(result, 'matches', { value: false });
        }
        return result;
      };
    });
    await page.goto('/');
    const dragon = page.locator('open-dragon-live-gaze');
    const readFrame = () =>
      dragon.evaluate((element) => Number(element.getAttribute('data-frame') ?? -1));
    // Live once the center frame is decoded and the first canvas paint lands.
    // ponytail: remote R2 atlas streams progressively after center, so extreme
    // polls allow 60s for slow networks; same thresholds, just longer waits.
    await expect.poll(readFrame, { timeout: 60000 }).toBeGreaterThanOrEqual(0);

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    // Centered cursor → the frontal anchor frame (27 of 59).
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await expect.poll(readFrame, { timeout: 60000 }).toBeGreaterThanOrEqual(24);
    await expect.poll(readFrame, { timeout: 60000 }).toBeLessThanOrEqual(30);
    // Cursor hard right → the head turns right (late frames).
    await page.mouse.move(viewport.width * 0.98, viewport.height / 2);
    await expect.poll(readFrame, { timeout: 60000 }).toBeGreaterThanOrEqual(54);
    // Cursor hard left → the head turns left (early frames).
    await page.mouse.move(viewport.width * 0.02, viewport.height / 2);
    await expect.poll(readFrame, { timeout: 60000 }).toBeLessThanOrEqual(3);

    // Parked inside the squint zone (frames 15-17, ~normX 0.296): fine while
    // moving, but a resting dragon must slide to an open-eyed frame.
    await page.mouse.move(viewport.width * 0.296, viewport.height / 2);
    await expect.poll(readFrame, { timeout: 60000 }).toBeGreaterThanOrEqual(13);
    // The park rule fires after 1.2s of stillness — poll for the snap-out.
    await expect
      .poll(
        async () => {
          const f = await readFrame();
          return f <= 14 || f >= 18;
        },
        { timeout: 60000 },
      )
      .toBe(true);

    // Fully idle: the atlas glides to center and hands over to the filmed
    // idle loop — real breathing and blinks, not a simulation.
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    const video = dragon.locator('video.idle-view');
    await expect
      .poll(() => dragon.evaluate((element) => Boolean(element.querySelector('.stage.idling'))), {
        timeout: 60000,
      })
      .toBe(true);
    await expect
      .poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused), {
        timeout: 60000,
      })
      .toBe(false);
    const t1 = await video.evaluate((element) => (element as HTMLVideoElement).currentTime);
    await page.waitForTimeout(1200);
    const t2 = await video.evaluate((element) => (element as HTMLVideoElement).currentTime);
    expect(t2).toBeGreaterThan(t1);
    // Moving the cursor again takes back control instantly.
    await page.mouse.move(viewport.width * 0.98, viewport.height / 2);
    await expect.poll(readFrame, { timeout: 60000 }).toBeGreaterThanOrEqual(54);
    await expect
      .poll(() => dragon.evaluate((element) => Boolean(element.querySelector('.stage.idling'))), {
        timeout: 60000,
      })
      .toBe(false);
  });

  test('the dragon releases async media work and reconnects cleanly', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const dragon = page.locator('open-dragon-live-gaze');
    const readFrame = () =>
      dragon.evaluate((element) => Number(element.getAttribute('data-frame') ?? -1));
    await expect.poll(readFrame, { timeout: 20000 }).toBeGreaterThanOrEqual(0);

    const detached = await dragon.evaluate(async (element) => {
      const parent = element.parentNode;
      const video = element.querySelector('video');
      const stage = element.querySelector('.stage');
      if (!parent || !(video instanceof HTMLVideoElement)) {
        throw new Error('dragon reconnect fixture is incomplete');
      }
      element.remove();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const result = { paused: video.paused, idling: stage?.classList.contains('idling') ?? false };
      element.removeAttribute('data-frame');
      parent.appendChild(element);
      return result;
    });

    expect(detached).toEqual({ paused: true, idling: false });
    await expect.poll(readFrame, { timeout: 20000 }).toBeGreaterThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
