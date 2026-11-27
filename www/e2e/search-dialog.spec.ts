/**
 * Covers dialog dismissal, scroll lock, background inaccessibility, live
 * results, keyboard traversal of the empty state, and touch labels.
 * Search queries and result states are covered by search.spec.ts and
 * search-a11y-states.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test';

const OVERLAY = 'open-search .overlay';
const STATUS = '#open-search-status';

async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !!customElements.get('open-search'));
}

async function openDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search documentation' })).toBeFocused();
}

test.describe('search dialog modal contract', () => {
  test('locks page scroll while open and restores the position on close', async ({ page }) => {
    await openHome(page);
    await page.evaluate(() => scrollTo(0, 500));
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => scrollY);
    await openDialog(page);

    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    expect(
      await page.evaluate(() =>
        (document.querySelector('.oe-content-frame') as HTMLElement).hasAttribute('inert'),
      ),
    ).toBe(true);

    await page.mouse.move(1200, 600);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => scrollY)).toBe(before);
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => scrollY)).toBe(before);

    await page.keyboard.press('Escape');
    await expect(page.locator(OVERLAY)).toBeHidden();
    expect(await page.evaluate(() => scrollY)).toBe(before);
    expect(
      await page.evaluate(() =>
        (document.querySelector('.oe-content-frame') as HTMLElement).hasAttribute('inert'),
      ),
    ).toBe(false);
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
  });

  test('Tab wraps through the close control and the empty-state recovery controls', async ({
    page,
  }) => {
    await openHome(page);
    await openDialog(page);

    await page.keyboard.press('Tab');
    await expect(page.locator('#open-search-close')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.search-suggestion').first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.search-suggestion').nth(1)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.search-suggestion').nth(2)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.search-empty-docs')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('combobox', { name: 'Search documentation' })).toBeFocused();
    await expect(page.locator(OVERLAY)).toBeVisible();
  });

  test('polite live region announces loading, results and no results; count stays visible', async ({
    page,
  }) => {
    // Hold the lazy Pagefind module so the loading state is observable.
    await page.route('**/pagefind/pagefind.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    await openHome(page);
    await openDialog(page);

    const field = page.getByRole('combobox', { name: 'Search documentation' });
    await field.pressSequentially('routing');
    await expect(page.locator(STATUS)).toHaveText('Searching…');
    await expect(page.locator('#open-search-count')).toHaveText(/\d+ results?/, {
      timeout: 30_000,
    });
    const count = await page.locator('#open-search-count').innerText();
    await expect(page.locator(STATUS)).toHaveText(count);
    await expect(page.locator(STATUS)).toHaveAttribute('role', 'status');
    await expect(page.locator(STATUS)).toHaveAttribute('aria-live', 'polite');

    await field.fill('zzqxwvv');
    await expect(page.locator(STATUS)).toHaveText(/No results found for/, { timeout: 30_000 });
    await expect(page.locator('#open-search-count')).toBeHidden();
  });

  test('closing clears aria-activedescendant and a zero-result reopen leaves it clear', async ({
    page,
  }) => {
    await openHome(page);
    await openDialog(page);
    const field = page.locator('#open-search-input');

    await field.pressSequentially('guide');
    const options = page.getByRole('listbox', { name: 'Search results' }).getByRole('option');
    await expect(options.first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('ArrowDown');
    await expect(field).toHaveAttribute('aria-activedescendant', /open-search:option/);

    // Esc, the close button and the backdrop are the three dismissals; each
    // must leave no pointer into the option set that is about to disappear.
    await page.keyboard.press('Escape');
    await expect(page.locator(OVERLAY)).toBeHidden();
    await expect(field).not.toHaveAttribute('aria-activedescendant');

    await openDialog(page);
    await expect(field).not.toHaveAttribute('aria-activedescendant');
    await field.fill('zzqxwvv');
    await expect(page.locator(STATUS)).toHaveText(/No results found for/, { timeout: 30_000 });
    await expect(field).not.toHaveAttribute('aria-activedescendant');
    await page.locator('#open-search-close').click();
    await expect(page.locator(OVERLAY)).toBeHidden();
    await expect(field).not.toHaveAttribute('aria-activedescendant');

    await openDialog(page);
    await field.pressSequentially('guide');
    await expect(options.first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('ArrowDown');
    await expect(field).toHaveAttribute('aria-activedescendant', /open-search:option/);
    await page.mouse.click(30, 700);
    await expect(page.locator(OVERLAY)).toBeHidden();
    await expect(field).not.toHaveAttribute('aria-activedescendant');
  });

  test('the in-field clear control empties the query and keeps the dialog open', async ({
    page,
  }) => {
    await openHome(page);
    await openDialog(page);
    const field = page.locator('#open-search-input');
    const clear = page.locator('#open-search-clear');
    await expect(clear).toBeHidden();
    await field.pressSequentially('guide');
    await expect(
      page.getByRole('listbox', { name: 'Search results' }).getByRole('option').first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(field).toHaveValue('');
    await expect(field).toBeFocused();
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(clear).toBeHidden();
    await expect(page.locator('#open-search-results')).toContainText(
      'Type at least 2 characters to search',
    );
  });

  test('results end on a whole row with a visible fade and scrollbar', async ({ page }) => {
    await openHome(page);
    await openDialog(page);
    await page.locator('#open-search-input').pressSequentially('hydration');
    await expect(
      page.getByRole('listbox', { name: 'Search results' }).getByRole('option').first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#open-search-results')).toHaveAttribute('data-scrollable', '');
    // The fade/strip reveal is a 120ms transition; poll its end state.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            getComputedStyle(document.querySelector('open-search .search-popover')!, '::before')
              .opacity,
        ),
      )
      .toBe('1');
    const geometry = await page.evaluate(() => {
      const list = document.querySelector('#open-search-results')!;
      const rows = [...list.querySelectorAll('a.result')];
      const box = list.getBoundingClientRect();
      const visible = rows.filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom <= box.bottom + 0.5 && rect.top >= box.top - 0.5;
      });
      const popover = document.querySelector('open-search .search-popover')!;
      const fade = getComputedStyle(popover, '::before');
      const more = getComputedStyle(popover, '::after');
      return {
        visible: visible.length,
        lastBottom: visible.at(-1)?.getBoundingClientRect().bottom ?? 0,
        listBottom: box.bottom,
        scrollable: list.hasAttribute('data-scrollable'),
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        fadeOpacity: fade.opacity,
        fadeVisibility: fade.visibility,
        moreOpacity: more.opacity,
        moreVisibility: more.visibility,
        scrollbarWidth: getComputedStyle(list).scrollbarWidth,
      };
    });
    expect(geometry.visible).toBeGreaterThanOrEqual(3);
    expect(geometry.lastBottom).toBeLessThanOrEqual(geometry.listBottom + 0.5);
    expect(geometry.scrollable).toBe(true);
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    expect(geometry.fadeOpacity).toBe('1');
    expect(geometry.fadeVisibility).toBe('visible');
    expect(geometry.moreOpacity).toBe('1');
    expect(geometry.moreVisibility).toBe('visible');
    // Firefox reports `none` for its overlay scrollbar; the chevron/fade is
    // the cross-engine affordance there.
    expect(['thin', 'auto', 'none']).toContain(geometry.scrollbarWidth);
  });

  test('polite live region speaks zh result counts', async ({ page }) => {
    await page.goto('/zh/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !!customElements.get('open-search'));
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    const field = page.getByRole('combobox', { name: '搜索文档' });
    await field.pressSequentially('水合');
    await expect(page.locator(STATUS)).toHaveText(/\d+ 条结果/, { timeout: 30_000 });
    await expect(page.locator('#open-search-count')).toHaveText(/\d+ 条结果/);
  });
});

test.describe('search dialog coarse-pointer controls', () => {
  // `hasTouch` alone already makes `(pointer: coarse)` match in every engine;
  // `isMobile` is Chromium/WebKit-only and would make this describe fail at
  // context creation in Firefox.
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('close control is 44px on touch and closes back to the trigger', async ({ page }) => {
    await openHome(page);
    await openDialog(page);
    const close = page.locator('#open-search-close');
    await expect(close).toBeVisible();
    await expect(close).toHaveAccessibleName('Close dialog');
    const box = await close.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await close.click();
    await expect(page.locator(OVERLAY)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
  });

  for (const locale of ['en', 'zh']) {
    test(`theme icons fit narrow ${locale} headers and retain their accessible names`, async ({
      page,
    }) => {
      const isZh = locale === 'zh';
      const followLabel = isZh ? '跟随系统' : 'Follow system';
      const followDescription = isZh
        ? '恢复跟随操作系统的浅色或深色设置。'
        : 'Resume following your operating system’s light or dark setting.';
      const groupLabels = isZh
        ? ['主题：跟随系统', '主题：浅色', '主题：深色']
        : ['Theme: follow system', 'Theme: light', 'Theme: dark'];

      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto(isZh ? '/zh/' : '/');
      const system = page.getByRole('button', { name: followLabel, exact: true });
      const toggle = page.getByRole('button', { name: isZh ? '切换主题' : 'Toggle theme' });
      const group = page.locator('[data-theme-group]');
      await expect(system).toHaveAccessibleDescription(followDescription);
      await expect(system).toHaveAttribute('title', followLabel);
      await expect(system.locator('svg[aria-hidden="true"]')).toBeVisible();
      await expect(system).toHaveText('');
      await expect(toggle).toHaveText('');
      const toggleWithTitle = isZh ? toggle : group.locator('open-theme-toggle');
      await expect(toggleWithTitle).toHaveAttribute('title', isZh ? '切换主题' : 'Toggle theme');
      await expect(group).toHaveAccessibleName(groupLabels[0]);
      await expect(system).toHaveAttribute('aria-pressed', 'true');

      const header = page.getByRole('banner');
      const actions = [
        header.locator('[data-locale-switch]'),
        header.locator('open-search [part="trigger"]'),
        toggle,
        system,
        header.locator('.oe-header-repo'),
        header.locator('.oe-menu-trigger'),
      ];
      for (const width of [320, 390, 480, 768]) {
        await page.setViewportSize({ width, height: 844 });
        const brand = await header.locator('.oe-brand').boundingBox();
        expect(brand).not.toBeNull();
        for (const action of actions) {
          await expect(action).toBeInViewport({ ratio: 1 });
          const box = (await action.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(Math.abs(box.y + box.height / 2 - (brand!.y + brand!.height / 2))).toBeLessThan(1);
        }
      }

      await toggle.press('Enter');
      await expect(group).toHaveAccessibleName(groupLabels[1]);
      await expect(system).toHaveAttribute('aria-pressed', 'false');
      await toggle.click();
      await expect(group).toHaveAccessibleName(groupLabels[2]);
      await expect(system).toHaveAttribute('aria-pressed', 'false');
      await system.press('Space');
      await expect(group).toHaveAccessibleName(groupLabels[0]);
      await expect(system).toHaveAttribute('aria-pressed', 'true');
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    });
  }
});
