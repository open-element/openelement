/**
 * Route-catalog sitemap for www (Beta.2.2, #1327).
 *
 * sitemap.xml is generated from the route catalog plus explicit public
 * eligibility — never by scanning built output or request-time Documents:
 *
 *   - static page routes come from the adapter route scanner (the file-owned
 *     route catalog);
 *   - dynamic-but-public routes come from explicit enumeration: the committed,
 *     drift-gated content graph's blog-post entries (the same truth the
 *     route's getStaticPaths projects). An unenumerated dynamic page route
 *     fails closed instead of silently dropping out of the public index;
 *   - error documents (/404) are never sitemap entries, and the exclude list
 *     below removes routes that are real pages but not a public surface
 *     (#1148 probe);
 *   - every public route expands to one URL per site locale: the default
 *     locale keeps the canonical unprefixed path, other locales prefix.
 *
 * lastmod semantics are unchanged from the previous generator: the build
 * date for every URL. Pagefind consumes dist independently of this file.
 *
 * Pure functions only; IO lives in ../generate-www-sitemap.ts.
 */

import { SITE_ORIGIN } from '../../www/app/site-ui/head.ts';

export interface SitemapUrlEntry {
  loc: string;
  lastmod: string;
  changefreq: string;
  priority: number;
}

export interface WwwRouteCatalogEntry {
  path: string;
  type: string;
}

/**
 * Real pages that are not a public surface. #1148: /probe-light is an e2e
 * probe route (built in both locales) that must stay out of sitemap.xml; the
 * nav scanner never picks it up either (no meta export). Exclusion applies to
 * the canonical route, so every locale variant is excluded by construction.
 */
export const WWW_SITEMAP_EXCLUDE: readonly string[] = ['/probe-light'];

export interface EnumeratePublicRoutesOptions {
  /** Route catalog from the adapter route scanner. */
  routes: readonly WwwRouteCatalogEntry[];
  /** Blog-post routes enumerated from the drift-gated content graph. */
  blogPostRoutes: readonly string[];
  /** Site locales; the first is the default (unprefixed) locale. */
  locales: readonly string[];
  /** Canonical routes excluded from the public index. */
  exclude?: readonly string[];
}

/**
 * Dynamic page routes the www build prerenders through getStaticPaths, keyed
 * by the scanned route path, each mapped to its explicit public enumeration.
 * A dynamic route missing from this table fails the enumeration closed —
 * "SSR could render it" is never evidence of publicness (#1327).
 */
function dynamicRouteEnumeration(
  routePath: string,
  blogPostRoutes: readonly string[],
): string[] | undefined {
  if (routePath === '/blog/:slug') return [...blogPostRoutes];
  return undefined;
}

/**
 * Enumerate the public localized routes of the site. Returns the sorted URL
 * paths (default-locale canonical plus locale-prefixed variants) and the
 * fail-closed failures (an unenumerable dynamic route, a duplicate, or an
 * excluded/empty enumeration entry).
 */
export function enumeratePublicRoutes(
  options: EnumeratePublicRoutesOptions,
): { routes: string[]; failures: string[] } {
  const { routes, blogPostRoutes, locales, exclude = [] } = options;
  const defaultLocale = locales[0];
  const failures: string[] = [];
  const excluded = (path: string): boolean =>
    exclude.some((pattern) =>
      path === pattern || path.startsWith(pattern.endsWith('/') ? pattern : `${pattern}/`)
    );

  const canonical: string[] = [];
  for (const entry of routes) {
    if (entry.type !== 'page') continue;
    // Error documents are never sitemap entries (both the flat default-locale
    // artifact and the locale-prefixed variants share the /404 route).
    if (entry.path === '/404' || entry.path.endsWith('/404')) continue;
    if (excluded(entry.path)) continue;
    if (entry.path.includes(':')) {
      const enumeration = dynamicRouteEnumeration(entry.path, blogPostRoutes);
      if (enumeration === undefined) {
        failures.push(
          `dynamic page route '${entry.path}' has no explicit public enumeration — ` +
            'add one to dynamicRouteEnumeration or exclude the route',
        );
        continue;
      }
      canonical.push(...enumeration);
      continue;
    }
    canonical.push(entry.path);
  }

  const seen = new Set<string>();
  const localized: string[] = [];
  for (const route of canonical) {
    for (const locale of locales) {
      const path = locale === defaultLocale
        ? route
        : route === '/'
        ? `/${locale}`
        : `/${locale}${route}`;
      if (seen.has(path)) {
        failures.push(`duplicate sitemap route '${path}'`);
        continue;
      }
      seen.add(path);
      localized.push(path);
    }
  }
  localized.sort();
  return { routes: localized, failures };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Render sitemap.xml from enumerated public routes (deterministic order). */
export function renderSitemapXml(
  routes: readonly string[],
  options: { today: string; hostname?: string },
): string {
  const hostname = (options.hostname ?? SITE_ORIGIN).replace(/\/$/, '');
  const urls: SitemapUrlEntry[] = routes.map((path) => ({
    loc: `${hostname}${path}`,
    lastmod: options.today,
    changefreq: 'weekly',
    priority: path === '/' ? 1.0 : 0.7,
  }));
  const urlsXml = urls.map((url) =>
    `  <url>\n    <loc>${escapeXml(url.loc)}</loc>\n    <lastmod>${
      escapeXml(url.lastmod)
    }</lastmod>\n` +
    `    <changefreq>${escapeXml(url.changefreq)}</changefreq>\n` +
    `    <priority>${url.priority.toFixed(1)}</priority>\n  </url>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlsXml}\n</urlset>`;
}

/** Render robots.txt pointing at the generated sitemap. */
export function renderRobotsTxt(hostname: string = SITE_ORIGIN): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${hostname.replace(/\/$/, '')}/sitemap.xml\n`;
}
