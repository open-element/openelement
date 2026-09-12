/**
 * Site-local locale path helper.
 *
 * The site's chrome needs the router's locale-prefix normalization, but the
 * router deliberately does not expose an `/i18n` entry point (the retired
 * `@openelement/app/i18n` subpath). The site owns two locale conventions
 * (`en` / `zh` route prefixes), so the normalization lives here rather than
 * widening the framework's public surface.
 *
 * Kept behaviourally identical to the router's internal helper.
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
