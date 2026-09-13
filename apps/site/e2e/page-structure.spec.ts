import { expect, test } from '@playwright/test';

const readingRoutes = [
  '/guide/getting-started',
  '/guide/routing-and-data',
  '/architecture/dsd',
  '/architecture/islands-deep',
  '/architecture/package-compatibility',
];

const guideRoutes = [
  '/guide/getting-started',
  '/guide/core-concepts',
  '/guide/architecture',
  '/guide/comparison',
  '/guide/routing-and-data',
  '/guide/mdx',
  '/guide/api',
  '/guide/configuration',
  '/guide/error-handling',
  '/guide/islands-and-ssr',
  '/guide/deployment',
  '/guide/testing',
  '/guide/migration',
  '/guide/security',
];

const architectureRoutes = [
  '/architecture/dsd',
  '/architecture/comparison',
  '/architecture/islands',
  '/architecture/islands-deep',
  '/architecture/package-compatibility',
  '/architecture/benchmark',
  '/architecture/standards-registry',
];

test.describe('Unified page structure', () => {
  for (const route of readingRoutes) {
    test(`${route} uses the WWW reading shell`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('open-reading-shell')).toHaveCount(1);
      await expect(page.locator('open-reading-shell h1')).toBeVisible();
    });
  }

  for (const route of [...guideRoutes, ...architectureRoutes]) {
    test(`${route} has a railed, keyboard-readable section outline`, async ({ page }) => {
      await page.goto(route);
      const rail = page.locator('open-reading-shell[rail] open-page-rail');
      await expect(rail).toHaveCount(1);
      await expect(rail).toBeVisible();
      // The rail links render async after the shell upgrades; poll instead
      // of sleeping a fixed interval.
      await expect(rail.locator('a').first()).toBeVisible();
    });
  }

  test('changelog renders content-first with a railed reading surface', async ({ page }) => {
    await page.goto('/changelog');
    await expect(page.locator('open-page-hero')).toHaveCount(0);
    await expect(page.locator('open-reading-shell[rail]')).toHaveCount(1);
    await expect(page.locator('open-reading-shell h1:visible')).toHaveCount(1);
  });

  test('404 remains a compact recovery scene without WebGL', async ({ page }) => {
    await page.goto('/404');
    await expect(page.locator('open-cinematic-atmosphere')).toHaveCount(0);
    const scene = page.locator('el-404');
    await expect(scene.locator('h1')).toHaveText('404');
    await expect(scene).toContainText('Lost in the shadow DOM.');
    await expect(scene.locator('open-button[href="/"]')).toHaveCount(1);
    await expect(scene.locator('open-button[href="/docs"]')).toHaveCount(1);
  });

  test('docs landing is a v4 manual index with four entrances', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.locator('docs-index h1')).toContainText('MANUAL.');
    const entrances = page.locator('docs-index').getByRole('link');
    await expect(entrances).toHaveCount(4);
    await expect(entrances.first()).toHaveAttribute('href', '/guide/getting-started');
  });

  test('blog index is a v4 dispatch journal with a featured band', async ({ page }) => {
    await page.goto('/blog');
    await expect(page.locator('blog-index h1')).toHaveText('Dispatches.');
    await expect(page.locator('blog-index .featured')).toHaveAttribute('href', /\/blog\/.+/);
    expect(await page.locator('blog-index .row').count()).toBeGreaterThan(0);
  });

  test('contributing is a v4 lab page with terminal, checklist and help rows', async ({ page }) => {
    await page.goto('/contributing');
    await expect(page.locator('contributing-page h1')).toContainText('BUILD IT');
    await expect(page.locator('contributing-page open-code-block')).toHaveCount(1);
    expect(await page.locator('contributing-page .checklist li').count()).toBeGreaterThan(0);
    expect(await page.locator('contributing-page .help-row').count()).toBe(3);
  });

  test('former hero pages render content-first, without a mega hero', async ({ page }) => {
    // The editorial mega hero pushed all content below the fold; these pages
    // now lead with the compact reading-shell/article header (#1087 cleanup).
    for (
      const route of [
        '/apilist',
        '/roadmap',
        '/architecture/architecture',
        '/architecture/design-system',
      ]
    ) {
      await page.goto(route);
      await expect(page.locator('open-page-hero')).toHaveCount(0);
      await expect(page.locator('h1:visible')).toHaveCount(1);
    }
  });

  test('data-driven entry pages compose their body with shared section frames', async ({ page }) => {
    for (
      const route of [
        '/apilist',
        '/roadmap',
      ]
    ) {
      await page.goto(route);
      expect(await page.locator('open-section-frame').count()).toBeGreaterThan(0);
    }
  });

  test('compiled light section frames project named and default content in place', async ({ page }) => {
    await page.goto('/apilist');
    const frames = page.locator('apilist-page open-section-frame[data-oe-light]');
    await expect(frames).toHaveCount(4);
    await expect(frames.first().locator('.frame .title')).toContainText(
      'Authoring starts at product packages.',
    );
    await expect(frames.nth(1).locator('.frame .body .registry')).toBeVisible();
  });

  test('apilist renders the generated export and element reference with stable anchors (#1307)', async ({ page }) => {
    await page.goto('/apilist');
    // Every generated searchRecord anchor resolves to a rendered entry.
    const exportRow = page.locator('#api-adapter-vite-root-buildApp');
    await expect(exportRow).toBeVisible();
    await expect(exportRow.locator('.ref-name')).toHaveText('buildApp');
    const elementRow = page.locator('#ce-open-button');
    await expect(elementRow).toBeVisible();
    await expect(elementRow.locator('.ce-tag')).toHaveText('<open-button>');
    expect(await page.locator('.ref-row').count()).toBeGreaterThan(150);
    expect(await page.locator('.ce-row').count()).toBe(10);
    // zh renders the same generated anchors with zh chrome.
    await page.goto('/zh/apilist');
    await expect(page.locator('#ce-open-badge')).toBeVisible();
    await expect(page.locator('.ref-row').first()).toBeVisible();
  });

  test('roadmap standards visual renders through the compiled light root', async ({ page }) => {
    await page.goto('/roadmap');
    const visual = page.locator('open-standards-visual');
    await expect(visual).toHaveAttribute('data-oe-light', '');
    expect(await visual.locator(':scope > *').count()).toBeGreaterThan(0);
  });

  test('blog articles SSR their outline and deterministic navigation without mojibake', async ({ page }) => {
    // A dispatch post with neighbors in the index-visible order (#1066); ADR
    // pages are excluded from prev/next and render an empty (hidden) pager.
    await page.goto('/zh/blog/0100-three-audits-later-the-stable-line');
    const rail = page.locator('open-page-rail');
    await expect(rail).toBeVisible();
    expect(await rail.locator('a[href^="#"]').count()).toBeGreaterThan(0);
    await expect(page.locator('body')).not.toContainText(/鏂|鈫|鍗|杩|鏈/);
    await expect(page.getByRole('navigation', { name: 'Page navigation' }))
      .toBeVisible();
  });

  test('mobile rail is a native details drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/guide/getting-started');
    const details = page.locator('open-page-rail details');
    await expect(details).toBeVisible();
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
  });

  test('deep fragments scroll inside DSD on click, direct load, and history', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/guide/getting-started');
    const first = page.locator('open-page-rail a[href^="#"]').first();
    const hash = await first.getAttribute('href');
    expect(hash).toBeTruthy();
    await first.click();
    await expect(page).toHaveURL((url) => url.hash === hash);
    await expect(page.locator(hash!)).toHaveAttribute('data-open-target', '');

    await page.goto(`/guide/getting-started${hash}`);
    await expect(page.locator(hash!)).toHaveAttribute('data-open-target', '');
    await page.evaluate(() => history.pushState(null, '', '#missing-fragment'));
    await page.goBack();
    await expect(page.locator(hash!)).toHaveAttribute('data-open-target', '');

    await page.evaluate(() => {
      const malformed = document.createElement('a');
      malformed.href = '#%ZZ';
      document.body.append(malformed);
      malformed.click();
      malformed.remove();
    });
    expect(pageErrors).toEqual([]);
  });

  test('reading information remains complete without IntersectionObserver or View Transitions', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'IntersectionObserver', {
        value: undefined,
        configurable: true,
      });
      Object.defineProperty(document, 'startViewTransition', {
        value: undefined,
        configurable: true,
      });
    });
    await page.goto('/guide/core-concepts');
    await expect(page.locator('open-reading-shell').locator('h1')).toContainText('Core Concepts');
    // The rail outline is the 'On this page' complementary landmark; the
    // persistent desktop outline links are the ones outside the mobile
    // details drawer (the drawer duplicates the same fragments on small
    // viewports).
    const outlineLinks = page.getByRole('complementary', { name: 'On this page' })
      .locator('a[href^="#"]:not(details a)');
    await expect(outlineLinks).toHaveCount(4);
    await expect(outlineLinks.first()).toHaveAttribute('href', '#start');
  });

  test('non-home routes never load the WebGL atmosphere layer', async ({ page }) => {
    for (
      const route of [
        '/docs',
        '/apilist',
        '/roadmap',
        '/architecture/dsd',
        '/guide/getting-started',
        '/blog',
        '/changelog',
        '/404',
      ]
    ) {
      await page.goto(route);
      await expect(page.locator('open-cinematic-atmosphere')).toHaveCount(0);
    }
  });

  test('reading shell remains usable at 200 percent zoom', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/guide/getting-started');
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expect(page.locator('open-reading-shell').locator('h1')).toBeVisible();
    await expect(page.locator('open-page-rail')).toBeVisible();
  });
});
