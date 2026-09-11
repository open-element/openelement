/**
 * @openelement/router/internal/router/i18n - Locale-aware path types and utilities.
 *
 * Zero-dependency pure TypeScript — shared by @openelement/router/internal/router
 * and @openelement/router/i18n helpers.
 */

export interface LocalePath {
  locale: string;
  path: string;
  localizedPath: string;
  isDefaultLocalePath: boolean;
}

export function normalizeLocalePath(
  pathname: string,
  options: { locales: string[]; defaultLocale: string },
): LocalePath {
  const locales = options.locales.length > 0 ? options.locales : [options.defaultLocale];
  const defaultLocale = locales.includes(options.defaultLocale)
    ? options.defaultLocale
    : locales[0];
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const parts = cleanPath.split('/').filter(Boolean);
  const first = parts[0];
  const hasLocalePrefix = first !== undefined && locales.includes(first);
  const locale = hasLocalePrefix ? first : defaultLocale;
  const rest = hasLocalePrefix ? parts.slice(1) : parts;
  const path = rest.length === 0 ? '/' : `/${rest.join('/')}`;
  return {
    locale,
    path,
    localizedPath: locale === defaultLocale ? path : `/${locale}${path === '/' ? '' : path}`,
    isDefaultLocalePath: locale === defaultLocale,
  };
}
