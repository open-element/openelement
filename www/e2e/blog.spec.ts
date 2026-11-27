import { expect, test } from '@playwright/test';

const blogHost = 'https://openelement.org';
const articleSlug = 'a-clearer-open-element-site';
const locales = [
  {
    lang: 'en',
    prefix: '',
    nav: 'Primary navigation',
    docs: 'Docs',
    blog: 'Blog',
    title: 'A clearer openElement site',
    date: 'November 27, 2026',
    releaseNotes: 'Package release notes',
    search: 'Search',
    searchField: 'Search documentation',
    query: 'clearer',
  },
  {
    lang: 'zh',
    prefix: '/zh',
    nav: '主导航',
    docs: '文档',
    blog: '博客',
    title: '更清晰的 openElement 网站',
    date: '2026年11月27日',
    releaseNotes: '查看软件包发布说明',
    search: '搜索',
    searchField: '搜索文档',
    query: '更清晰',
  },
];

test.describe('Blog pages with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  for (const { lang, prefix, nav, docs, blog, title, date, releaseNotes } of locales) {
    test(`${lang} navigation opens the dated article and links to its translation`, async ({
      page,
    }) => {
      const index = `${prefix}/blog/`;
      const post = `${index}${articleSlug}/`;
      const alternate = `${lang === 'zh' ? '' : '/zh'}/blog/${articleSlug}/`;
      await page.goto(`${prefix}/`);

      const topNav = page.getByRole('navigation', { name: nav, exact: true });
      await expect(topNav.getByRole('link')).toHaveText([docs, blog]);
      await topNav.getByRole('link', { name: blog, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${index}$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(blog);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', blogHost + index);
      const content = page.getByRole('main');
      await expect(content.getByRole('link', { name: releaseNotes })).toHaveAttribute(
        'href',
        `${prefix}/changelog/`,
      );
      await expect(content.locator('time')).toHaveText(date);
      const article = content.getByRole('link', { name: title, exact: true });
      await article.scrollIntoViewIfNeeded();
      // The cross-document transition can still intercept pointer input after the page loads.
      await expect
        .poll(() =>
          article.evaluate((link) => {
            const { x, y, width, height } = link.getBoundingClientRect();
            return link.contains(document.elementFromPoint(x + width / 2, y + height / 2));
          }),
        )
        .toBe(true);
      await article.click();

      await expect(page).toHaveURL(new RegExp(`${post}$`));
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', blogHost + post);
      await expect(
        page.locator(`link[rel="alternate"][hreflang="${lang === 'zh' ? 'en' : 'zh'}"]`),
      ).toHaveAttribute('href', blogHost + alternate);
      await expect(content.locator('time')).toHaveAttribute('datetime', '2026-11-27');
      await expect(content.getByRole('link', { name: blog, exact: true })).toHaveAttribute(
        'href',
        index,
      );
    });
  }
});

test('both public Blog indexes and articles appear in the sitemap', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.ok()).toBeTruthy();
  const sitemap = await response.text();

  for (const { prefix } of locales) {
    const index = `${blogHost}${prefix}/blog/`;
    expect(sitemap).toContain(`<loc>${index}</loc>`);
    expect(sitemap).toContain(`<loc>${index}${articleSlug}/</loc>`);
  }
});

for (const { lang, prefix, search, searchField, query, title, blog } of locales) {
  test(`${lang} site search opens the editorial article`, async ({ page }) => {
    await page.goto(`${prefix}/`);
    await page.waitForFunction(() => customElements.get('open-search'));
    await page.getByRole('button', { name: search, exact: true }).click();
    await page.getByRole('combobox', { name: searchField }).fill(query);

    const article = page.getByRole('option').filter({ hasText: title });
    await expect(article.getByText(blog, { exact: true })).toBeVisible({ timeout: 30_000 });
    await article.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  });
}
