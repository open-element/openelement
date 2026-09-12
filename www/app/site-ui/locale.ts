/**
 * Shared content-locale selector for www routes and site-ui shells.
 *
 * The site builds exactly two locales (www/vite.config.ts `locales`); any
 * value other than 'zh' falls back to the English content record.
 */
export function contentLocale(locale: string): 'en' | 'zh' {
  return locale === 'zh' ? 'zh' : 'en';
}
