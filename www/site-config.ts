/**
 * Site-owned locale configuration — the ONE editable source for the locales
 * this website builds.
 *
 * The Vite build (i18n.locales/defaultLocale), the site-ui link helpers, and
 * the site tooling (sitemap, redirects, link checks, head alternates) all
 * derive from this module. Adding a locale is a single edit here plus the
 * content/route work — never a per-consumer sweep. This module is neutral:
 * no UI, no build tooling, no framework imports.
 */

export const SITE_LOCALES = ['en', 'zh'] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number];

export const SITE_DEFAULT_LOCALE: SiteLocale = 'en';

/** Narrow an arbitrary string (route param, attribute) to a built locale. */
export function isSiteLocale(value: string): value is SiteLocale {
  return (SITE_LOCALES as readonly string[]).includes(value);
}
