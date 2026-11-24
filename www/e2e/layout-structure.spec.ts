import { expect, test } from '@playwright/test';

test.describe('Docs Layout Structure', () => {
  test('getting started renders as a linear article with copyable code', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/guide/getting-started/');
    await page.waitForLoadState('networkidle');

    // The guide section is Markdown-authored through content collections (#1087), not a
    // card grid: article body with heading sections and code blocks.
    await expect(page.locator('open-reading-shell .article-content')).toHaveCount(1);
    const headings = await page.getByRole('heading', { level: 2 }).count();
    expect(headings).toBeGreaterThan(0);
    await expect(
      page.locator('open-reading-shell .article-content open-code-block').first(),
    ).toBeVisible();
  });
});
