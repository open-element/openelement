/**
 * Shared content-locale selector for site routes and site-ui shells.
 *
 * The site builds exactly the SITE_LOCALES set (www/site-config.ts, consumed
 * by openelement.config.ts i18n); any value other than 'zh' falls back to the
 * default-locale content record.
 */
import { SITE_DEFAULT_LOCALE, type SiteLocale } from '../../site-config.ts';

export function contentLocale(locale: string): SiteLocale {
  return locale === 'zh' ? 'zh' : SITE_DEFAULT_LOCALE;
}
