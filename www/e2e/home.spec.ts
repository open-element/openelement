import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installCommand } from '../app/data/_generated-install-command.ts';

const locales = [
  {
    path: '/',
    heading: 'Build with the browser.',
    start: 'Start building',
    docs: 'Read the docs',
    hrefPrefix: '',
    count: 'Count:',
  },
  {
    path: '/zh/',
    heading: '用浏览器原生能力 构建应用。',
    start: '开始构建',
    docs: '阅读文档',
    hrefPrefix: '/zh',
    count: '计数：',
  },
] as const;

for (const locale of locales) {
  test(`${locale.path} renders the example and localized links without JavaScript`, async ({
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
      await page.goto(locale.path);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1 })).toHaveText(locale.heading);
      await expect(main.locator('.home-command code')).toHaveText(installCommand);
      const source = await readFile(
        new URL('../app/islands/open-counter.tsx', import.meta.url),
        'utf8',
      );
      expect((await main.locator('pre').textContent())?.trimEnd()).toBe(source.trimEnd());
      await expect(main.getByRole('button', { name: `${locale.count} 0` })).toBeVisible();
      await expect(main.getByRole('button', { name: 'Copy', exact: true })).toBeHidden();

      const docs = main.getByRole('link', { name: locale.docs, exact: true });
      await expect(docs).toHaveAttribute('href', `${locale.hrefPrefix}/docs/`);
      await expect(main.locator('.home-steps a').nth(1)).toHaveAttribute(
        'href',
        `${locale.hrefPrefix}/architecture/dsd/`,
      );

      const start = main.getByRole('link', { name: locale.start, exact: true });
      await start.click();
      await expect(page).toHaveURL(`${locale.hrefPrefix}/guide/getting-started/`);
    } finally {
      await context.close();
    }
  });

  test(`${locale.path} upgrades the server-rendered counter in place`, async ({ page }) => {
    await page.goto(locale.path);
    const counter = page.locator('open-counter');
    const button = counter.getByRole('button', { name: `${locale.count} 0` });
    await expect(button).toBeVisible();
    const original = await button.elementHandle();
    await button.scrollIntoViewIfNeeded();
    await expect.poll(() => counter.evaluate((host) => host.matches(':defined'))).toBe(true);
    await button.press('Space');
    const updated = counter.getByRole('button', { name: `${locale.count} 1` });
    await expect(updated).toBeVisible();
    expect(await updated.evaluate((button, original) => button === original, original)).toBe(true);
  });

  test(`${locale.path} passes WCAG A and AA in the dark theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(locale.path);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.home-editor').getByRole('button', { name: 'Copy' })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(violations.map(({ id, nodes }) => [id, nodes.map(({ target }) => target)])).toEqual([]);
  });
}

test('the slotted sample keeps the document code surface', async ({ page }) => {
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const pre = page.locator('.page-home open-code-block pre');
    await expect(pre).toBeVisible();
    await expect(pre).toHaveCSS('overflow-x', 'auto');
    const metrics = await pre.evaluate((pre) => ({
      pageWidth: document.documentElement.scrollWidth,
      codeWidth: pre.scrollWidth,
      codeClientWidth: pre.clientWidth,
      padding: Number.parseFloat(getComputedStyle(pre).paddingTop),
      radius: Number.parseFloat(getComputedStyle(pre).borderBottomLeftRadius),
    }));
    expect(metrics.pageWidth).toBe(width);
    expect(metrics.codeWidth).toBe(metrics.codeClientWidth);
    expect(metrics.padding).toBeGreaterThan(0);
    expect(metrics.radius).toBeGreaterThan(0);
  }
});
