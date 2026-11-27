import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { installCommand } from '../app/data/_generated-install-command.ts';
import { MINIMUM_NODE_VERSION } from '../../packages/create/src/node-version.ts';

const locales = [
  {
    path: '/',
    heading: 'Build with the browser.',
    start: 'Start building',
    docs: 'Read the docs',
    hrefPrefix: '',
    count: 'Count:',
    countName: 'Increment count, currently 0',
    countNameNext: 'Increment count, currently 1',
    resetName: 'Reset',
    demoJump: 'Try the live counter',
    releaseNotes: 'release notes',
    copyName: 'Copy install command',
    sourceCopyName: 'Copy component source',
    menuName: 'Navigation',
    mobileNavName: 'Mobile navigation',
  },
  {
    path: '/zh/',
    heading: '用浏览器原生能力 构建应用。',
    start: '开始构建',
    docs: '阅读文档',
    hrefPrefix: '/zh',
    count: '计数：',
    countName: '增加计数，当前 0',
    countNameNext: '增加计数，当前 1',
    resetName: '重置',
    demoJump: '试用计数器',
    releaseNotes: '发布说明',
    copyName: '复制安装命令',
    sourceCopyName: '复制组件源码',
    menuName: '导航',
    mobileNavName: '移动端导航',
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
      const requirements = main.locator('#home-install-requirements');
      await expect(requirements).toContainText(
        `Node.js ${MINIMUM_NODE_VERSION.replace(/\.0$/, '')}+`,
      );
      await expect(requirements.getByRole('link')).toHaveAttribute(
        'href',
        `${locale.hrefPrefix}/guide/getting-started/`,
      );
      const source = await readFile(
        new URL('../app/islands/open-counter.tsx', import.meta.url),
        'utf8',
      );
      // The hero prints the marked component-body excerpt, not the whole
      // module: the island stays the one owner of the demo source.
      const sampleStart = source.indexOf('// #home-sample:start');
      const sampleEnd = source.indexOf('// #home-sample:end');
      const sample = source
        .slice(sampleStart + '// #home-sample:start'.length, sampleEnd)
        .trim()
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n');
      expect((await main.locator('pre').textContent())?.trimEnd()).toBe(sample);
      // Without JavaScript, the server-rendered readout replaces the counter
      // and has no tab stop.
      await expect(main.locator('open-counter')).toBeHidden();
      await expect(main.locator('.home-counter-static')).toBeVisible();
      await expect(main.locator('.home-counter-static')).toHaveText(`${locale.count} 0`);
      await expect(page.getByRole('button', { name: locale.countName })).toHaveCount(0);
      await expect(main.getByRole('link', { name: locale.demoJump })).toBeHidden();
      // The search trigger, both theme controls and the layer strip are
      // JS-only surfaces; the SSR markup stays but is hidden without the
      // pre-paint `data-js` marker.
      await expect(page.locator('open-search button[part="trigger"]')).toBeHidden();
      await expect(page.locator('.oe-theme-controls')).toBeHidden();
      await expect(main.locator('.home-layers')).toBeHidden();
      // The native disclosure is the no-JS menu: no JS-owned aria-expanded is
      // left claiming "collapsed" while <details open> reports the real state.
      const menu = page.locator('details.oe-site-menu');
      await expect(menu.locator('summary')).not.toHaveAttribute('aria-expanded');
      await expect(menu.locator('summary')).toHaveAccessibleName(locale.menuName);
      await menu.locator('summary').click();
      await expect(menu).toHaveAttribute('open', '');
      await expect(
        page.getByRole('navigation', { name: locale.mobileNavName }).getByRole('link').first(),
      ).toBeVisible();
      // Copy controls are island-owned: hidden (visibility:hidden) until the
      // island upgrades, so a no-JS reader never sees a dead button.
      await expect(main.locator('.home-copy')).toHaveCount(2);
      await expect(main.locator('.home-copy').first()).not.toBeVisible();
      await expect(main.locator('.home-copy').last()).not.toBeVisible();
      // The hydrated-on-view badge is painted by CSS only once the island
      // chunk registers the element, so a no-JS reader never sees it.
      await expect(main.locator('.home-demo-state')).toBeHidden();

      const docs = main.getByRole('link', { name: locale.docs, exact: true });
      await expect(docs).toHaveAttribute('href', `${locale.hrefPrefix}/docs/`);
      await expect(main.getByRole('link', { name: locale.releaseNotes })).toHaveAttribute(
        'href',
        'https://github.com/open-element/openelement/releases',
      );
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
    const button = counter.getByRole('button', { name: locale.countName });
    const reset = counter.getByRole('button', { name: locale.resetName });
    await expect(button).toBeVisible();
    await expect(reset).toBeDisabled();
    const original = await button.elementHandle();
    await button.scrollIntoViewIfNeeded();
    await expect.poll(() => counter.evaluate((host) => host.matches(':defined'))).toBe(true);
    await button.press('Space');
    const updated = counter.getByRole('button', { name: locale.countNameNext });
    await expect(updated).toBeVisible();
    expect(await updated.evaluate((button, original) => button === original, original)).toBe(true);
    await expect(reset).toBeEnabled();
    await reset.press('Space');
    await expect(button).toBeFocused();
    await expect(reset).toBeDisabled();
    await expect(counter.locator('[aria-live="polite"]')).toHaveText(`${locale.count} 0`);
  });

  test(`${locale.path} takes phone visitors from the hero to the live counter`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(locale.path);
    const jump = page.getByRole('link', { name: locale.demoJump });
    const demo = page.locator('#home-live-demo');
    const increment = demo.getByRole('button', { name: locale.countName });
    await expect(jump).toBeInViewport();
    await expect(increment).toBeInViewport({ ratio: 1 });
    await jump.press('Enter');
    await expect(page).toHaveURL(`${locale.path}#home-live-demo`);
    await expect(demo).toBeFocused();
    // macOS WebKit uses Option+Tab to include page controls in traversal.
    await page.keyboard.press(
      browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab',
    );
    await expect(increment).toBeFocused();
    await expect(increment).toBeInViewport({ ratio: 1 });
  });

  test(`${locale.path} passes WCAG A and AA in the dark theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(locale.path);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(
      page.locator('.home-editor').getByRole('button', { name: locale.sourceCopyName }),
    ).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(violations.map(({ id, nodes }) => [id, nodes.map(({ target }) => target)])).toEqual([]);
  });
}

test('the hero sample never wraps and scrolls instead of breaking the page', async ({ page }) => {
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const pre = page.locator('.page-home .home-source pre');
    await expect(pre).toBeVisible();
    await expect(pre).toHaveCSS('overflow-x', 'auto');
    await expect(pre).toHaveCSS('white-space', 'pre');
    const metrics = await pre.evaluate((pre) => ({
      pageWidth: document.documentElement.scrollWidth,
      codeWidth: pre.scrollWidth,
      codeClientWidth: pre.clientWidth,
      maxHeight: getComputedStyle(pre).maxHeight,
      padding: Number.parseFloat(getComputedStyle(pre).paddingTop),
    }));
    expect(metrics.pageWidth).toBe(width);
    expect(metrics.padding).toBeGreaterThan(0);
    if (width === 1440) {
      // Desktop has room for the ~72-column excerpt: no horizontal scroll.
      expect(metrics.codeWidth).toBe(metrics.codeClientWidth);
    } else if (width <= 390) {
      // Phone widths scroll the sample; the page itself must not widen.
      expect(metrics.codeWidth).toBeGreaterThan(metrics.codeClientWidth);
    }
    // The visible window is exactly 12 lines on desktop/tablet (12 x 18px
    // line box plus the 0.9rem top padding; no bottom padding, so line 13 is
    // not clipped through its glyphs) and eight lines on the phone tier.
    // WebKit serializes the computed rem cap with float noise
    // (230.39999px), so compare the numeric value rather than the string.
    if (width <= 640) {
      expect(Number.parseFloat(metrics.maxHeight)).toBeCloseTo(158.4, 2);
    } else {
      expect(Number.parseFloat(metrics.maxHeight)).toBeCloseTo(230.4, 2);
    }
  }
});

test('Copy source writes just the sample code', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText(value: string) {
          document.documentElement.dataset.copiedHomeSource = value;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto('/');
  const code = (await page.locator('.home-source pre code').textContent())!.trimEnd();
  await page.getByRole('button', { name: 'Copy component source' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-copied-home-source', code);
});

test('the sample expands without a height cap and reaches its closing lines', async ({ page }) => {
  for (const width of [1440, 900, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const source = page.locator('.home-source');
    const pre = source.locator('pre');
    // The disclosure is an island control available at every width: bring it
    // near the viewport so the visible-hydration strategy upgrades it (no-JS
    // keeps the pre scrollable).
    await pre.scrollIntoViewIfNeeded();
    const toggle = page.getByRole('button', { name: 'View source' });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(source).toHaveAttribute('data-source-expanded', 'true');
    const metrics = await pre.evaluate((el) => ({
      maxHeight: getComputedStyle(el).maxHeight,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      text: el.textContent ?? '',
    }));
    expect(metrics.maxHeight).toBe('none');
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    expect(metrics.text.trimEnd()).toMatch(/\);\s*\}$/);
  }
});

test('a horizontally overflowing sample shows the fade and scroll cue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const source = page.locator('.home-source');
  await source.scrollIntoViewIfNeeded();
  await expect(source).toHaveAttribute('data-source-overflow', '');
  await expect(source).not.toHaveAttribute('data-source-end', '');
  await expect
    .poll(() => source.locator('.home-source-cue').evaluate((el) => getComputedStyle(el).opacity))
    .toBe('1');
  await source.locator('pre').evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(source).toHaveAttribute('data-source-end', '');
  await expect
    .poll(() => source.locator('.home-source-fade').evaluate((el) => getComputedStyle(el).opacity))
    .toBe('0');
});

test('the layer group is one tab stop, single-select and re-pressable', async ({ page }) => {
  await page.goto('/');
  const strip = page.locator('.home-layers');
  await expect(strip).toHaveAttribute('role', 'group');
  // Desktop readers see the fine-pointer instructions above the rows.
  await expect(strip.locator('.home-layer-hint-fine')).toHaveText(
    'Select a layer to highlight it.',
  );
  const all = strip.locator('.home-layer-all');
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(strip.locator('.home-layer[tabindex="0"]')).toHaveCount(1);

  const hydrate = strip.getByRole('button', { name: /island JavaScript/ });
  await hydrate.focus();
  await expect(hydrate).toHaveAttribute('aria-pressed', 'false');
  await hydrate.press('Enter');
  await expect(hydrate).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.home-region-hydrate')).toHaveCSS('outline-color', /rgb/);
  await expect(strip.locator('.home-layer[tabindex="0"]')).toHaveCount(1);

  // Pressing the active row again clears the selection.
  await hydrate.press('Enter');
  await expect(hydrate).toHaveAttribute('aria-pressed', 'false');
  await expect(all).toHaveAttribute('aria-pressed', 'true');
});

test('arrow keys rove the layer group and the hash is a shareable deep link', async ({ page }) => {
  await page.goto('/#layer=dsd');
  const strip = page.locator('.home-layers');
  const dsd = strip.getByRole('button', { name: /Declarative Shadow DOM/ });
  await expect(dsd).toHaveAttribute('aria-pressed', 'true');
  await expect(strip.locator('.home-layer-all')).toHaveAttribute('aria-pressed', 'false');

  await dsd.focus();
  await dsd.press('ArrowDown');
  await expect(strip.getByRole('button', { name: /island JavaScript/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page).toHaveURL(/#layer=hydrate$/);

  // Re-pressing the active probe clears the selection and drops the layer hash.
  await strip.getByRole('button', { name: /island JavaScript/ }).press('Enter');
  await expect(strip.locator('.home-layer-all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).not.toHaveURL(/#layer=/);
});

test('the demo head reports the island as hydrated once it wakes', async ({ page }) => {
  await page.goto('/');
  const counter = page.locator('open-counter');
  const state = page.locator('.home-demo-state');
  // No-JS coverage (the block above) pins the other half: without the chunk
  // the badge stays hidden. Here the island is in the hero, so hydrating on
  // view happens immediately in a JS-enabled browser.
  await expect.poll(() => counter.evaluate((host) => host.matches(':defined'))).toBe(true);
  await expect(state).toBeVisible();
  await expect(state).toContainText('Use + to count');
});

test('the hero makes one version claim and the theme control is live on home', async ({ page }) => {
  await page.goto('/');
  const version = await page.locator('.home-release-version').textContent();
  expect(version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
  await expect(page.locator('.home-window-stamp')).not.toContainText('alpha.');
  await expect(page.locator('open-theme-toggle')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible();

  await page.goto('/guide/getting-started/');
  await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
});
