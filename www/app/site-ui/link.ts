/**
 * Shared in-content link helpers for www routes and site-ui shells.
 *
 * The site builds exactly two locales (www/vite.config.ts `locales`); the
 * default locale keeps canonical unprefixed paths, every other locale gets a
 * `/<locale>` prefix. All in-content internal links must go through
 * localizePath so a zh page never drops the reader back into the English
 * tree (#1031). Locale math delegates to @openelement/app/i18n.
 */
import { normalizeLocalePath } from '@openelement/app/i18n';

/** Locales emitted by the www build (www/vite.config.ts `locales`). */
export const SITE_LOCALES: readonly string[] = ['en', 'zh'];
// Internal default-locale anchor for the two helpers below; not part of the
// module's public surface.
const SITE_DEFAULT_LOCALE: string = SITE_LOCALES[0];

/**
 * Prefix an internal absolute path with the locale unless it is the default
 * locale. External URLs, anchors, and unknown locales pass through unchanged.
 */
export function localizePath(path: string, locale: string): string {
  if (!path.startsWith('/')) return path;
  if (!SITE_LOCALES.includes(locale)) return path;
  return normalizeLocalePath(`/${locale}${path === '/' ? '' : path}`, {
    locales: [...SITE_LOCALES],
    defaultLocale: SITE_DEFAULT_LOCALE,
  }).localizedPath;
}

/**
 * Strip a leading locale segment from a path, recognizing only real site
 * locales — a bare "two-letter segment" heuristic would silently drop future
 * sections like `/ui/...` or `/go/...` (#1032).
 */
export function stripLocalePrefix(
  path: string,
  locales: readonly string[] = SITE_LOCALES,
): string {
  return normalizeLocalePath(path, {
    locales: [...locales],
    defaultLocale: locales[0] ?? SITE_DEFAULT_LOCALE,
  }).path;
}
