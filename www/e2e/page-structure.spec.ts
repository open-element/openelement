import { expect, test } from '@playwright/test';

// Fonts are self-hosted (www/site-fonts.ts): every face is a same-origin
// asset emitted by the build, so page loads wait on no third-party CDN and
// this spec needs no CDN route abort.

const readingRoutes = [
  '/guide/getting-started',
  '/guide/routing-and-data',
  '/architecture/dsd',
  '/architecture/islands',
];

const guideRoutes = [
  '/guide/getting-started',
  '/guide/core-concepts',
  '/guide/compiled-grammar',
  '/guide/routing-and-data',
  '/guide/streaming',
  '/guide/mdx',
  '/guide/api',
  '/guide/configuration',
  '/guide/error-handling',
  '/guide/islands-and-ssr',
  '/guide/deployment',
  '/guide/testing',
  '/guide/security',
];

const architectureRoutes = [
  '/architecture',
  '/architecture/dsd',
  '/architecture/comparison',
  '/architecture/islands',
  '/architecture/design-system',
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
    await expect(page.locator('open-reading-shell[rail]')).toHaveCount(1);
    await expect(page.locator('open-reading-shell h1:visible')).toHaveCount(1);
  });

  test('404 remains a compact recovery scene without WebGL', async ({ page }) => {
    await page.goto('/404');
    const scene = page.locator('.page-404');
    await expect(scene.locator('h1')).toHaveText('404');
    await expect(scene).toContainText('Lost in the shadow DOM.');
    await expect(scene.locator('open-button[href="/"]')).toHaveCount(1);
    await expect(scene.locator('open-button[href="/docs"]')).toHaveCount(1);
  });

  test('docs landing is a v4 manual index with five entrances', async ({ page }) => {
    await page.goto('/docs');
    const hub = page.locator('.page-docs');
    await expect(hub.locator('h1')).toContainText('MANUAL.');
    const entrances = hub.getByRole('link');
    await expect(entrances).toHaveCount(5);
    await expect(entrances.first()).toHaveAttribute('href', '/guide/getting-started');
    // The tutorial is the guided second step, not just a sidebar entry.
    await expect(entrances.nth(1)).toHaveAttribute('href', '/guide/tutorial');
  });

  test('blog index is a v4 dispatch journal with a featured band', async ({ page, request }) => {
    await page.goto('/blog');
    // The retired <blog-index> host became the page hook class (page-blog-index)
    // when the route migrated to a server function page (alpha15).
    const index = page.locator('.page-blog-index');
    await expect(index.locator('h1')).toHaveText('Dispatches.');
    // The 1.0 baseline ships one dispatch; it is the featured band and the
    // stream renders any earlier dispatches. Assert the featured post is real
    // and that every post link on the index resolves.
    // The featured band is the index's only post anchor that carries an h2
    // (stream rows carry h3); the presentation class it used to be found by
    // went away with the utility-first migration.
    const featured = index.locator('a:has(h2)').first();
    await expect(featured).toHaveAttribute('href', /\/blog\/.+/);
    await expect(featured.locator('h2')).toBeVisible();
    const hrefs = await index
      .locator('a[href^="/blog/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const res = await request.get(href);
      expect(res.ok()).toBe(true);
    }
  });

  test('contributing is a v4 lab page with terminal, checklist and help rows', async ({ page }) => {
    await page.goto('/contributing');
    const lab = page.locator('.page-contributing');
    await expect(lab.locator('h1')).toContainText('BUILD IT');
    await expect(lab.locator('open-code-block')).toHaveCount(1);
    expect(await lab.locator('.checklist li').count()).toBeGreaterThan(0);
    expect(await lab.locator('.help-row').count()).toBe(3);
  });

  test('former hero pages render content-first, without a mega hero', async ({ page }) => {
    // The editorial mega hero pushed all content below the fold; these pages
    // now lead with the compact reading-shell/article header (#1087 cleanup).
    for (const route of [
      '/reference',
      '/roadmap',
      '/architecture',
      '/architecture/design-system',
    ]) {
      await page.goto(route);
      await expect(page.locator('h1:visible')).toHaveCount(1);
    }
  });

  test('data-driven entry pages compose their body with shared section frames', async ({
    page,
  }) => {
    for (const route of ['/reference', '/roadmap']) {
      await page.goto(route);
      expect(await page.locator('open-section-frame').count()).toBeGreaterThan(0);
    }
  });

  test('compiled light section frames project named and default content in place', async ({
    page,
  }) => {
    await page.goto('/reference');
    // The retired <reference-page> host became the page hook class
    // (page-reference) with the server function page migration (alpha15);
    // the frame locator is rooted at it so frames of other routes cannot match.
    const frames = page.locator('.page-reference open-section-frame[data-oe-light]');
    // Light DOM only: the page hook is a class on a light-div (no shadow root
    // to pierce), so every one of the page's frames is addressable.
    await expect(frames).toHaveCount(5);
    await expect(frames.first().locator('h2')).toContainText(
      'Authoring starts at product packages.',
    );
    // The second frame's body is the package registry; `.registry` went away
    // with the utility-first migration, and the generated rows now carry their
    // kind as data (the generated anchor id is not stable across packages).
    await expect(frames.nth(1).locator('[data-kind]').first()).toBeVisible();
  });

  test('reference renders the generated export and element reference with stable anchors (#1307)', async ({
    page,
  }) => {
    await page.goto('/reference');
    // Every generated searchRecord anchor resolves to a rendered entry.
    // (adapter-vite anchors retired with the package; use a current export.)
    const exportRow = page.locator('#api-element-root-Action');
    await expect(exportRow).toBeVisible();
    // The row leads with its name cell; `.ref-name` went away with the
    // utility-first migration.
    await expect(exportRow.locator('span').first()).toHaveText('Action');
    const elementRow = page.locator('#ce-open-button');
    await expect(elementRow).toBeVisible();
    await expect(elementRow.locator('span').first()).toHaveText('<open-button>');
    // Export rows are the generated `api-*` anchors.
    expect(await page.locator('[id^="api-"]').count()).toBeGreaterThan(150);
    // #1557 retired the four zero-interaction ui components: the element
    // reference table carries the frozen six-component roster.
    // Element rows are the generated `ce-*` anchors.
    expect(await page.locator('[id^="ce-"]').count()).toBe(6);
    // zh renders the same generated anchors with zh chrome.
    await page.goto('/zh/reference');
    await expect(page.locator('#ce-open-input')).toBeVisible();
    await expect(page.locator('[id^="api-"]').first()).toBeVisible();
  });

  test('roadmap standards visual renders through the compiled light root', async ({ page }) => {
    await page.goto('/roadmap');
    const visual = page.locator('open-standards-visual');
    await expect(visual).toHaveAttribute('data-oe-light', '');
    expect(await visual.locator(':scope > *').count()).toBeGreaterThan(0);
  });

  test('blog articles SSR their outline and deterministic navigation without mojibake', async ({
    page,
  }) => {
    // The baseline's dispatch post; ADR pages are excluded from prev/next and
    // render an empty (hidden) pager.
    await page.goto('/zh/blog/1-0-0-alpha-1-baseline');
    const rail = page.locator('open-page-rail');
    await expect(rail).toBeVisible();
    expect(await rail.locator('a[href^="#"]').count()).toBeGreaterThan(0);
    await expect(page.locator('body')).not.toContainText(/鏂|鈫|鍗|杩|鏈/);
    // The pager is deterministic: it is visible exactly when the post has
    // prev/next neighbors. The baseline ships a single dispatch, so no
    // neighbors means the pager renders hidden. The label follows the page
    // locale (zh here).
    const pager = page.getByRole('navigation', { name: '页面导航' });
    await expect(pager).toHaveCount(1);
    if ((await pager.locator('a:visible').count()) > 0) {
      await expect(pager).toBeVisible();
    } else {
      await expect(pager).toBeHidden();
    }
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

  test('reading information remains complete without IntersectionObserver or View Transitions', async ({
    page,
  }) => {
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
    const outlineLinks = page
      .getByRole('complementary', { name: 'On this page' })
      .locator('a[href^="#"]:not(details a)');
    // #start plus this page's ten section headings (seven h2 + three h3 — the
    // outline carries both levels), all present in the SSR payload — the
    // outline does not wait for a client observer. The count is pinned so a
    // content change that silently truncates the outline fails here rather
    // than shipping. Eleven since #1372 grammar-bound + #1414 content.
    await expect(outlineLinks).toHaveCount(11);
    await expect(outlineLinks.first()).toHaveAttribute('href', '#start');
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

  test('long-form pages do not scroll horizontally at 390px', async ({ page }) => {
    // The four pages whose generated/authored content carries unbreakable
    // tokens (reference summaries and option lists with Markdown URLs, archive
    // identifiers, config identifiers, the setup fence) overflowed the viewport
    // at 390px — measured 276/16/79/50px. The fixes are per-owner: break
    // opportunities for text runs (overflow-wrap) and block-internal scroll
    // for the fence. This pins the acceptance criterion (document scrollWidth
    // equals its clientWidth) so a new long token or a re-flowed grid fails
    // here instead of shipping a page that pans.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ['/reference', '/changelog', '/contributing', '/guide/configuration']) {
      await page.goto(route);
      // The layout is the one landmark every page shares (the app-layout
      // convention shell replaced the retired open-layout island).
      await expect(page.locator('app-layout').first()).toBeVisible();
      // Wrap points depend on font metrics: measure after the faces settle.
      await page.evaluate(() => document.fonts.ready);
      const state = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(state.scrollWidth, `${route} overflows horizontally at 390px`).toEqual(
        state.clientWidth,
      );
    }
  });
});
