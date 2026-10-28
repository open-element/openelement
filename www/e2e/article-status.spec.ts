/**
 * E2E: article page status + the retired hidden fallback / freshness markup
 * (WEB-002, WEB-003 F3).
 *
 * BUG (WEB-002): `open-article-view` rendered BOTH page states on every guide
 * and architecture page. The SSR projection keeps one state visible via the
 * `hidden` attribute, but both branches were serialized into every built
 * article page, so the document carried a dead `404` text node plus the
 * fallback's `: <slug>` line inside a hidden `data-pagefind-ignore` block.
 * `innerText` never saw it (the block is `display: none`), yet `textContent`
 * — the channel raw-text extraction, reader modes and pagefind-ignore
 * notwithstanding index builders read — shipped "404: getting-started" on
 * all 54 locale-paired article pages. The fix renders the fallback only in
 * the not-found state; a valid article document must carry no such text.
 *
 * BUG (WEB-003 F3, same defect class): `open-reading-shell` rendered the
 * source-freshness meta row on every page and only toggled `hidden`, so
 * non-article routes (/reference, /roadmap, /errors) shipped a hidden row
 * with dangling "Applies to  · Updated " text and `<time datetime="">`.
 * The row must not exist when there is no version/date, while article pages
 * keep the real, visible version+date row.
 *
 * The missing-path half pins the real 404 contract, in two parts: the shared
 * e2e static server answers unknown paths with HTTP 404 and its own plain
 * body (it does not map `404.html`; production hosts serve the built
 * `dist/404.html` for missing paths with the same status), so the custom
 * error document is asserted at its real route (/404) and as a built
 * artifact. All assertions are engine-neutral — no CDP.
 */

import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The article surfaces that share the reading shell, in both locales.
 * `/errors` is a server-authored reference page, not an article projection: it
 * never rendered the fallback, so it only guards the "no 404 text on a valid
 * page" half while the guide/architecture routes pin the removed markup.
 */
const VALID_ROUTES = [
  '/guide/getting-started/',
  '/architecture/',
  '/errors/',
  '/zh/guide/getting-started/',
  '/zh/architecture/',
  '/zh/errors/',
] as const;

/** A path that must never resolve to an article or a success status. */
const MISSING_ARTICLE_ROUTE = '/guide/definitely-missing-page';

/**
 * Reading-shell pages that are NOT content articles: their metadata carries no
 * version/date, so the freshness row has nothing to show and must not exist.
 */
const NON_ARTICLE_ROUTES = [
  '/reference/',
  '/roadmap/',
  '/errors/',
  '/zh/reference/',
  '/zh/roadmap/',
  '/zh/errors/',
] as const;

/** Article pages that must keep the visible "Applies to <version> · Updated" row. */
const FRESHNESS_ARTICLE_ROUTES = [
  '/guide/getting-started/',
  '/architecture/',
  '/zh/guide/getting-started/',
  '/zh/architecture/',
] as const;

/** The locale's freshness label, authored in www/app/site-ui/chrome-strings.ts. */
const FRESHNESS_LABEL: Record<'en' | 'zh', string> = { en: 'Applies to', zh: '适用于' };

function localeOf(route: string): 'en' | 'zh' {
  return route.startsWith('/zh/') ? 'zh' : 'en';
}

/**
 * Every hidden element whose text mentions the freshness label. The retired
 * row was rendered on every page and only toggled `hidden`, so `textContent`
 * (raw text extraction / reader modes) still saw the dangling
 * "Applies to  · Updated " line on pages with no version/date to show.
 */
function hiddenFreshnessTexts(page: Page, label: string): Promise<string[]> {
  return page.evaluate((needle: string) => {
    const leaks: string[] = [];
    for (const element of document.body.querySelectorAll('[hidden]')) {
      const text = (element.textContent ?? '').trim();
      if (text.includes(needle)) {
        leaks.push(`${element.tagName.toLowerCase()}: ${text.slice(0, 100)}`);
      }
    }
    return leaks;
  }, label);
}

function trailingSlug(route: string): string {
  const segments = route.split('/').filter(Boolean);
  return segments.at(-1) ?? '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every rendered element whose trimmed text is exactly `404` or carries the
 * dead fallback line `404: <slug>`. Scanned by `textContent` on purpose: the
 * retired block was hidden with the `hidden` attribute, so `innerText` could
 * not see it — raw-text extraction (the audit's channel) reads `textContent`.
 */
function leakedFallbackTexts(page: Page, slug: string): Promise<string[]> {
  return page.evaluate(
    (patternSource: string) => {
      const fallbackLine = new RegExp(patternSource);
      const leaks: string[] = [];
      const elements: Element[] = [document.body, ...document.body.querySelectorAll('*')];
      for (const element of elements) {
        const text = (element.textContent ?? '').trim();
        if (text === '404' || fallbackLine.test(text)) {
          const snippet = text.length > 80 ? `${text.slice(0, 77)}...` : text;
          leaks.push(`${element.tagName.toLowerCase()}: ${snippet}`);
        }
      }
      return leaks;
    },
    `404\\s*:\\s*${escapeRegExp(slug)}`,
  );
}

test.describe('valid article pages carry no not-found fallback text', () => {
  for (const route of VALID_ROUTES) {
    test(`${route} answers 200 without the dead 404 fallback`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response, `no response for ${route}`).not.toBeNull();
      expect(response!.status()).toBe(200);

      // The retired block was the article shell's only hidden
      // data-pagefind-ignore node; no valid page may keep one.
      await expect(page.locator('open-article-view [data-pagefind-ignore][hidden]')).toHaveCount(0);

      expect(await leakedFallbackTexts(page, trailingSlug(route))).toEqual([]);

      const leadingText = await page.evaluate(() =>
        (document.body.innerText ?? '').trimStart().slice(0, 40),
      );
      expect(leadingText.startsWith('404')).toBe(false);
    });
  }
});

test.describe('missing routes keep the real 404 contract', () => {
  test('an unknown article path answers HTTP 404', async ({ page }) => {
    const response = await page.goto(MISSING_ARTICLE_ROUTE);
    expect(response, `no response for ${MISSING_ARTICLE_ROUTE}`).not.toBeNull();
    expect(response!.status()).toBe(404);

    // Actual shared-server behaviour, encoded rather than assumed: the e2e
    // static server (tools/lib/static-server.ts) answers a miss with its own
    // plain 404 body. Production hosts serve the built dist/404.html for the
    // same path — that document is pinned at /404 and as an artifact below.
    const body = await page.evaluate(() => (document.body.innerText ?? '').trim());
    expect(body).toBe('Not found');
    await expect(page.locator('.page-404')).toHaveCount(0);
  });

  test('the custom 404 page is served at /404 with its recovery marker', async ({ page }) => {
    const response = await page.goto('/404');
    expect(response, 'no response for /404').not.toBeNull();
    expect(response!.status()).toBe(200);

    const scene = page.locator('.page-404');
    await expect(scene).toBeVisible();
    await expect(scene.locator('h1')).toHaveAttribute('aria-label', '404');
    await expect(scene).toContainText('Lost in the shadow DOM.');
    // The error document stays out of the index.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);
  });

  test('dist/404.html is the error document hosts serve for missing paths', () => {
    const html = readFileSync(join(SITE_ROOT, 'dist', '404.html'), 'utf-8');
    expect(html).toContain('class="page-404');
    expect(html).toMatch(/<meta name="robots" content="noindex/);
    // The error surface is not an article page: no article body may leak in.
    expect(html).not.toContain('data-pagefind-body');
  });
});

test.describe('non-article pages ship no empty freshness row (WEB-003 F3)', () => {
  for (const route of NON_ARTICLE_ROUTES) {
    test(`${route} answers 200 with no freshness row at all`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response, `no response for ${route}`).not.toBeNull();
      expect(response!.status()).toBe(200);

      const label = FRESHNESS_LABEL[localeOf(route)];
      // No hidden element may carry the freshness copy — not even an empty one.
      expect(await hiddenFreshnessTexts(page, label)).toEqual([]);
      // Nothing to date on these pages: the row must not exist, visible or not.
      await expect(
        page.locator('open-reading-shell .meta p').filter({ hasText: label }),
      ).toHaveCount(0);
    });
  }
});

test.describe('article pages keep a visible freshness row', () => {
  for (const route of FRESHNESS_ARTICLE_ROUTES) {
    test(`${route} shows the version+date freshness row`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response, `no response for ${route}`).not.toBeNull();
      expect(response!.status()).toBe(200);

      const label = FRESHNESS_LABEL[localeOf(route)];
      // The visible row is not a hidden duplicate: the hidden scan is empty.
      expect(await hiddenFreshnessTexts(page, label)).toEqual([]);

      const row = page.locator('open-reading-shell .meta p').filter({ hasText: label });
      await expect(row).toBeVisible();
      // Real version mark + a dated <time>, not the retired empty shell.
      await expect(row).toContainText(/v\d+\.\d+\.\d+/);
      const time = row.locator('time');
      await expect(time).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
      await expect(time).not.toHaveText('');
    });
  }
});
