/**
 * Accessibility coverage sweep (T10 R5, G3-approved).
 *
 * The resident gate (accessibility-gate.spec.ts) scans one route per page
 * TEMPLATE: `/`, `/guide/getting-started`, `/docs`, `/reference`, plus the zh
 * article template and the open search dialog. That is 6 of 74 documents, and
 * the zh tree's `/zh`, `/zh/changelog`, `/zh/roadmap`, `/zh/reference`,
 * `/zh/errors` and `/zh/404` had never been scanned at all.
 *
 * This spec is the coverage half — it walks the same templates plus the zh
 * pages the resident gate never reached, on the built site, and asserts WCAG
 * 2.1 A+AA with axe. Measured cost of the whole set: ~52 s (2026-10-18, the
 * date the list was chosen), of which `/reference` is ~12 s — the resident
 * spec's 2.8-minute `/reference` scan is dominated by its scroll-and-settle
 * walk, which this sweep deliberately does not repeat: these routes carry no
 * scroll-timeline copy, so a settled snapshot is the load state.
 *
 * The home exception list is shared with the resident gate rather than copied:
 * a second list would drift, and `/zh` needs exactly the same exceptions the
 * English home page does (66 nodes there against 62 on `/` — the zh home had
 * never been scanned, so nobody had seen them).
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { HOME_AXE_EXCLUSIONS } from './axe-home-exclusions.ts';

/** One route per template plus the zh pages the resident gate never scanned. */
const SWEPT_ROUTES = [
  '/',
  '/docs/',
  '/guide/getting-started/',
  '/guide/core-concepts/',
  '/architecture/',
  '/architecture/comparison/',
  '/changelog/',
  '/roadmap/',
  '/errors/',
  '/404',
  '/blog/1-0-0-alpha-1-baseline/',
  '/zh/',
  '/zh/docs/',
  '/zh/changelog/',
  '/zh/roadmap/',
  '/zh/errors/',
  '/zh/404',
] as const;

/** Both locale roots render the same scroll-animated home template. */
export const HOME_ROUTES: ReadonlySet<string> = new Set(['/', '/zh/']);

/**
 * zh pages must not announce untranslated English chrome. The sweep scans every
 * aria-label on a zh page and fails on an ASCII-only one that is not listed
 * here with its reason — so a new hardcoded English label has to be a decision,
 * not an accident.
 */
const ZH_ARIA_ALLOWLIST: Readonly<Record<string, string>> = {
  openElement: 'the brand name, identical in both locales',
  'Toggle theme':
    'packages/ui/src/open-theme-toggle.tsx hardcodes the accessible name and the ' +
    'component exposes no label input (T10 register B4, framework lane)',
};

function scan(page: Page, route: string) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
  if (HOME_ROUTES.has(route)) {
    for (const selector of HOME_AXE_EXCLUSIONS) builder = builder.exclude(selector);
  }
  return builder.analyze();
}

// The two generated mega-pages (2.09 MB each) are scanned by
// accessibility-mega-pages.spec.ts instead of here: Firefox intermittently
// stops making progress on them under a full three-engine run, and Playwright
// scopes `testIgnore` to files, not to individual tests. That file carries the
// coverage note (including the one Firefox gap it leaves).

test.describe('Accessibility coverage sweep (axe)', () => {
  for (const route of SWEPT_ROUTES) {
    test(`axe meets WCAG 2.1 A+AA on ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const { violations } = await scan(page, route);
      const report = violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
        help: violation.help,
      }));
      expect(
        violations,
        `axe found WCAG A/AA violations on ${route}:\n${JSON.stringify(report, null, 1)}`,
      ).toEqual([]);
    });
  }

  test('zh pages carry no untranslated aria-label', async ({ page }) => {
    const untranslated: string[] = [];
    for (const route of SWEPT_ROUTES.filter((route) => route.startsWith('/zh/'))) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const labels: string[] = await page.evaluate(() =>
        [...document.querySelectorAll('[aria-label]')].map(
          (element) => element.getAttribute('aria-label') ?? '',
        ),
      );
      for (const label of new Set(labels)) {
        // The subject is untranslated English WORDS: a numeric or symbol-only
        // label ("404" on the zh error page) is language-neutral, not a
        // translation defect.
        if (label === '' || !/^[\x20-\x7e]+$/u.test(label) || !/[A-Za-z]/u.test(label)) continue;
        if (label in ZH_ARIA_ALLOWLIST) continue;
        untranslated.push(`${route}: '${label}'`);
      }
    }
    expect(
      untranslated,
      'untranslated English aria-labels on zh pages — localize the label or add it to ' +
        'ZH_ARIA_ALLOWLIST with the reason it must stay English',
    ).toEqual([]);
  });

  test('the English counterparts of the localized labels are not Chinese', async ({ page }) => {
    // The reverse direction of the zh check: the two labels T10 localized
    // (changelog register, package graph) must not leak the zh copy into the
    // English tree.
    for (const [route, forbidden] of [
      ['/changelog/', '发布登记表'],
      ['/roadmap/', '包依赖图'],
    ] as const) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const labels: string[] = await page.evaluate(() =>
        [...document.querySelectorAll('[aria-label]')].map(
          (element) => element.getAttribute('aria-label') ?? '',
        ),
      );
      expect(labels, `${route} must not carry zh aria copy`).not.toContain(forbidden);
    }
  });
});
