import { expect, test } from '@playwright/test';
import { errorCodes } from '../app/data/_generated-error-codes.ts';

for (const { prefix, next, expected, evidence } of [
  {
    prefix: '',
    next: 'What to check',
    expected: 'The failure did not supply a more specific framework code.',
    evidence: 'Build diagnostic envelope',
  },
  {
    prefix: '/zh',
    next: '检查步骤',
    expected: '这次失败没有提供更具体的框架错误码。',
    evidence: '构建诊断信封',
  },
]) {
  test(`diagnostic recovery and its guide work on ${prefix}/errors/`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${prefix}/errors/#UNKNOWN`);

    const compiler = page.locator('#error-codes article');
    const runtime = page.locator('#runtime-codes article');
    await expect(compiler).toHaveCount(errorCodes.diagnostics.length);
    await expect(runtime).toHaveCount(errorCodes.runtime.length);
    await expect(compiler.locator('dt').filter({ hasText: next })).toHaveCount(
      errorCodes.diagnostics.length,
    );
    await expect(runtime.locator('dt')).toHaveText(errorCodes.runtime.map(() => next));
    await expect(page.locator('#OEC9042 dd').first()).toContainText(
      prefix ? '不受支持' : 'unsupported',
    );
    await expect(page.locator('#OE_WORKSPACE_ANCHOR_LOOKUP_FAILED > p[lang="en"]')).toBeAttached();
    const source = page.locator('#OE_CLAIM_DYNAMIC_NODE_IN_STATIC_REGION > p[lang="en"]');
    await expect(source).toContainText(
      'Bounded recovery met a dynamic node inside a static Block.',
    );
    const provenance = source.locator('[data-source-summary-label]');
    if (prefix) {
      await expect(provenance).toHaveText('英文源码摘要');
      await expect(provenance).toBeVisible();
      await expect(provenance).toHaveAttribute('lang', 'zh');
    } else {
      await expect(provenance).toBeHidden();
    }

    const unknown = page.locator('#UNKNOWN');
    await expect(unknown.locator('[data-source-summary-label]')).toBeHidden();
    await expect(unknown.getByText(expected, { exact: true })).toBeVisible();
    await unknown.getByRole('link', { name: evidence }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`${prefix}/guide/error-handling/`);
    await expect(
      page.locator(prefix ? '#机器可读的诊断信封' : '#the-machine-readable-envelope'),
    ).toBeVisible();
  });
}
