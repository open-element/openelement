import { expect, test } from '@playwright/test';

test.describe('Cinematic homepage', () => {
  test('keeps the product story and starter available without animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByText('THE WEB,', { exact: true })).toBeVisible();
    await expect(page.getByText('Start building', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('The server writes HTML.')).toBeVisible();
    await expect(
      page.getByText('deno run -A --minimum-dependency-age 0 npm:@openelement/create my-app'),
    ).toBeVisible();
  });

  test('renders a transparent theme-aware logo linked to the current locale home', async ({ page }) => {
    await page.goto('/zh/guide/getting-started');
    // The logo is the site-name link inside the banner landmark.
    const logo = page.getByRole('banner').getByRole('link', { name: 'openElement' });
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('href', '/zh');
    await expect.poll(() => logo.evaluate((element) => getComputedStyle(element).backgroundImage))
      .toBe('none');
    const mark = logo.locator('.logo-glyph');
    await expect(mark).toBeVisible();
    const initialColor = await mark.evaluate((element) => getComputedStyle(element).color);
    // theme-init follows prefers-color-scheme, so the initial theme varies by
    // environment; toggle to the opposite of the current theme instead of
    // assuming a fixed starting point.
    await page.evaluate(() => {
      const current = document.documentElement.getAttribute('data-theme') === 'light'
        ? 'dark'
        : 'light';
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
    const poster = dragon.locator('img.poster');
    await expect(poster).toHaveCount(1);
    await expect(poster).toHaveAttribute('src', /\/assets\/dragon-frames\/f27\.webp$/);
    await expect(dragon.locator('canvas')).toHaveCount(1);
    await expect(home.locator('.marquee span').first()).toBeVisible();
    await expect(home.locator('.spec-strip .spec-cell')).toHaveCount(5);
    const strategies = home.locator('.strategy');
    await expect(strategies).toHaveCount(4);
    await expect(strategies.nth(1).locator('.tag-default')).toHaveText('DEFAULT');
    await strategies.nth(1).scrollIntoViewIfNeeded();
    await expect.poll(() =>
      strategies.nth(1).evaluate((element) => Number(getComputedStyle(element).opacity))
    ).toBeGreaterThan(0.5);
    const rows = home.locator('.output-row');
    await expect(rows).toHaveCount(3);
    await rows.nth(1).scrollIntoViewIfNeeded();
    await expect(rows.nth(1)).toHaveClass(/active/);
  });

  test('the dragon watches the cursor and stays alive when it parks', async ({ page }) => {
    await page.goto('/');
    const dragon = page.locator('open-dragon-live-gaze');
    const readFrame = () =>
      dragon.evaluate((element) => Number(element.getAttribute('data-frame') ?? -1));
    // Live once the center frame is decoded and the first canvas paint lands.
    await expect.poll(readFrame, { timeout: 20000 }).toBeGreaterThanOrEqual(0);

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    // Centered cursor → the frontal anchor frame (27 of 59).
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await expect.poll(readFrame, { timeout: 15000 }).toBeGreaterThanOrEqual(24);
    await expect.poll(readFrame, { timeout: 15000 }).toBeLessThanOrEqual(30);
    // Cursor hard right → the head turns right (late frames).
    await page.mouse.move(viewport.width * 0.98, viewport.height / 2);
    await expect.poll(readFrame, { timeout: 15000 }).toBeGreaterThanOrEqual(54);
    // Cursor hard left → the head turns left (early frames).
    await page.mouse.move(viewport.width * 0.02, viewport.height / 2);
    await expect.poll(readFrame, { timeout: 15000 }).toBeLessThanOrEqual(3);

    // Parked inside the squint zone (frames 15-17, ~normX 0.296): fine while
    // moving, but a resting dragon must slide to an open-eyed frame.
    await page.mouse.move(viewport.width * 0.296, viewport.height / 2);
    await expect.poll(readFrame, { timeout: 15000 }).toBeGreaterThanOrEqual(13);
    // The park rule fires after 1.2s of stillness — poll for the snap-out.
    await expect
      .poll(async () => {
        const f = await readFrame();
        return f <= 14 || f >= 18;
      }, { timeout: 15000 })
      .toBe(true);

    // Fully idle: the atlas glides to center and hands over to the filmed
    // idle loop — real breathing and blinks, not a simulation.
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    const video = dragon.locator('video.idle-view');
    await expect
      .poll(
        () => dragon.evaluate((element) => Boolean(element.querySelector('.stage.idling'))),
        { timeout: 20000 },
      )
      .toBe(true);
    await expect
      .poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused), {
        timeout: 15000,
      })
      .toBe(false);
    const t1 = await video.evaluate((element) => (element as HTMLVideoElement).currentTime);
    await page.waitForTimeout(1200);
    const t2 = await video.evaluate((element) => (element as HTMLVideoElement).currentTime);
    expect(t2).toBeGreaterThan(t1);
    // Moving the cursor again takes back control instantly.
    await page.mouse.move(viewport.width * 0.98, viewport.height / 2);
    await expect.poll(readFrame, { timeout: 15000 }).toBeGreaterThanOrEqual(54);
    await expect
      .poll(
        () => dragon.evaluate((element) => Boolean(element.querySelector('.stage.idling'))),
        { timeout: 15000 },
      )
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
