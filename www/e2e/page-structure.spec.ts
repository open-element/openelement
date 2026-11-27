import { expect, test } from '@playwright/test';
import { installCommand } from '../app/data/_generated-install-command.ts';

// Fonts are self-hosted (www/site-fonts.ts): every face is a same-origin
// asset emitted by the build, so page loads wait on no third-party CDN and
// this spec needs no CDN route abort.

const readingRoutes = [
  '/guide/getting-started/',
  '/guide/routing-and-data/',
  '/architecture/dsd/',
  '/guide/islands-and-ssr/',
];

const guideRoutes = [
  '/guide/getting-started/',
  '/guide/core-concepts/',
  '/guide/compiled-grammar',
  '/guide/routing-and-data/',
  '/guide/mdx',
  '/guide/api/',
  '/guide/configuration/',
  '/guide/error-handling/',
  '/guide/islands-and-ssr/',
  '/guide/deployment/',
  '/guide/testing',
  '/guide/security',
];

const architectureRoutes = [
  '/architecture/',
  '/architecture/dsd/',
  '/architecture/web-component-admission/',
  '/architecture/design-system/',
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

  test('release status shows npm and source versions without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.goto('/changelog/');
      await expect(page.getByRole('heading', { level: 1, name: 'Changelog' })).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Read release notes and breaking changes on GitHub' }),
      ).toHaveAttribute('href', 'https://github.com/open-element/openelement/releases');
      await expect(page.locator('#published')).toContainText('latest');
      await expect(
        page.locator('#published').getByRole('link', { name: '@openelement/router' }),
      ).toHaveAttribute('href', 'https://www.npmjs.com/package/@openelement/router');
      await expect(
        page.locator('#source').getByRole('heading', { name: 'Source checkout' }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('404 remains a compact recovery scene without WebGL', async ({ page }) => {
    await page.goto('/404');
    const scene = page.locator('.page-404');
    await expect(scene.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(scene.locator('.code')).toHaveText('404');
    await expect(scene).toContainText('This link may be out of date');
    await expect(scene.locator('.marquee')).toHaveCount(0);
    await expect(scene.locator('open-button[href="/"]')).toHaveCount(1);
    await expect(scene.locator('open-button[href="/docs/"]')).toHaveCount(1);
  });

  for (const { prefix, search, home, docs, correction, typo } of [
    {
      prefix: '',
      search: 'Search the docs',
      home: 'Back home',
      docs: 'Read the docs',
      correction: 'Getting Started',
      typo: 'getting-strated',
    },
    {
      prefix: '/zh',
      search: '搜索文档',
      home: '回到首页',
      docs: '阅读文档',
      correction: '快速开始',
      typo: 'getting-startd',
    },
  ]) {
    test(`${prefix || '/'} shows its first install command on a phone`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${prefix}/guide/getting-started/`);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const command = page.locator('.article-content pre').first();
      await expect(command).toContainText(installCommand);
      await expect(command).toBeInViewport();
    });

    test(`${prefix || '/'} 404 opens search locally and restores the recovery action`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${prefix}/404`);
      await expect(page.locator('#main-content > details')).toBeHidden();
      const action = page.getByRole('main').getByRole('button', { name: search });
      await expect(action).toBeInViewport();
      await action.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('combobox')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(action).toBeFocused();
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.locator('.oe-content-frame > nav')).toBeHidden();
    });

    test(`${prefix || '/'} 404 offers a real page for a close URL typo`, async ({ page }) => {
      const wrong = `${prefix}/guide/${typo}/`;
      const unrelated = `${prefix}/guide/unrelated-destination/`;
      // The test server uses a plain unmatched response. Reproduce the deployed
      // error-document fallback while keeping the browser on the missing URL.
      await page.route(
        (url) => [wrong, unrelated].includes(url.pathname),
        async (route) => {
          const response = await route.fetch({
            url: new URL(`${prefix}/404`, route.request().url()).href,
          });
          await route.fulfill({ response, status: 404 });
        },
      );
      expect((await page.goto(wrong))?.status()).toBe(404);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
      const suggestion = page.locator('[data-not-found-suggestion]');
      const destination = suggestion.getByRole('link', { name: correction });
      await expect(destination).toHaveAttribute('href', `${prefix}/guide/getting-started/`);
      const duplicate = page.locator(
        `.page-404 .popular a[href="${prefix}/guide/getting-started/"]`,
      );
      await expect(duplicate).toBeHidden();
      await destination.press('Enter');
      await expect(page).toHaveURL(new RegExp(`${prefix}/guide/getting-started/$`));

      expect((await page.goto(unrelated))?.status()).toBe(404);
      await expect(page.getByRole('main').getByRole('button', { name: search })).toBeVisible();
      await expect(suggestion).toBeHidden();
      await expect(duplicate).toBeVisible();
    });

    test(`${prefix || '/'} 404 keeps home and docs recovery links without JavaScript`, async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
      try {
        const page = await context.newPage();
        await page.goto(`${prefix}/404`);
        const main = page.getByRole('main');
        await expect(main.locator('[data-search-recovery]')).toBeHidden();
        await expect(main.locator('[data-not-found-suggestion]')).toBeHidden();
        await expect(main.getByRole('link', { name: home })).toHaveAttribute('href', `${prefix}/`);
        await expect(main.getByRole('link', { name: docs })).toHaveAttribute(
          'href',
          `${prefix}/docs/`,
        );
      } finally {
        await context.close();
      }
    });

    test(`${prefix || '/'} contributing setup wraps the clone command on a phone`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${prefix}/contributing/`);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const code = page.locator('#contributing-setup-commands pre');
      await expect(code).toHaveCSS('white-space', 'pre-wrap');
      await expect.poll(() => code.evaluate((pre) => pre.scrollWidth - pre.clientWidth)).toBe(0);
      expect((await code.textContent())?.split('\n')[0]).toBe(
        'git clone https://github.com/open-element/openelement.git',
      );
    });
  }

  test('docs landing offers four task routes alongside the complete sidebar', async ({ page }) => {
    await page.goto('/docs/');
    const hub = page.locator('.page-docs');
    await expect(hub.getByRole('heading', { level: 1 })).toHaveText('Documentation');
    const sections = hub.getByRole('navigation', { name: 'Documentation sections' });
    await expect(sections.locator(':scope > section > h2')).toHaveText([
      'LEARN',
      'GUIDES',
      'REFERENCE',
      'PROJECT',
    ]);
    const sectionLinks = sections.getByRole('link');
    await expect(sectionLinks).toHaveText([
      'Read about hydration',
      'Build a form action',
      'Browse exported symbols',
      'Read the release roadmap',
    ]);
    const sidebarLinks = page.locator('.oe-content-frame > nav').getByRole('link');
    await expect(sidebarLinks).toHaveCount(28);
    const paths = await sectionLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute('href')),
    );
    expect(paths).toEqual([
      '/guide/islands-and-ssr/#hydration-boundary',
      '/guide/routing-and-data/#form-actions',
      '/reference/#api-reference',
      '/roadmap/#release-line',
    ]);
    const tree = await sidebarLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute('href')),
    );
    expect(paths.some((href) => tree.includes(href))).toBe(false);
    const start = hub.getByRole('region', { name: 'Start here' });
    await expect(start.getByRole('link')).toHaveCount(3);
    await expect(start.getByRole('link').nth(1)).toHaveAttribute('href', '/guide/tutorial/');
    await expect(hub.getByRole('link', { name: /Release status/ })).toHaveAttribute(
      'href',
      '/changelog/',
    );
    const disclosure = hub.locator('details');
    await expect(disclosure).not.toHaveAttribute('open', '');
    await disclosure.locator('summary').getByText('Examples', { exact: true }).click();
    const examples = hub.getByRole('region', { name: 'Example scenarios' });
    await expect(examples).toHaveCount(1);
    await expect(examples.getByRole('heading', { level: 2 })).toHaveText([
      'Static-first page',
      'Reusable Custom Element',
      'SSR + island',
      'Form + routing',
    ]);
    await expect(examples.locator('ul > li')).toHaveCount(4);
    await expect(examples.locator('ol')).toHaveCount(0);
    await expect(examples.locator('a[target="_blank"]')).toHaveCount(4);
    await expect(examples.getByText('Run (repo root)', { exact: true })).toHaveCount(3);
    const starter = examples.getByRole('listitem').filter({ hasText: 'Reusable Custom Element' });
    await expect(starter.getByText('Run (new app)', { exact: true })).toBeVisible();
    await expect(starter.locator('code')).toHaveText(
      'npm create @openelement my-app && cd my-app && npm run dev',
    );
    await expect(examples).toContainText('clone https://github.com/open-element/openelement');
  });

  test('Chinese docs landing keeps the first step and optional examples in Chinese', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/zh/docs/');
    const hub = page.locator('.page-docs');
    await expect(hub.getByRole('heading', { level: 1 })).toHaveText('文档');
    const start = hub.getByRole('region', { name: '从这里开始' }).getByRole('link').first();
    await expect(start).toBeInViewport();
    await expect(start).toHaveAttribute('href', '/zh/guide/getting-started/');
    await expect(hub.getByRole('link', { name: /发布状态/ })).toHaveAttribute(
      'href',
      '/zh/changelog/',
    );
    const paths = hub.getByRole('navigation', { name: '文档分区' }).getByRole('link');
    await expect(paths).toHaveText([
      '了解水合边界',
      '实现表单提交',
      '浏览导出项',
      '查看发布路线图',
    ]);
    expect(
      await paths.evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual([
      '/zh/guide/islands-and-ssr/#hydration-边界',
      '/zh/guide/routing-and-data/#表单-action',
      '/zh/reference/#api-reference',
      '/zh/roadmap/#release-line',
    ]);
    await hub.locator('details > summary').getByText('示例', { exact: true }).click();
    await expect(hub.getByRole('region', { name: '示例场景' }).getByRole('listitem')).toHaveCount(
      4,
    );
  });

  test('the hub, guides, reference, and errors share one desktop sidebar frame', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1467, height: 900 });
    const frames = [];
    for (const path of [
      '/zh/docs/',
      '/zh/guide/getting-started/',
      '/zh/reference/',
      '/zh/errors/',
    ]) {
      await page.goto(path);
      const frame = page.locator('.oe-content-frame');
      const sidebar = frame.locator(':scope > nav');
      await expect(sidebar).toBeVisible();
      frames.push({
        clientWidth: await page.evaluate(() => document.documentElement.clientWidth),
        frame: (await frame.boundingBox())!,
        sidebar: (await sidebar.boundingBox())!,
      });
    }
    for (const current of frames) {
      expect(current.frame.width).toBeCloseTo(1240, 0);
      expect(current.frame.x).toBeCloseTo((current.clientWidth - current.frame.width) / 2, 0);
      expect(current.sidebar.x).toBeCloseTo(current.frame.x, 0);
      expect(current.sidebar.width).toBeCloseTo(frames[0].sidebar.width, 0);
    }
  });

  test('contributing offers a first task before setup and checks', async ({ page }) => {
    await page.goto('/contributing/');
    const lab = page.locator('.page-contributing');
    await expect(lab.getByRole('heading', { level: 1, name: 'Contributing' })).toBeVisible();
    await expect(lab.getByRole('heading', { level: 2 }).allTextContents()).resolves.toEqual([
      'Where to help',
      'Development setup',
      'Before a pull request',
      'For maintainers',
    ]);
    await expect(lab.locator('open-code-block')).toHaveCount(1);
    await expect(lab.getByRole('button', { name: 'Copy setup commands' })).toBeVisible();
    await expect(lab.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
    expect(await lab.locator('.checklist li').count()).toBeGreaterThan(0);
    expect(await lab.locator('.help-row').count()).toBe(3);
    await lab.getByRole('link', { name: 'Choose a first task' }).click();
    await expect(lab.getByRole('heading', { name: 'Where to help' })).toBeFocused();
    await expect(lab.locator('.help-row').first()).toContainText('Try the starter');
    await expect(
      lab.getByRole('link', { name: 'When to write an architecture decision record (ADR)' }),
    ).toHaveAttribute(
      'href',
      'https://github.com/open-element/openelement/blob/main/CONTRIBUTING.md#when-an-adr-is-required',
    );
    await expect(lab.getByRole('link', { name: 'Open Getting Started' })).toHaveAttribute(
      'href',
      '/guide/getting-started/',
    );
    await expect(
      lab.getByRole('link', { name: 'Read the repository release process' }),
    ).toHaveAttribute(
      'href',
      'https://github.com/open-element/openelement/blob/main/CONTRIBUTING.md#release-work',
    );
    await page.goto('/zh/contributing/');
    await expect(lab.getByRole('heading', { level: 1, name: '参与贡献' })).toBeVisible();
    await expect(lab.getByRole('button', { name: '复制配置命令' })).toBeVisible();
    await expect(lab.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
    await expect(lab.getByRole('link', { name: '打开快速开始' })).toHaveAttribute(
      'href',
      '/zh/guide/getting-started/',
    );
  });

  for (const copy of [
    {
      path: '/contributing/',
      label: 'Copy setup commands',
      denied: 'Select the commands below and copy them manually.',
      dismiss: 'Dismiss copy error',
      success: 'Setup commands copied to clipboard.',
    },
    {
      path: '/zh/contributing/',
      label: '复制配置命令',
      denied: '请选中下方命令，手动复制。',
      dismiss: '关闭复制错误提示',
      success: '配置命令已复制到剪贴板。',
    },
  ]) {
    test(`contributing setup recovers from blocked clipboard access on ${copy.path}`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: (commands: string) => {
              if (!document.documentElement.hasAttribute('data-copy-retry')) {
                return Promise.reject(
                  new DOMException('Blocked by the browser', 'NotAllowedError'),
                );
              }
              document.documentElement.dataset.copiedCommands = commands;
              return Promise.resolve();
            },
          },
        });
      });
      await page.goto(copy.path);
      const button = page.getByRole('button', { name: copy.label });
      const commands = page.locator('#contributing-setup-commands');
      const copyState = page.locator('open-copy-button.contributing-copy [role="status"]');
      await button.click();
      await expect(copyState).toContainText(copy.denied);
      const bounds = await commands.boundingBox();
      const recovery = await copyState.boundingBox();
      expect(recovery!.y).toBeLessThan(bounds!.y);
      await page.getByRole('button', { name: copy.dismiss }).click();
      await expect(button).toBeFocused();
      await page.evaluate(() => document.documentElement.setAttribute('data-copy-retry', ''));
      await button.click();
      await expect(copyState).toHaveText(copy.success);
      const visibleCommands = (await commands.textContent())?.trimEnd() ?? '';
      expect(visibleCommands).toContain('pnpm install --frozen-lockfile');
      await expect(page.locator('html')).toHaveAttribute('data-copied-commands', visibleCommands);
    });
  }

  test('former hero pages render content-first, without a mega hero', async ({ page }) => {
    // The editorial mega hero pushed all content below the fold; these pages
    // now lead with the compact reading-shell/article header (#1087 cleanup).
    for (const route of [
      '/reference/',
      '/roadmap/',
      '/architecture/',
      '/architecture/design-system/',
    ]) {
      await page.goto(route);
      await expect(page.locator('h1:visible')).toHaveCount(1);
    }
  });

  test('data-driven entry pages compose their body with shared section frames', async ({
    page,
  }) => {
    for (const route of ['/reference/', '/roadmap/']) {
      await page.goto(route);
      expect(await page.locator('open-section-frame').count()).toBeGreaterThan(0);
    }
  });

  test('compiled light section frames project named and default content in place', async ({
    page,
  }) => {
    await page.goto('/reference/');
    // The retired <reference-page> host became the page hook class
    // (page-reference) with the server function page migration (alpha15);
    // the frame locator is rooted at it so frames of other routes cannot match.
    const frames = page.locator('.page-reference open-section-frame[data-oe-light]');
    // Light DOM only: the page hook is a class on a light-div (no shadow root
    // to pierce), so every one of the page's frames is addressable.
    await expect(frames).toHaveCount(5);
    await expect(frames.first().locator('h2')).toContainText('Start with routes and components');
    // The second frame's body is the package registry; `.registry` went away
    // with the utility-first migration, and the generated rows now carry their
    // kind as data (the generated anchor id is not stable across packages).
    await expect(frames.nth(1).locator('[data-kind]').first()).toBeVisible();
  });

  test('reference renders the generated export and element reference with stable anchors (#1307)', async ({
    page,
  }) => {
    await page.goto('/reference/');
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
    await page.goto('/zh/reference/');
    await expect(page.locator('#ce-open-input')).toBeVisible();
    await expect(page.locator('[id^="api-"]').first()).toBeVisible();
  });

  test('reference export inventory stays navigable: grouped panes and working deep links', async ({
    page,
  }) => {
    await page.goto('/reference/');
    const metrics = await page.evaluate(() => ({
      docHeight: document.documentElement.scrollHeight,
      groups: document.querySelectorAll('.ref-group').length,
      rows: document.querySelectorAll('.ref-row').length,
      anchors: document.querySelectorAll('[id^="api-"]').length,
    }));
    // The previous single-page export wall measured ~491k px. Grouped panes
    // keep the generated inventory navigable; this guard stops a future change
    // from silently re-flattening it.
    expect(metrics.groups).toEqual(6);
    expect(metrics.rows).toBeGreaterThan(1000);
    // Rows keep their generated anchors; the extra one is the #api-reference
    // section id.
    expect(metrics.anchors).toEqual(metrics.rows + 1);
    expect(metrics.docHeight).toBeLessThan(30000);

    // A generated search anchor inside a scroll pane must still land: native
    // fragment navigation scrolls the pane, so no client JavaScript is needed.
    await page.goto('/reference/#api-element-root-Action');
    const deepLink = await page.evaluate(() => {
      const row = document.getElementById('api-element-root-Action');
      const pane = row?.closest('.ref-group-scroll');
      if (!row || !pane) return { found: false, paneScrollTop: 0, inView: false };
      const rowBox = row.getBoundingClientRect();
      const paneBox = pane.getBoundingClientRect();
      return {
        found: true,
        paneScrollTop: pane.scrollTop,
        inView: rowBox.top >= paneBox.top - 1 && rowBox.top <= paneBox.bottom,
      };
    });
    expect(deepLink.found).toBeTruthy();
    expect(deepLink.paneScrollTop).toBeGreaterThan(0);
    expect(deepLink.inView).toBeTruthy();
  });

  test('roadmap standards visual renders through the compiled light root', async ({ page }) => {
    await page.goto('/roadmap/');
    const visual = page.locator('open-standards-visual');
    await expect(visual).toHaveAttribute('data-oe-light', '');
    expect(await visual.locator(':scope > *').count()).toBeGreaterThan(0);
  });

  test('mobile rail is a native details drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/guide/getting-started/');
    const details = page.locator('open-page-rail details');
    await expect(details).toBeVisible();
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
  });

  test('deep fragments scroll inside DSD on click, direct load, and history', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/guide/getting-started/');
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
    await page.goto('/guide/core-concepts/');
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
    await page.goto('/guide/getting-started/');
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
    for (const route of ['/reference/', '/changelog/', '/contributing/', '/guide/configuration/']) {
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
