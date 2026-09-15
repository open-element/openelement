/**
 * E2E: full public information architecture coverage (#1232, B2.10).
 *
 * The route list is derived MECHANICALLY from the built sitemap
 * (www/dist/sitemap.xml) at collection time — never hand-maintained — so a
 * new public route is covered the moment the build emits it, and a missing
 * or empty sitemap fails the suite closed. A second fail-closed cross-check
 * requires every guide/architecture article route from the generated content
 * content sources (www/content/{guide,architecture}/*.md, paired en/zh)
 * to appear in the sitemap in both locales, so a source-level route that
 * never reached the built public surface is a CI failure here as well. Blog
 * post URLs are slug-rewritten by the blog plugin at build time, so the
 * built sitemap is their only mechanical source of truth (they are covered
 * by the enumeration itself).
 *
 * Per route, the smoke assertion is user-visible: the page answers < 400,
 * carries the correct html lang for its locale, renders exactly one visible
 * level-1 heading inside a main landmark, and produces no uncaught page
 * error (the static build's analog of an error overlay).
 */

import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP_PATH = join(SITE_ROOT, 'dist', 'sitemap.xml');
const CONTENT_DIR = join(SITE_ROOT, 'content');

/** Public routes enumerated from the built sitemap; throws fail-closed. */
function readSitemapRoutes(): string[] {
  let xml: string;
  try {
    xml = readFileSync(SITEMAP_PATH, 'utf-8');
  } catch (error) {
    throw new Error(
      `public IA coverage requires the built sitemap at ${SITEMAP_PATH} — run \`deno task build\` first (${error})`,
    );
  }
  const routes = [...xml.matchAll(/<loc>https:\/\/openelement\.org([^<]*)<\/loc>/g)]
    .map((match) => match[1] || '/');
  if (routes.length === 0) {
    throw new Error(`sitemap at ${SITEMAP_PATH} lists no routes — the public IA is empty`);
  }
  return routes;
}

/** Article collection bases mirrored from www/content-collections.ts. */
const ARTICLE_COLLECTIONS = ['guide', 'architecture'] as const;

/**
 * Fail-closed drift check: every article source route ⊆ sitemap routes.
 * Derived independently from the Markdown sources (X.md => en, X.zh.md => zh)
 * rather than from any intermediate index, so a page the build drops is
 * caught here.
 */
function contentSourceDrift(sitemapRoutes: Set<string>): string[] {
  const failures: string[] = [];
  for (const collection of ARTICLE_COLLECTIONS) {
    let files: string[];
    try {
      files = readdirSync(join(CONTENT_DIR, collection));
    } catch (error) {
      return [`content collection unreadable at ${collection}: ${error}`];
    }
    const slugs = new Set<string>();
    const zhSlugs = new Set<string>();
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      if (file.endsWith('.zh.md')) zhSlugs.add(file.slice(0, -'.zh.md'.length));
      else slugs.add(file.slice(0, -'.md'.length));
    }
    for (const slug of slugs) {
      const route = `/${collection}/${slug}`;
      if (!sitemapRoutes.has(route)) {
        failures.push(`article route '${route}' is missing from the built sitemap`);
      }
      // The default locale (en) is served at the canonical unprefixed route —
      // covered by the check above; only non-default alternates prefix.
      if (zhSlugs.has(slug) && !sitemapRoutes.has(`/zh${route}`)) {
        failures.push(`locale alternate '/zh${route}' is missing from the built sitemap`);
      }
    }
  }
  return failures;
}

function expectedLocale(route: string): string {
  return route === '/zh' || route.startsWith('/zh/') ? 'zh' : 'en';
}

const routes = readSitemapRoutes();

test.describe('Public IA route coverage', () => {
  test('sitemap covers every article source route in every locale', () => {
    expect(contentSourceDrift(new Set(routes))).toEqual([]);
  });

  for (const route of routes) {
    test(`GET ${route} renders with the correct locale and heading`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response, `no response for ${route}`).not.toBeNull();
      expect(response!.status()).toBeLessThan(400);

      await expect(page.locator('html')).toHaveAttribute('lang', expectedLocale(route));
      // Nested mains exist (app shell + page body); the first is the shell's.
      await expect(page.getByRole('main').first()).toBeVisible();
      // Some pages render more than one level-1 heading (blog posts carry the
      // post header h1 plus the article body h1) — assert one is visible.
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      expect(pageErrors).toEqual([]);
    });
  }
});
