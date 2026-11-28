import { expect, test } from '@playwright/test';
import { apiReference } from '../app/data/_generated-api-reference.ts';

const protocolExportCount = apiReference.packages
  .find(({ name }) => name === '@openelement/protocol')!
  .subpaths.reduce((sum, subpath) => sum + subpath.exports.length, 0);

test('reference lookup lands on a readable export and makes its long signature keyboard scrollable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/reference/');
  const lookup = page.getByRole('searchbox', { name: 'Find an exported symbol' });
  await expect(lookup).toBeVisible();
  await expect(page.locator('.ref-sig[tabindex="0"]')).toHaveCount(0);
  await lookup.fill('ActionResult');
  await page.getByRole('link', { name: 'ActionResult · @openelement/protocol · root' }).click();
  const result = page.locator('#api-protocol-root-ActionResult');
  await expect(result).toBeFocused();
  await expect(page).toHaveURL(/#api-protocol-root-ActionResult$/);
  const preview = result.locator(':scope > .ref-summary');
  await expect(preview).toHaveText('Wire shape returned to the JavaScript form-enhancement path.');
  const notes = result.locator('.ref-detail');
  await expect(notes).not.toHaveAttribute('open');
  const summary = notes.locator('.ref-summary');
  await expect(summary).toContainText('CSRF 403');
  expect(
    await summary.evaluate((node) => node.scrollHeight - node.clientHeight),
  ).toBeLessThanOrEqual(1);
  const pane = result.locator('xpath=ancestor::div[contains(@class, "ref-group-scroll")]');
  expect(await pane.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await expect(pane).toHaveAccessibleDescription(/Page Up or Page Down/);
  const continuation = page
    .locator('.ref-group')
    .filter({ has: page.locator('#ref-protocol-exports') })
    .getByRole('button', { name: 'Continue reading' });
  await expect(continuation).toBeInViewport();
  await expect(
    pane.locator('..').getByText('↑ ↓ Select · Tab inspect · Esc return'),
  ).toBeInViewport();
  const initialScroll = await pane.evaluate((node) => node.scrollTop);
  await continuation.click();
  await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBeGreaterThan(initialScroll);
  const noteToggle = notes.getByText('Source notes', { exact: true });
  await noteToggle.press('Enter');
  await expect(summary).toBeVisible();
  await expect(noteToggle).toBeFocused();
  await expect(result.getByRole('link', { name: '"Form actions" section' })).toHaveAttribute(
    'href',
    '/guide/routing-and-data/#form-actions',
  );
  const problemDetails = result.getByRole('link', { name: 'ProblemDetails', exact: true });
  await expect(problemDetails).toHaveAttribute('href', '#api-protocol-root-ProblemDetails');
  await problemDetails.click();
  await expect(page).toHaveURL(/#api-protocol-root-ProblemDetails$/);

  await lookup.fill('AuthoringErrorCode');
  await page
    .getByRole('link', { name: 'AuthoringErrorCode · @openelement/protocol · root' })
    .click();
  const longResult = page.locator('#api-protocol-root-AuthoringErrorCode');
  const signature = longResult.locator('.ref-sig');
  await expect(longResult).toBeFocused();
  await expect(signature).toHaveAttribute('tabindex', '0');
  await expect(page.locator('.ref-sig[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(signature).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => signature.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => signature.evaluate((node) => node.scrollLeft)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(pane).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(longResult).toBeFocused();

  await page.keyboard.press('Escape');
  const beforePaging = await pane.evaluate((node) => node.scrollTop);
  let previous = beforePaging;
  await page.keyboard.press('PageDown');
  await expect
    .poll(async () => {
      const current = await pane.evaluate((node) => node.scrollTop);
      const settled = current > beforePaging && current === previous;
      previous = current;
      return settled;
    })
    .toBeTruthy();
  const afterPaging = await pane.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const header = document.querySelector('.oe-site-header')!.getBoundingClientRect();
    const top = Math.max(box.top, header.bottom);
    const bottom = Math.min(box.bottom, window.innerHeight);
    const title = Array.from(node.querySelectorAll('.ref-name')).find((name) => {
      const rect = name.getBoundingClientRect();
      return rect.top >= top && rect.bottom <= bottom;
    });
    return {
      rowId: title?.closest('.ref-row')?.id,
      paneScroll: node.scrollTop,
      pageScroll: window.scrollY,
    };
  });
  expect(afterPaging.rowId, 'a full export title is visible after paging').toBeTruthy();
  await page.keyboard.press('ArrowDown');
  const focusedRow = pane.locator('.ref-row:focus');
  await expect(focusedRow).toHaveAttribute('id', afterPaging.rowId!);
  await expect
    .poll(() =>
      focusedRow.locator('.ref-name').evaluate((node) => {
        const list = node.closest('.ref-group-scroll')!.getBoundingClientRect();
        const header = document.querySelector('.oe-site-header')!.getBoundingClientRect();
        const title = node.getBoundingClientRect();
        return Math.min(
          title.top - Math.max(list.top, header.bottom),
          Math.min(list.bottom, window.innerHeight) - title.bottom,
        );
      }),
    )
    .toBeGreaterThanOrEqual(0);
  expect(await pane.evaluate((node) => node.scrollTop)).toBe(afterPaging.paneScroll);
  expect(await page.evaluate(() => window.scrollY)).toBe(afterPaging.pageScroll);
});

test('a fresh export fragment makes the focused long signature a keyboard stop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/reference/?direct=1#api-protocol-root-AuthoringErrorCode');
  const row = page.locator('#api-protocol-root-AuthoringErrorCode');
  const signature = row.locator('.ref-sig');
  await expect(row).toBeFocused();
  await expect(signature).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('Tab');
  await expect(signature).toBeFocused();
});

test('compact pane paging settles before the next ArrowDown', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const prefix of ['', '/zh']) {
    await page.goto(`${prefix}/reference/#api-protocol-root-AuthoringErrorCode`);
    const pane = page.locator('#ref-protocol-exports');
    const signature = pane.locator('#api-protocol-root-AuthoringErrorCode .ref-sig');
    await expect(signature).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Tab');
    await expect(signature).toBeFocused();
    await page.keyboard.press('Escape');
    const start = await pane.evaluate((list) => list.scrollTop);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('ArrowDown');
    const result = await pane.evaluate((list) => {
      const focused = document.activeElement!.querySelector('.ref-name')!;
      const header = document.querySelector('.oe-site-header')!.getBoundingClientRect().bottom;
      const view = list.getBoundingClientRect();
      const name = focused.getBoundingClientRect();
      return {
        scroll: list.scrollTop,
        title: focused.textContent,
        clearance: Math.min(
          name.top - Math.max(header, view.top),
          Math.min(innerHeight, view.bottom) - name.bottom,
        ),
      };
    });
    expect(result.title).not.toBe('AuthoringErrorCode');
    expect(result.scroll - start).toBeGreaterThan(250);
    expect(result.clearance).toBeGreaterThanOrEqual(-1);
  }
});

test('repeated ArrowDown keeps focused export names in view at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const prefix of ['', '/zh']) {
    await page.goto(`${prefix}/reference/`);
    await expect(page.locator('open-registry-lookup form')).toBeVisible();
    const pane = page.locator('#ref-protocol-exports');
    for (const scrollTop of [1746, 2200]) {
      await pane.focus();
      await pane.evaluate((node, offset) => {
        node.scrollTop = offset;
      }, scrollTop);
      const focused = pane.locator('.ref-row:focus');
      await page.keyboard.press('ArrowDown');
      const entered = await focused.getAttribute('id');
      await page.keyboard.press('ArrowDown');
      await expect(focused).not.toHaveAttribute('id', entered!);
      const clearance = await focused.locator('.ref-name').evaluate((name) => {
        const title = name.getBoundingClientRect();
        const pane = name.closest('.ref-group-scroll')!.getBoundingClientRect();
        const header = document.querySelector('.oe-site-header')!.getBoundingClientRect();
        return Math.min(
          title.top - Math.max(header.bottom, pane.top),
          Math.min(pane.bottom, innerHeight) - title.bottom,
        );
      });
      expect(clearance).toBeGreaterThanOrEqual(-1);
    }
  }
});

test('reference lookup pages through package matches and finds exports in a scrolled pane', async ({
  page,
}) => {
  await page.goto('/reference/');
  const lookup = page.getByRole('searchbox', { name: 'Find an exported symbol' });
  const search = page.getByRole('search', { name: 'Find an exported symbol' });
  await lookup.fill('@openelement/protocol');
  const firstLink = search.getByRole('link').first();
  await expect(search.getByRole('status')).toHaveText(/Showing 1–8 of \d+ matches/);
  await expect(search.getByRole('link')).toHaveCount(8);
  const firstHref = await firstLink.getAttribute('href');
  await search.getByRole('button', { name: 'Next results' }).click();
  await expect(search.getByRole('status')).toHaveText(/Showing 9–16 of \d+ matches/);
  await expect(firstLink).toBeFocused();
  await expect(firstLink).not.toHaveAttribute('href', firstHref!);
  await search.getByRole('button', { name: 'Previous results' }).click();
  await expect(firstLink).toHaveAttribute('href', firstHref!);
  await lookup.fill('definePage @openelement/router');
  await expect(firstLink).toHaveText(/definePage · @openelement\/router/);
  await expect(search.getByRole('button', { name: 'Next results' })).toBeHidden();

  const pane = page.getByRole('region', { name: '@openelement/protocol — export list' });
  await pane.focus();
  await pane.evaluate((node) => {
    node.scrollTop = 1746;
  });
  const visibleId = await pane.evaluate((node) => {
    const top = node.getBoundingClientRect().top;
    return [...node.querySelectorAll('.ref-row')].find(
      (row) => row.querySelector('.ref-name')!.getBoundingClientRect().top >= top,
    )?.id;
  });
  expect(visibleId).toBeTruthy();
  expect(visibleId).not.toEqual('api-protocol-root-Action');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(`#${visibleId}`)).toBeFocused();
  expect(await pane.evaluate((node) => node.scrollTop)).toBe(1746);
});

test('the package scope narrows aliases and can browse or clear a package', async ({ page }) => {
  await page.goto('/reference/');
  const search = page.getByRole('search', { name: 'Find an exported symbol' });
  const lookup = search.getByRole('searchbox');
  const scope = search.getByRole('combobox', { name: 'Package' });
  await lookup.fill('signal');
  const broadCount = await search.getByRole('status').textContent();
  await scope.selectOption('@openelement/element');
  const matches = await search.getByRole('link').allTextContents();
  expect(matches.length).toBeGreaterThan(0);
  expect(matches.every((match) => match.includes('@openelement/element ·'))).toBe(true);
  await scope.selectOption('@openelement/ui');
  await expect(search.getByRole('status')).toHaveText(/choose All packages/);
  await scope.selectOption({ label: 'All packages' });
  await expect(search.getByRole('status')).toHaveText(broadCount!);

  await lookup.clear();
  expect(protocolExportCount, 'Package browse must exercise multiple full pages').toBeGreaterThan(
    16,
  );
  await scope.selectOption('@openelement/protocol');
  await expect(search.getByRole('status')).toHaveText(
    `Showing 1–8 of ${protocolExportCount} matches.`,
  );
  await search.getByRole('button', { name: 'Next results' }).press('Enter');
  await expect(search.getByRole('status')).toHaveText(
    `Showing 9–16 of ${protocolExportCount} matches.`,
  );
});

test('the package scope is removed on disconnect and recreated once on reconnect', async ({
  page,
}) => {
  await page.goto('/reference/');
  const registry = page.locator('open-registry-lookup');
  const scope = registry.getByRole('combobox', { name: 'Package' });
  await scope.selectOption('@openelement/protocol');
  await expect(registry.getByRole('status')).toHaveText(
    `Showing 1–8 of ${protocolExportCount} matches.`,
  );
  const detached = await registry.evaluate((host) => {
    const parent = host.parentNode!;
    const next = host.nextSibling;
    host.remove();
    const removed = !host.querySelector('#registry-package');
    parent.insertBefore(host, next);
    return removed;
  });
  expect(detached).toBe(true);
  await expect(scope).toHaveCount(1);
  await expect(scope).toHaveValue('');
  await expect(registry.getByRole('searchbox')).toHaveAttribute('required', '');
  await scope.selectOption('@openelement/protocol');
  await expect(registry.getByRole('status')).toHaveText(
    `Showing 1–8 of ${protocolExportCount} matches.`,
  );
});

test('each export list can scroll with the document and return to the same compact position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh/reference/');
  const group = page.locator('[data-ref-package="@openelement/protocol"]');
  const pane = group.locator('.ref-group-scroll');
  const browse = group.getByRole('button', { name: '随页面滚动此列表' });
  await expect(browse).toHaveAttribute('aria-pressed', 'false');
  const original = await pane.evaluate((list) => {
    list.scrollTop = 1746;
    return list.scrollTop;
  });
  await browse.press('Enter');
  await expect(browse).toBeFocused();
  await expect(browse).toHaveAttribute('aria-pressed', 'true');
  await expect(pane).toHaveCSS('overflow-y', 'visible');
  await page.keyboard.press('Tab');
  await expect(pane).toBeFocused();
  const documentScroll = await page.evaluate(() => scrollY);
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(documentScroll);
  await expect(browse).toBeInViewport();
  await browse.click();
  await expect(browse).toHaveAttribute('aria-pressed', 'false');
  await expect(pane).toHaveCSS('overflow-y', 'auto');
  expect(await pane.evaluate((list) => list.scrollTop)).toBe(original);

  const localized = page.locator('#api-router-root-definePage > .ref-summary');
  await expect(localized).toContainText('服务端页面函数');
  await expect(localized.getByRole('link', { name: '查看函数重载' })).toHaveAttribute(
    'href',
    /packages\/router\/src\/authoring\.ts#L505-L511$/,
  );
  const action = page.locator('#api-protocol-root-ActionResult');
  await expect(action.locator(':scope > .ref-summary')).toContainText(
    '协议错误使用 ProblemDetails',
  );
  await expect(action.locator('.ref-detail .ref-summary')).toHaveAttribute('lang', 'en');
});

test('narrow reference rows let a keyboard reader open precisely the selected source notes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/zh/reference/#api-protocol-root-AuthoringErrorCode');
  const row = page.locator('#api-protocol-root-AuthoringErrorCode');
  const notes = row.locator('.ref-detail');
  const sourceSummary = notes.locator('p[lang="en"]');
  await expect(row).toBeFocused();
  await expect(notes).not.toHaveAttribute('open');
  await expect(row.locator(':scope > .ref-summary')).toContainText('校验错误码');
  await expect(page.locator('.ref-detail-toggle:not([tabindex="-1"])')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(row.locator('.ref-sig')).toBeFocused();
  await page.keyboard.press('Tab');
  const toggle = notes.getByText('英文源码说明', { exact: true });
  await expect(toggle).toBeFocused();
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Enter');
  await expect(sourceSummary).toHaveText(
    'Attribute/authoring-surface failures (phase `validation`).',
  );
  await expect(sourceSummary).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ref-protocol-exports')).toBeFocused();
  await expect(page.locator('.ref-detail-toggle:not([tabindex="-1"])')).toHaveCount(0);
});

test('rendered export previews cover identical fragments in both languages', async ({ page }) => {
  const previews = async (url: string) => {
    await page.goto(url);
    return page
      .locator('.ref-row')
      .evaluateAll((rows) =>
        rows.filter((row) => row.querySelector(':scope > .ref-summary')).map((row) => row.id),
      );
  };
  const english = await previews('/reference/');
  expect(english).toContain('api-element-root-onConnect');
  expect(english).toContain('api-ui-open-dialog-default');
  expect(english).toContain('api-ui-open-input-default');
  await expect(page.locator('#api-element-root-onConnect .ref-detail p[lang="en"]')).toContainText(
    'runs the callback on every connection of the generated element',
  );

  const chinese = await previews('/zh/reference/');
  expect(chinese).toEqual(english);
  await expect(page.locator('#api-ui-open-dialog-default > .ref-summary')).toContainText('对话框');
  await expect(page.locator('#api-ui-open-input-default > .ref-summary')).toContainText('文本输入');
});

test('reference exposes original source disclosure from a fragment without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 320, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto('/zh/reference/#api-protocol-root-ActionResult');
    const row = page.locator('#api-protocol-root-ActionResult');
    await expect(row.locator('.ref-name')).toBeInViewport();
    await expect(row.locator('.ref-sig')).toBeVisible();
    const notes = row.locator('.ref-detail');
    const source = notes.locator('p[lang="en"]');
    const disclosure = notes.getByText('英文源码说明', { exact: true });
    await expect(disclosure).not.toHaveAttribute('tabindex');
    await expect(source).toBeHidden();
    await disclosure.press('Enter');
    await expect(source).toBeVisible();
    await expect(source.getByRole('link', { name: '"Form actions" section' })).toHaveAttribute(
      'href',
      '/zh/guide/routing-and-data/#表单-action',
    );
    await expect(source).toContainText('CSRF 403');
  } finally {
    await context.close();
  }
});

test('error lookup finds known codes inside logs and lets readers choose among multiple codes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh/errors/');
  const lookup = page.getByRole('searchbox', { name: '查找错误码' });
  await lookup.fill('OEC90000 NOT_OEC9000 OEC9999');
  await expect(page.getByRole('search', { name: '查找错误码' }).getByRole('status')).toContainText(
    '未找到该错误码',
  );
  await lookup.fill('src/example.ts:2:8: [oec9000] Unexpected token');
  await lookup.press('Enter');
  await expect(page).toHaveURL(/#OEC9000$/);
  const diagnostic = page.locator('#OEC9000');
  await expect(diagnostic).toBeFocused();
  await expect(diagnostic.getByRole('heading', { name: 'OEC9000' })).toBeVisible();
  await expect(diagnostic.getByRole('link', { name: 'OEC9000' })).toHaveAttribute(
    'href',
    '#OEC9000',
  );
  await expect(diagnostic.getByText('TypeScript 无法解析此源文件。')).toBeVisible();
  await expect(diagnostic.getByText('检查步骤', { exact: true })).toBeVisible();
  await diagnostic.getByText('编译器源码位置', { exact: true }).click();
  await expect(diagnostic.getByText('源码检出中的位置', { exact: true })).toBeVisible();

  await lookup.fill('[OE_COMPILER_INVALID_SOURCE]');
  await lookup.press('Enter');
  await expect(
    page.locator('#runtime-codes').getByRole('heading', { name: '运行时和框架错误码' }),
  ).toBeVisible();
  const runtimeError = page.locator('#OE_COMPILER_INVALID_SOURCE');
  await expect(runtimeError).toBeFocused();
  await expect(
    runtimeError.getByText('编译器无法分析源文件，或生成的元素描述符未通过校验。'),
  ).toBeVisible();
  await expect(runtimeError.getByText('检查步骤', { exact: true })).toBeVisible();
  await expect(runtimeError.getByRole('link', { name: '在 GitHub 查看源码声明' })).toHaveAttribute(
    'href',
    /\/packages\/protocol\/src\/errors\.ts#L\d+$/,
  );
  await runtimeError.getByRole('link', { name: '返回错误码查找' }).click();
  await expect(page.locator('#error-lookup')).toBeFocused();

  const form = page.getByRole('search', { name: '查找错误码' });
  await lookup.fill('UNKNOWN');
  await expect(form.getByRole('link', { name: 'UNKNOWN' })).toBeVisible();
  await lookup.fill('Runtime error [UNKNOWN]');
  await expect(form.getByRole('link', { name: 'UNKNOWN' })).toBeVisible();
  await lookup.fill(
    'Error: SSR_RENDER_ERROR: render failed, BOUNDARY_CAUGHT. unknown UNKNOWN_SUFFIX X_SSR_RENDER_ERROR BOUNDARY_CAUGHT_2',
  );
  await expect(form.getByRole('link')).toHaveText(['SSR_RENDER_ERROR', 'BOUNDARY_CAUGHT']);
  await lookup.fill('Error: ssr_render_error: unknown');
  await expect(form.getByRole('link')).toHaveCount(0);

  await lookup.fill('');
  const handledPaste = await lookup.evaluate((input) => {
    const plainText =
      'src/sample.ts:7 [oec9000] unexpected token\n[OEC9999] unknown\nOE_COMPILER_INVALID_SOURCE\nOEC90000 OEC9000';
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', plainText);
    const paste = new ClipboardEvent('paste', { clipboardData, cancelable: true });
    // Firefox's synthetic ClipboardEvent does not retain the supplied data.
    if (paste.clipboardData?.getData('text/plain') !== plainText) {
      Object.defineProperty(paste, 'clipboardData', { value: clipboardData });
    }
    input.dispatchEvent(paste);
    return paste.defaultPrevented;
  });
  expect(handledPaste).toBe(true);
  await expect(form.getByRole('link')).toHaveCount(2);
  await expect(form.getByRole('status')).toContainText('找到 2 个错误码');
  await lookup.press('Enter');
  await expect(form.getByRole('link', { name: 'OEC9000' })).toBeFocused();
  const statusBounds = await form.getByRole('status').boundingBox();
  const headerBounds = await page.getByRole('banner').boundingBox();
  expect(statusBounds!.y).toBeGreaterThan(headerBounds!.y + headerBounds!.height);
  await expect(page).toHaveURL(/#error-lookup$/);
  await page.keyboard.press('Enter');
  await expect(diagnostic).toBeFocused();
});
