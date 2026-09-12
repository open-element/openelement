import { expect, test } from '@playwright/test';

test.describe('open-layout behavior boundaries', () => {
  test('mobile menu uses the native details disclosure', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/architecture/islands-deep');

    // The disclosure is identified by its user-visible summary text; the
    // panel is the 'Mobile navigation' landmark, which only enters the
    // accessibility tree once the details opens. The click targets the native
    // summary control (the visually hidden label span is covered by the ☰
    // glyph).
    const menu = page.locator('details', { hasText: 'Open navigation' });
    await expect(menu).not.toHaveAttribute('open', '');
    await menu.locator('summary').click();
    await expect(menu).toHaveAttribute('open', '');
    await expect(
      page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link').first(),
    ).toBeVisible();
  });

  test('scrolling does not install the removed imperative shell state', async ({ page }) => {
    await page.goto('/architecture/islands-deep');
    const layout = page.locator('open-layout');
    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await expect(layout).not.toHaveAttribute('menu-open');
    await expect(page.getByRole('main').first()).not.toHaveAttribute('inert');
  });
});
