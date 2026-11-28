import { expect, test } from '@playwright/test';

test.describe('site shell behavior boundaries', () => {
  test('mobile menu uses the enhanced details disclosure', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/guide/islands-and-ssr/');

    // The disclosure keeps its native details/summary fallback; the island
    // adds the accessible name and the dismissal/focus contract. The panel is
    // the 'Mobile navigation' landmark, which enters the accessibility tree
    // only when the details opens.
    const menu = page.locator('details.oe-site-menu');
    await expect(menu.locator('summary')).toHaveAttribute('aria-label', 'Open navigation');
    await expect(menu).not.toHaveAttribute('open', '');
    await menu.locator('summary').click();
    await expect(menu).toHaveAttribute('open', '');
    await expect(
      page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link').first(),
    ).toBeVisible();
    await expect(menu.locator('summary')).toHaveAttribute('aria-label', 'Close navigation');
    await menu.locator('summary').click();
    await expect(menu).not.toHaveAttribute('open', '');
    await expect(menu.locator('summary')).toHaveAttribute('aria-label', 'Open navigation');
    await menu.locator('summary').click();
    await expect(menu).toHaveAttribute('open', '');
    const heading = page.getByRole('heading', { level: 1 });
    const bounds = (await heading.boundingBox())!;
    const position = { x: 8, y: bounds.height / 2 };
    const hitIsOutsideMenu = await menu.evaluate(
      (element, point) => {
        const hit = element.ownerDocument.elementFromPoint(point.x, point.y);
        return hit !== null && !element.contains(hit);
      },
      { x: bounds.x + position.x, y: bounds.y + position.y },
    );
    expect(hitIsOutsideMenu).toBe(true);
    await heading.click({ position });
    await expect(menu).not.toHaveAttribute('open', '');
  });

  test('closing the menu before its focus handoff preserves outside focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/guide/islands-and-ssr/');
    const menu = page.locator('details.oe-site-menu');
    await expect(menu.locator('summary')).toHaveAttribute('aria-label', 'Open navigation');
    const focusedOutside = await menu.evaluate((element) => {
      if (!(element instanceof HTMLDetailsElement)) throw new Error('Expected a details element');
      const details = element;
      const originalRequest = window.requestAnimationFrame;
      const originalCancel = window.cancelAnimationFrame;
      const frames = new Map<number, FrameRequestCallback>();
      let id = 0;
      let focusAttempts = 0;
      const link = details.querySelector<HTMLAnchorElement>('a')!;
      const originalFocus = link.focus;
      link.focus = () => {
        focusAttempts += 1;
      };
      window.requestAnimationFrame = (callback) => {
        frames.set(++id, callback);
        return id;
      };
      window.cancelAnimationFrame = (frame) => {
        frames.delete(frame);
      };
      try {
        details.open = true;
        details.dispatchEvent(new Event('toggle'));
        details.open = false;
        const outside = document.querySelector<HTMLElement>('main h1')!;
        outside.tabIndex = -1;
        outside.focus();
        for (const callback of frames.values()) callback(performance.now());
        return {
          closed: !details.open,
          focusedOutside: document.activeElement === outside,
          focusAttempts,
        };
      } finally {
        link.focus = originalFocus;
        window.requestAnimationFrame = originalRequest;
        window.cancelAnimationFrame = originalCancel;
      }
    });
    expect(focusedOutside).toEqual({ closed: true, focusedOutside: true, focusAttempts: 0 });
  });

  for (const { route, appearance, toggle, system, docs, blog } of [
    {
      route: '/',
      appearance: 'Appearance',
      toggle: 'Toggle theme',
      system: 'Follow system',
      docs: 'Docs',
      blog: 'Blog',
    },
    {
      route: '/zh/',
      appearance: '外观',
      toggle: '切换主题',
      system: '跟随系统',
      docs: '文档',
      blog: '博客',
    },
  ]) {
    test(`${route} names and operates the icon-only theme actions in the mobile menu`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto(route);
      const menu = page.locator('details.oe-site-menu');
      const summary = menu.locator('summary');
      const choices = menu.getByRole('group', { name: appearance });
      await expect(page.locator('.oe-theme-controls')).toHaveText('');
      await expect(choices).toBeHidden();
      await summary.press('Enter');
      await expect(menu.getByRole('navigation').getByRole('link')).toHaveText([docs, blog]);
      await expect(choices.getByRole('button')).toHaveText([toggle, system]);

      const toggleButton = choices.getByRole('button', { name: toggle });
      const followButton = choices.getByRole('button', { name: system });
      await expect(followButton).toHaveAttribute('aria-pressed', 'true');
      for (const button of [toggleButton, followButton]) {
        const minHeight = await button.evaluate((node) =>
          parseFloat(getComputedStyle(node).minHeight),
        );
        const box = (await button.boundingBox())!;
        expect(minHeight).toBeGreaterThanOrEqual(44);
        expect(Math.round(box.height * 100) / 100).toBeGreaterThanOrEqual(44);
      }

      const root = page.locator('html');
      await toggleButton.press('Enter');
      await expect(root).toHaveAttribute('data-theme', 'light');
      await expect(followButton).toHaveAttribute('aria-pressed', 'false');
      await followButton.press('Enter');
      await expect(root).toHaveAttribute('data-theme', 'dark');
      await expect(followButton).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.oe-theme-system')).toHaveAttribute('aria-pressed', 'true');
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(root).toHaveAttribute('data-theme', 'light');
      await expect(followButton).toHaveAttribute('aria-pressed', 'true');
      await followButton.press('Escape');
      await expect(summary).toBeFocused();
      await expect(choices).toBeHidden();
    });
  }

  test('scrolling does not install the removed imperative shell state', async ({ page }) => {
    await page.goto('/guide/islands-and-ssr/');
    // The shell is the layout convention component (app-layout) — a compiled
    // light-root class with no island declaration, so no client-side state
    // machinery can exist on it.
    const layout = page.locator('app-layout');
    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await expect(layout).not.toHaveAttribute('menu-open');
    await expect(page.getByRole('main').first()).not.toHaveAttribute('inert');
  });
});
