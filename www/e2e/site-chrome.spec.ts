/**
 * E2E: Site chrome — docs sidebar and footer (#1317, B2 closure).
 *
 * The compiled-shell refactor (7bbef34b, ADR-0143) dropped the docs sidebar
 * and reduced the footer to a bare strip, and the public-route suite missed it
 * because it only asserted main-landmark+h1 per route. This suite codifies the
 * restored chrome per layout class with semantic assertions — landmarks,
 * navigation roles, aria-current, and link targets. No pixel baselines are
 * maintained for the Site; this suite is the visual contract that runs.
 *
 * Layout classes under test:
 *   - reading layouts (/guide/*, /architecture/*): filtered section sidebar
 *     consuming the generated navSections, plus the full footer
 *   - home (/): no sidebar, full footer
 *   - zh locale: localized sidebar targets and bilingual footer columns
 *   - mobile viewport: sidebar collapses into a native details disclosure
 */

import { expect, test } from '@playwright/test';

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

const FOOTER_COLUMNS_EN = ['Product', 'Resources', 'Company', 'Legal'] as const;
const FOOTER_COLUMNS_ZH = ['产品', '资源', '项目', '法律'] as const;

test.describe('Site chrome: docs sidebar', () => {
  test('guide pages render the filtered section sidebar with the active page marked', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const sidebar = page.getByRole('navigation', { name: 'Documentation navigation' });
    await expect(sidebar).toBeVisible();

    // Section headings come from the generated navSections tree.
    await expect(sidebar.getByText('Quick Start', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Guide', { exact: true })).toBeVisible();

    // The current page is marked exactly once, on its own link.
    const current = sidebar.getByRole('link', { name: 'Getting Started' });
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1);

    // Sidebar link targets are real in-site routes (or explicit externals).
    const hrefs = await sidebar.getByRole('link').evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? '')
    );
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      expect(href.startsWith('/') || href.startsWith('https://')).toBe(true);
    }
    // Spot-resolve one sidebar target end to end.
    await sidebar.getByRole('link', { name: 'API Routes' }).click();
    await page.waitForURL(/\/guide\/api\/?$/);
    await expect(page.getByRole('main').first()).toBeVisible();
  });

  test('architecture pages filter the sidebar to the architecture family', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/architecture/dsd');
    await page.waitForLoadState('networkidle');

    const sidebar = page.getByRole('navigation', { name: 'Documentation navigation' });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('Principles', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Reference', { exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'DSD Rendering' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The guide family is filtered out on architecture routes.
    await expect(sidebar.getByRole('link', { name: 'Getting Started' })).toHaveCount(0);
  });

  test('the home layout renders no sidebar', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('navigation', { name: 'Documentation navigation' })).toBeHidden();
  });

  test('zh guide pages localize the sidebar landmark, labels, and link targets', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/zh/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const sidebar = page.getByRole('navigation', { name: '文档导航' });
    await expect(sidebar).toBeVisible();
    // Sidebar labels follow the zh content titles (快速开始 / API 路由).
    // Integration review: confirm final zh nav copy with the content agent.
    const current = sidebar.getByRole('link', { name: '快速开始' });
    await expect(current).toHaveAttribute('href', '/zh/guide/getting-started');
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(sidebar.getByRole('link', { name: 'API 路由' })).toHaveAttribute(
      'href',
      '/zh/guide/api',
    );
    await expect(sidebar.getByRole('link', { name: 'Getting Started' })).toHaveCount(0);
  });

  test('mobile reading layouts expose the sidebar through a native disclosure', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('networkidle');

    // The desktop sidebar is out of the accessibility tree at mobile width; the
    // section navigation lives behind a details/summary disclosure instead.
    const disclosure = page.locator('details', { hasText: 'Documentation' }).first();
    await expect(disclosure).toBeVisible();
    await expect(disclosure).not.toHaveAttribute('open', '');
    await disclosure.locator('summary').click();
    await expect(disclosure).toHaveAttribute('open', '');
    const panel = page.getByRole('navigation', { name: 'Documentation navigation' });
    await expect(panel.getByRole('link', { name: 'Getting Started' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'API Routes' })).toHaveAttribute(
      'href',
      '/guide/api',
    );
  });
});

test.describe('Site chrome: footer', () => {
  for (const route of ['/', '/guide/getting-started', '/architecture/dsd']) {
    test(`footer on ${route} exposes the four labeled navigation columns`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const footer = page.getByRole('contentinfo');
      await expect(footer).toHaveCount(1);
      for (const column of FOOTER_COLUMNS_EN) {
        await expect(footer.getByRole('navigation', { name: column })).toBeVisible();
      }
      // Column link targets resolve to real routes; externals are explicit.
      await expect(
        footer.getByRole('navigation', { name: 'Resources' }).getByRole('link', { name: 'Guide' }),
      ).toHaveAttribute('href', '/guide/getting-started');
      await expect(
        footer.getByRole('navigation', { name: 'Company' }).getByRole('link', { name: 'GitHub' }),
      ).toHaveAttribute('href', 'https://github.com/open-element/openelement');
      await expect(
        footer.getByRole('navigation', { name: 'Legal' }).getByRole('link', {
          name: 'MIT License',
        }),
      ).toHaveAttribute('href', 'https://github.com/open-element/openelement/blob/main/LICENSE');
      await expect(footer).toContainText('(c) 2026 openElement. MIT License.');
    });
  }

  test('zh pages render the footer bilingually with localized targets', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/zh/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const footer = page.getByRole('contentinfo');
    for (const column of FOOTER_COLUMNS_ZH) {
      await expect(footer.getByRole('navigation', { name: column })).toBeVisible();
    }
    await expect(
      footer.getByRole('navigation', { name: '资源' }).getByRole('link', { name: '指南' }),
    ).toHaveAttribute('href', '/zh/guide/getting-started');
    await expect(
      footer.getByRole('navigation', { name: '项目' }).getByRole('link', { name: '路线图' }),
    ).toHaveAttribute('href', '/zh/roadmap');
  });

  test('mobile viewports keep the full footer chrome', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeVisible();
    for (const column of FOOTER_COLUMNS_EN) {
      await expect(footer.getByRole('navigation', { name: column })).toBeVisible();
    }
  });
});

test.describe('Site chrome: skip link and language switcher', () => {
  // Integration review: the skip link and the header language switcher land
  // with the parallel open-layout header work; selectors here pin the
  // contract (href targets), not the final visible copy.
  for (const route of ['/', '/guide/getting-started', '/zh/guide/getting-started']) {
    test(`skip link on ${route} targets #main-content`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const skip = page.locator('a[href="#main-content"]').first();
      await expect(skip).toBeAttached();
      // The href is meaningless without its anchor target.
      await expect(page.locator('#main-content')).toHaveCount(1);
    });
  }

  test('zh pages link to the English twin from the header switcher', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/zh/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const banner = page.getByRole('banner');
    await expect(banner.locator('a[href="/guide/getting-started"]')).toHaveCount(1);
  });

  test('en pages link to the zh twin from the header switcher', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const banner = page.getByRole('banner');
    await expect(banner.locator('a[href="/zh/guide/getting-started"]')).toHaveCount(1);
  });
});

test.describe('Site chrome: header repository link', () => {
  const REPOSITORY = 'https://github.com/open-element/openelement';

  test('the header exposes one labeled repository link beside the theme toggle', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const banner = page.getByRole('banner');
    const link = banner.getByRole('link', { name: 'GitHub repository' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', REPOSITORY);
    // External target: new tab plus the rel that strips the opener handle.
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    // Icon-only control: the accessible name must come from aria-label, and
    // the mark itself must stay out of the accessibility tree.
    await expect(link.locator('svg[aria-hidden="true"]')).toHaveCount(1);
    // The header carries exactly one repository link (the footer has its own).
    await expect(banner.locator(`a[href="${REPOSITORY}"]`)).toHaveCount(1);
  });

  test('zh pages localize the repository link label', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/zh/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: 'GitHub 仓库（在新标签页打开）' })).toBeVisible();
  });

  test('mobile viewports keep the repository link in the header cluster', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('banner').getByRole('link', { name: 'GitHub repository' }),
    ).toBeVisible();
  });
});
