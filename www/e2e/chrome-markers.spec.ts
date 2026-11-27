import { expect, test } from '@playwright/test';

const guides = [
  {
    path: '/guide/getting-started/',
    label: 'On this page',
    verify: 'Verify',
    href: '#verify',
    checks: ['Files created.', 'Server ready.', 'Page responds.'],
    troubleshoot: 'Troubleshoot startup',
    back: 'Back to contents',
  },
  {
    path: '/zh/guide/getting-started/',
    label: '本页目录',
    verify: '验证',
    href: '#验证',
    checks: ['文件已生成。', '服务器已启动。', '页面可以交互。'],
    troubleshoot: '排查启动问题',
    back: '返回本页目录',
  },
] as const;

for (const guide of guides) {
  test(`${guide.path} presents named outline links without decorative numbering`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(guide.path);
    const rail = page.locator('open-page-rail');
    const visibleNav = rail.getByRole('navigation', { name: guide.label });
    await expect(visibleNav).toHaveCount(1);
    const verifyLink = visibleNav.getByRole('link', { name: guide.verify, exact: true });
    await expect(verifyLink).toHaveAttribute('href', guide.href);
    await verifyLink.press('Enter');
    await expect(page.locator(`h2[id="${guide.href.slice(1)}"]`)).toBeInViewport();
    await expect(verifyLink).toHaveAttribute('aria-current', 'location');

    const pseudoContent = await rail
      .locator('a')
      .evaluateAll((links) => links.map((link) => getComputedStyle(link, '::before').content));
    expect(pseudoContent.length).toBeGreaterThan(0);
    expect(pseudoContent.every((content) => ['none', 'normal'].includes(content))).toBe(true);
    await expect(page.locator('.article-content a[href="#page-outline"]')).toBeHidden();
  });

  test(`${guide.path} keeps verification checks and the mobile outline usable without JavaScript`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.goto(guide.path + guide.href);
      const article = page.locator('.article-content');
      const verify = article.locator(`h2[id="${guide.href.slice(1)}"]`);
      const checks = verify.locator('xpath=following-sibling::ul[1]').locator('li > strong');
      await expect(checks).toHaveText([...guide.checks]);
      await expect(article.getByText(guide.troubleshoot, { exact: true })).toBeVisible();
      await article.getByRole('link', { name: guide.back }).press('Enter');
      await expect(page).toHaveURL(/#page-outline$/);

      const outline = page.locator('#page-outline');
      await expect(outline).toBeFocused();
      const sticky = await page.getByRole('banner').boundingBox();
      const disclosure = await outline.boundingBox();
      expect(disclosure!.y).toBeGreaterThanOrEqual(sticky!.y + sticky!.height);
      await page.keyboard.press('Space');
      const nav = page.locator('open-page-rail details').getByRole('navigation');
      await expect(nav).toHaveAccessibleName(guide.label);
      await nav.getByRole('link', { name: guide.verify, exact: true }).press('Enter');
      await expect(verify).toBeInViewport();
    } finally {
      await context.close();
    }
  });

  test(`${guide.path} shows the current mobile chapter while reading`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(guide.path);
    const outline = page.locator('#page-outline');
    const reader = page.locator('open-page-rail details');
    const verify = page.locator(`h2[id="${guide.href.slice(1)}"]`);
    const banner = page.getByRole('banner');
    await expect(reader).toHaveAttribute('data-outline-ready', '');
    const nav = reader.getByRole('navigation', { name: guide.label });
    await outline.press('Space');
    await expect(reader).toHaveAttribute('open', '');
    await expect
      .poll(async () => {
        const box = (await nav.boundingBox())!;
        return box.y + box.height;
      })
      .toBeLessThan(844);
    await outline.press('Escape');

    await verify.evaluate((heading) => {
      const margin = Number.parseFloat(getComputedStyle(heading).scrollMarginBlockStart);
      window.scrollTo(0, window.scrollY + heading.getBoundingClientRect().top - margin);
    });
    await expect(outline.locator('.rail-current')).toHaveText(guide.verify);
    await expect(outline).toBeInViewport();
    expect((await outline.boundingBox())!.y - (await banner.boundingBox())!.height).toBeLessThan(3);

    await outline.press('Space');
    await expect(reader).toHaveAttribute('open', '');
    expect((await nav.boundingBox())!.y + (await nav.boundingBox())!.height).toBeLessThan(844);
    const current = nav.getByRole('link', { name: guide.verify, exact: true });
    await expect(current).toHaveAttribute('aria-current', 'location');
    await current.press('Escape');
    await expect(reader).not.toHaveAttribute('open', '');
    await expect(outline).toBeFocused();

    await outline.press('Space');
    await current.press('Enter');
    await expect(page).toHaveURL((url) => decodeURIComponent(url.hash) === guide.href);
    await expect(reader).not.toHaveAttribute('open', '');
    await expect(verify).toBeFocused();
    expect((await verify.boundingBox())!.y).toBeGreaterThan(
      (await outline.boundingBox())!.y + (await outline.boundingBox())!.height,
    );
  });
}

for (const docs of [
  { path: '/docs/', label: 'On this page', groups: ['LEARN', 'GUIDES', 'REFERENCE', 'PROJECT'] },
  { path: '/zh/docs/', label: '本页目录', groups: ['学习', '指南', '参考', '项目'] },
]) {
  test.describe(docs.path, () => {
    test.use({ javaScriptEnabled: false, viewport: { width: 320, height: 844 } });

    test('jumps to all four document groups on a phone without JavaScript', async ({ page }) => {
      const ids = ['learn', 'guides', 'reference', 'project'];
      await page.goto(docs.path);
      const links = page.getByRole('navigation', { name: docs.label }).getByRole('link');
      await expect(links).toHaveText(docs.groups);
      const lastStep = (await page.locator('.page-docs ol li:last-child').boundingBox())!;
      expect(lastStep.y + lastStep.height).toBeLessThanOrEqual(844);
      for (const [index, id] of ids.entries()) {
        const link = links.nth(index);
        await expect(link).toBeInViewport();
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(link).toHaveAttribute('href', `#${id}`);
        await link.press('Enter');
        const heading = page.locator(`h2#${id}`);
        await expect(heading).toBeFocused();
        await expect(heading).toHaveText(docs.groups[index]);
        expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(
          (await page.getByRole('banner').boundingBox())!.height,
        );
        await page.goto(docs.path);
      }
    });
  });
}
