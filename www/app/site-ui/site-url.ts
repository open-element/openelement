/**
 * The site's outward URL vocabulary (owner decision D-02, 2026-10-29).
 *
 * Route identity stays slash-less (`/docs`, `/guide/getting-started`); only the
 * outward URL carries the trailing slash for directory routes. The production
 * host (Cloudflare Pages) serves `/docs/` and 308s `/docs`, so the canonical
 * form has to be the trailing-slash one — otherwise every sitemap URL, canonical
 * tag and internal link pays one redirect hop.
 *
 * Exceptions, in priority order (see normalizeSiteHref):
 *   1. the site root: `/` and the localized root `/zh/`;
 *   2. flat routes whose artifact is a flat `.html` file: `/404`, `/zh/404`;
 *   3. explicit static assets (extension whitelist / known asset prefixes);
 *   4. everything else site-internal is a directory route and gets `/`.
 *
 * Normalization order is load-bearing: strip the locale prefix, judge the
 * slash-less route identity, then rebuild the localized URL with its
 * query/hash. That ordering is what keeps `/zh` → `/zh/` and `/zh/404` →
 * `/zh/404` (never `/zh/404/`) correct.
 *
 * External URLs, protocol-relative URLs, anchors, relative references and
 * mailto:/tel: links pass through unchanged: this module only owns the shape of
 * the site's own absolute paths.
 */

import { isSiteLocale, SITE_DEFAULT_LOCALE, SITE_LOCALES } from '../../site-config.ts';
import { normalizeLocalePath } from './i18n.ts';

export const SITE_ORIGIN = 'https://openelement.org';

/** Page routes whose build artifact is a flat `.html` file (no directory index). */
export const FLAT_ROUTES: ReadonlySet<string> = new Set(['/404']);

/** Extensions that are always static assets, never directory routes. */
const STATIC_EXTENSIONS: ReadonlySet<string> = new Set([
  'avif',
  'css',
  'gif',
  'html',
  'ico',
  'jpeg',
  'jpg',
  'js',
  'json',
  'map',
  'mjs',
  'pdf',
  'png',
  'svg',
  'txt',
  'webp',
  'woff',
  'woff2',
  'xml',
  'zip',
]);

/** Emitted asset roots; everything under them is a file, never a page route. */
const STATIC_PREFIXES: readonly string[] = [
  '/assets/',
  '/client/',
  '/island-manifests/',
  '/pagefind/',
];

/** Split a site path into its pathname and its `?query#hash` suffix. */
function splitSuffix(href: string): { pathname: string; suffix: string } {
  const head = href.indexOf('#');
  const query = href.indexOf('?');
  const candidates = [head, query].filter((index) => index >= 0);
  const cut = candidates.length > 0 ? Math.min(...candidates) : -1;
  return cut < 0
    ? { pathname: href, suffix: '' }
    : { pathname: href.slice(0, cut), suffix: href.slice(cut) };
}

/** A site-root-relative absolute path this module owns the shape of. */
function isOwnPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

/** True for the emitted static asset surface (never locale-prefixed, never slashed). */
function isStaticPathname(pathname: string): boolean {
  if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  const last = pathname.split('/').filter(Boolean).at(-1) ?? '';
  const dot = last.lastIndexOf('.');
  if (dot < 0) return false;
  return STATIC_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
}

/**
 * Route identity (no locale prefix, no trailing slash) → the outward pathname
 * for that identity in the default locale. Used where a slash-less route is the
 * input, e.g. the sitemap's locale alternates and the generated link data.
 */
export function canonicalRoutePath(route: string): string {
  if (!isOwnPath(route)) return route;
  const { pathname, suffix } = splitSuffix(route);
  if (suffix !== '') {
    // A route identity never carries a query/hash; this is an already-formed
    // URL, so normalize it instead of pretending it is an identity.
    return normalizeSiteHref(route);
  }
  const { path } = normalizeLocalePath(pathname, {
    locales: [...SITE_LOCALES],
    defaultLocale: SITE_DEFAULT_LOCALE,
  });
  if (path === '/') return '/';
  if (FLAT_ROUTES.has(path) || isStaticPathname(path)) return path;
  return `${path}/`;
}

/**
 * Outward href for a site route identity: locale prefix + canonical path,
 * re-attaching any query/hash. Default locale keeps the unprefixed form.
 */
export function siteHref(route: string, locale: string): string {
  if (!isOwnPath(route)) return route;
  const { pathname, suffix } = splitSuffix(route);
  const { path } = normalizeLocalePath(pathname, {
    locales: [...SITE_LOCALES],
    defaultLocale: SITE_DEFAULT_LOCALE,
  });
  const resolvedLocale = isSiteLocale(locale) ? locale : SITE_DEFAULT_LOCALE;
  const prefixed = (identity: string): string =>
    resolvedLocale === SITE_DEFAULT_LOCALE ? identity : `/${resolvedLocale}${identity}`;
  if (path === '/' || isStaticPathname(path)) {
    const root =
      path === '/' ? (resolvedLocale === SITE_DEFAULT_LOCALE ? '/' : `/${resolvedLocale}/`) : path;
    return `${root}${suffix}`;
  }
  if (FLAT_ROUTES.has(path)) return `${prefixed(path)}${suffix}`;
  return `${prefixed(path)}/${suffix}`;
}

/**
 * Normalize an already-formed site href (nav data, Markdown link targets, a
 * component's raw `href`) into the outward canonical form. Also handles
 * absolute URLs on the site origin; every other input passes through.
 */
export function normalizeSiteHref(href: string): string {
  if (href === SITE_ORIGIN) return `${SITE_ORIGIN}/`;
  if (href.startsWith(`${SITE_ORIGIN}/`)) {
    return `${SITE_ORIGIN}${normalizeSiteHref(href.slice(SITE_ORIGIN.length))}`;
  }
  if (!isOwnPath(href)) return href;
  if (href === '/') return href;
  const { pathname, suffix } = splitSuffix(href);
  const { locale, path } = normalizeLocalePath(pathname, {
    locales: [...SITE_LOCALES],
    defaultLocale: SITE_DEFAULT_LOCALE,
  });
  return `${siteHref(path, locale)}${suffix}`;
}
