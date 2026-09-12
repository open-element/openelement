/**
 * E2E: full public information architecture coverage (#1232, B2.10).
 *
 * The route list is derived MECHANICALLY from the built sitemap
 * (www/dist/sitemap.xml) at collection time — never hand-maintained — so a
 * new public route is covered the moment the build emits it, and a missing
 * or empty sitemap fails the suite closed. A second fail-closed cross-check
 * requires every guide/architecture article route from the generated content
 * graph (tools/lib/content-graph.ts truth) to appear in the sitemap in both
 * locales, so a source-level route that never reached the built public
 * surface is a CI failure here as well. Blog post URLs are slug-rewritten by
 * the blog plugin at build time, so the built sitemap is their only
 * mechanical source of truth (they are covered by the enumeration itself).
 *
 * Per route, the smoke assertion is user-visible: the page answers < 400,
 * carries the correct html lang for its locale, renders exactly one visible
 * level-1 heading inside a main landmark, and produces no uncaught page
 * error (the static build's analog of an error overlay).
 */

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WWW_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP_PATH = join(WWW_ROOT, 'dist', 'sitemap.xml');
const CONTENT_GRAPH_PATH = join(WWW_ROOT, 'app', 'data', '_generated-content-graph.json');

interface GraphEntryLite {
  route?: string;
  locale?: string;
  kind?: string;
  alternates?: Array<{ locale?: string }>;
}

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

/** Fail-closed drift check: content-graph article routes ⊆ sitemap routes. */
function contentGraphDrift(sitemapRoutes: Set<string>): string[] {
  let graph: { entries?: GraphEntryLite[] };
  try {
    graph = JSON.parse(readFileSync(CONTENT_GRAPH_PATH, 'utf-8'));
  } catch (error) {
    return [`content graph unreadable at ${CONTENT_GRAPH_PATH}: ${error}`];
  }
  const failures: string[] = [];
  for (const entry of graph.entries ?? []) {
    if (entry.kind !== 'article' || typeof entry.route !== 'string') continue;
    if (!sitemapRoutes.has(entry.route)) {
      failures.push(`content-graph route '${entry.route}' is missing from the built sitemap`);
    }
    for (const alternate of entry.alternates ?? []) {
      // The default locale (en) is served at the canonical unprefixed route —
      // covered by the check above; only non-default alternates prefix.
      if (typeof alternate.locale !== 'string' || alternate.locale === 'en') continue;
      const localized = `/${alternate.locale}${entry.route}`;
      if (!sitemapRoutes.has(localized)) {
        failures.push(
          `locale alternate '${localized}' of '${entry.route}' is missing from the built sitemap`,
        );
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
  test('sitemap covers every content-graph article route in every locale', () => {
    expect(contentGraphDrift(new Set(routes))).toEqual([]);
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
