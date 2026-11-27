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

  test('the guide intro, section rule and prose share the desktop reading column', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of ['/guide/getting-started/', '/zh/guide/getting-started/']) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.locator('open-reading-shell').evaluate((shell) => {
        const selectors = [
          '.meta',
          '.meta h1',
          '.meta h1 + p',
          '.article-content > :first-child',
          '.article-content > h2',
          '.article-content > p',
        ];
        const boxes = selectors.map((selector) => {
          const box = shell.querySelector(selector)?.getBoundingClientRect();
          if (!box) throw new Error(`Missing ${selector}`);
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        });
        return { boxes, firstBlockGap: boxes[3].top - boxes[0].bottom };
      });
      const header = geometry.boxes[0];
      for (const box of geometry.boxes) {
        expect(box.left).toBeCloseTo(header.left, 0);
        expect(box.right).toBeCloseTo(header.right, 0);
      }
      expect(geometry.firstBlockGap).toBeGreaterThan(0);
      expect(geometry.firstBlockGap).toBeLessThanOrEqual(24);
    }
  });
});
