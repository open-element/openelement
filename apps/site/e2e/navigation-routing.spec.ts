/**
 * E2E: Navigation & Routing
 *
 * Verifies that navigation between pages works correctly:
 *   - Direct URL access loads correct page
 *   - Link navigation works across light and shadow roots
 *   - Layout custom elements are present
 *   - Page titles are correct per route
 *
 * NOTE: compiled page and layout components use light roots while some UI
 * package components retain Shadow DOM. Playwright role/element locators
 * pierce open shadow roots natively, so no hand-rolled deep queries.
 */

import { expect, test } from '@playwright/test';

test.describe('Direct URL Access', () => {
  const routes = [
    { path: '/', titleContains: 'openElement' },
    { path: '/guide/getting-started', titleContains: 'openElement' },
    { path: '/guide/architecture', titleContains: 'openElement' },
    { path: '/guide/islands-and-ssr', titleContains: 'openElement' },
    { path: '/architecture/dsd', titleContains: 'openElement' },
    { path: '/guide/routing-and-data', titleContains: 'openElement' },
    { path: '/changelog', titleContains: 'openElement' },
    { path: '/roadmap', titleContains: 'openElement' },
    { path: '/docs', titleContains: 'openElement' },
    { path: '/contributing', titleContains: 'openElement' },
    { path: '/apilist', titleContains: 'openElement' },
    { path: '/blog', titleContains: 'openElement' },
  ];

  for (const route of routes) {
    test(`"${route.path}" loads successfully with correct title`, async ({ page }) => {
      const response = await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      expect(response?.status()).toBeLessThan(400);
      const title = await page.title();
      expect(title).toContain(route.titleContains);
    });
  }
});

test.describe('Link Navigation', () => {
  test('homepage has working navigation links', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // getByRole('link') pierces open shadow roots natively — no hand-rolled
    // deep query required to cover links inside component shadow DOM.
    const hrefs = await page.getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    const internalLinks = hrefs.filter((href): href is string =>
      !!href &&
      !href.startsWith('http') &&
      !href.startsWith('mailto') &&
      !href.startsWith('#') &&
      !href.startsWith('//')
    );

    expect(internalLinks.length).toBeGreaterThan(0);
  });

  test('clicking a guide link navigates correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const guideLinks = await page.getByRole('link')
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute('href'))
          .filter((href): href is string => !!href && href.includes('/guide/'))
      );

    expect(guideLinks.length).toBeGreaterThan(0);

    await page.goto(guideLinks[0]);
    await page.waitForLoadState('networkidle');

    const url = page.url();
    expect(url).toContain('/guide/');
  });

  test('home-to-guide navigation loads the compiled route inside the app shell', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: 'Start building', exact: true }).first().click();

    await page.waitForURL(/\/guide\/getting-started\/?$/);
    // The route page element is slotted into the compiled light-root shell.
    await expect(page.locator('open-layout')).toHaveAttribute('data-oe-light', '');
    await expect(page.locator('guide-getting-started')).toHaveCount(1);
    await expect(page.locator('guide-getting-started open-article-view')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('navigating between guide pages preserves layout', async ({ page }) => {
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('networkidle');

    // Navigate to another guide page
    await page.goto('/guide/architecture');
    await page.waitForLoadState('networkidle');

    // The app shell landmarks survive the navigation (nested mains: shell +
    // page body — the first is the shell's).
    await expect(page.locator('open-layout')).toHaveCount(1);
    await expect(page.getByRole('main').first()).toBeVisible();
  });
});

test.describe('404 Page', () => {
  test('404.html is accessible and shows 404 content', async ({ page }) => {
    // Static file server needs the exact file path for 404.html
    await page.goto('/404.html');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
  });

  test('404 page has link back to home', async ({ page }) => {
    await page.goto('/404.html');
    await page.waitForLoadState('networkidle');

    // open-button renders a real anchored link inside its open shadow root.
    await expect(page.getByRole('link', { name: 'Back home' })).toHaveAttribute('href', '/');
  });
});

test.describe('Blog Pages', () => {
  test('blog index page loads', async ({ page }) => {
    await page.goto('/blog');
    await page.waitForLoadState('networkidle');

    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('blog index has blog post links', async ({ page }) => {
    await page.goto('/blog');
    await page.waitForLoadState('networkidle');

    // Blog index should have links to individual posts.
    const blogLinks = await page.locator('blog-index').getByRole('link')
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute('href'))
          .filter((href): href is string => !!href && /^\/blog\/.+/.test(href))
      );

    expect(blogLinks.length).toBeGreaterThan(0);
  });

  test('individual blog post loads', async ({ page }) => {
    await page.goto('/blog');
    await page.waitForLoadState('networkidle');

    // Follow the first post link the index actually renders — never assume a
    // slug pattern.
    const firstPostLink = await page.locator('blog-index').getByRole('link')
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute('href'))
          .find((href) => !!href && /^\/blog\/.+/.test(href)) ?? null
      );

    expect(firstPostLink).not.toBeNull();
    await page.goto(firstPostLink!);
    await page.waitForLoadState('networkidle');

    const title = await page.title();
    expect(title).toBeTruthy();
  });
});
