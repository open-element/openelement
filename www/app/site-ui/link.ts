/**
 * Shared in-content link helpers for site routes and site-ui shells.
 *
 * The site builds exactly two locales (www/vite.config.ts `locales`); the
 * default locale keeps canonical unprefixed paths, every other locale gets a
 * `/<locale>` prefix. All in-content internal links must go through
 * localizePath so a zh page never drops the reader back into the English
 * tree (#1031). Locale math delegates to ./i18n.ts.
 */
import { isSiteLocale, SITE_DEFAULT_LOCALE, SITE_LOCALES } from '../../site-config.ts';
import { normalizeLocalePath } from './i18n.ts';

/**
 * The one locale-prefixing rule every site link helper shares: a path that is
 * not site-root-relative (external URL, mailto:/tel: link, anchor, relative
 * reference) passes through unchanged; the default locale keeps canonical
 * unprefixed paths; every other site locale gets a `/<locale>` prefix.
 * Callers must pre-check `isSafeLayoutUrl` before handing arbitrary strings
 * here — like every passthrough, this helper does not filter schemes.
 */
export function localizePathIn(
  path: string,
  locale: string,
  locales: readonly string[],
  defaultLocale: string,
): string {
  if (!path.startsWith('/')) return path;
  if (locale === defaultLocale) return path;
  return normalizeLocalePath(`/${locale}${path === '/' ? '' : path}`, {
    locales: [...locales],
    defaultLocale,
  }).localizedPath;
}

/**
 * Prefix an internal absolute path with the locale unless it is the default
 * locale. External URLs, anchors, and unknown locales pass through unchanged.
 */
export function localizePath(path: string, locale: string): string {
  if (!isSiteLocale(locale)) return path;
  return localizePathIn(path, locale, SITE_LOCALES, SITE_DEFAULT_LOCALE);
}

/**
 * Strip a leading locale segment from a path, recognizing only real site
 * locales — a bare "two-letter segment" heuristic would silently drop future
 * sections like `/ui/...` or `/go/...` (#1032).
 */
export function stripLocalePrefix(
  path: string,
  locales: readonly string[] = SITE_LOCALES,
  defaultLocale: string = SITE_DEFAULT_LOCALE,
): string {
  return normalizeLocalePath(path, {
    locales: [...locales],
    defaultLocale,
  }).path;
}
