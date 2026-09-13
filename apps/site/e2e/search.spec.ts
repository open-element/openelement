import { expect, test } from '@playwright/test';

test.describe('Search', () => {
  test('pagefind index is generated and non-empty', async ({ request }) => {
    const res = await request.get('/pagefind/pagefind-entry.json');
    expect(res.ok()).toBe(true);
    const entry = await res.json() as {
      languages?: Record<string, { page_count: number }>;
    };
    // The index derives from the built HTML, so stale/removed routes cannot
    // appear by construction; assert coverage instead of path liveness.
    const pageCount = Object.values(entry.languages ?? {})
      .reduce((total, lang) => total + lang.page_count, 0);
    expect(pageCount).toBeGreaterThan(0);
  });

  test('search island returns a live routing result', async ({ page, request }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));
    await page.keyboard.press('Control+K');
    const searchField = page.getByRole('textbox', { name: 'Search documentation' });
    await expect(searchField).toBeVisible();
    await searchField.pressSequentially('routing');
    // First search pays the Pagefind wasm/index load; allow extra time.
    const firstResult = page.getByRole('region', { name: 'Search results' })
      .getByRole('link')
      .first();
    await expect(firstResult).toBeVisible({ timeout: 15_000 });

    const href = await firstResult.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).not.toBe('/guide/routing');
    const res = await request.get(href!);
    expect(res.ok()).toBe(true);
  });

  test('search trigger focuses input and accepts real keyboard typing', async ({ page }) => {
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => customElements.get('open-search'));

    await page.getByRole('button', { name: 'Search' }).click();

    const input = page.getByRole('textbox', { name: 'Search documentation' });
    await expect(input).toBeFocused();

    await page.keyboard.type('routing');
    await expect(input).toHaveValue('routing');

    const firstResult = page.getByRole('region', { name: 'Search results' })
      .getByRole('link')
      .first();
    // First search pays the Pagefind wasm/index load; allow extra time.
    await expect(firstResult).toBeVisible({ timeout: 15_000 });
    const firstHref = await firstResult.getAttribute('href');
    expect(firstHref).toBeTruthy();
    expect(firstHref).not.toBe('/guide/routing');
  });

  test('search overlay is anchored to viewport when opened from layout header', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));

    await page.getByRole('button', { name: 'Search' }).click();

    const dialog = page.getByRole('dialog', { name: 'Search' });
    await expect(dialog).toBeVisible();
    // The geometry contract lives on the backdrop container (`.overlay`):
    // it must span the viewport exactly, so the dialog never opens displaced.
    const overlay = await page.locator('open-search .overlay').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        display: style.display,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        viewportWidth: globalThis.innerWidth,
      };
    });

    expect(overlay.display).toBe('flex');
    expect(Math.abs(overlay.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlay.right - overlay.viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlay.width - overlay.viewportWidth)).toBeLessThanOrEqual(1);
  });

  test('search initial HTML does not stringify computed signals', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));

    // The results region lives inside the closed overlay — it enters the
    // accessibility tree once the user opens the search.
    await page.getByRole('button', { name: 'Search' }).click();
    const results = page.getByRole('region', { name: 'Search results' });
    await expect(results).toBeVisible();
    const text = await results.evaluate((el) => el.textContent ?? '');
    expect(text).not.toContain('[object Object]');
    await expect(results).toContainText('Type at least 2 characters to search');
  });

  test('search panel follows theme token changes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));

    const dialog = page.getByRole('dialog', { name: 'Search' });
    const readPanelBackground = async () => {
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(dialog).toBeVisible();
      return await dialog.evaluate((panel) => getComputedStyle(panel).backgroundColor);
    };

    const darkBackground = await readPanelBackground();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    const beforeTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
    );
    const expectedTheme = beforeTheme === 'light' ? 'dark' : 'light';

    await page.getByRole('button', { name: 'Toggle theme' }).click();

    await page.waitForFunction(
      (theme) => document.documentElement.getAttribute('data-theme') === theme,
      expectedTheme,
    );
    const lightBackground = await readPanelBackground();

    expect(darkBackground).toBeTruthy();
    expect(lightBackground).toBeTruthy();
    expect(lightBackground).not.toBe(darkBackground);
  });

  test('search overlay closes when clicking the backdrop', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));

    await page.getByRole('button', { name: 'Search' }).click();

    const dialog = page.getByRole('dialog', { name: 'Search' });
    await expect(dialog).toBeVisible();

    // The backdrop (`.overlay`) covers the full viewport around the dialog;
    // a real click in its corner must dismiss the search like a user expects.
    const backdrop = page.locator('open-search .overlay');
    await backdrop.click({ position: { x: 2, y: 2 } });

    await expect(backdrop).toBeHidden();
    await expect(dialog).toBeHidden();
  });
});
