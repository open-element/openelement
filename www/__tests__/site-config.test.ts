/**
 * Canonical site locale configuration contract.
 *
 * These assertions guard the invariants that every derived consumer (Vite
 * i18n, link helpers, sitemap, redirects, head alternates) relies on; adding
 * a locale must stay a single edit in www/site-config.ts.
 */
import { assertEquals } from '@std/assert';
import { isSiteLocale, SITE_DEFAULT_LOCALE, SITE_LOCALES } from '../site-config.ts';

Deno.test('site-config: locales are non-empty and unique', () => {
  assertEquals(SITE_LOCALES.length > 0, true, 'the site must build at least one locale');
  assertEquals(new Set(SITE_LOCALES).size, SITE_LOCALES.length, 'duplicate locale entry');
  for (const locale of SITE_LOCALES) {
    assertEquals(
      /^[a-z]{2}(?:-[A-Za-z0-9]+)*$/.test(locale),
      true,
      `invalid locale tag: ${locale}`,
    );
  }
});

Deno.test('site-config: the default locale is one of the built locales', () => {
  assertEquals(SITE_LOCALES.includes(SITE_DEFAULT_LOCALE), true);
  assertEquals(isSiteLocale(SITE_DEFAULT_LOCALE), true);
  assertEquals(isSiteLocale('not-a-locale'), false);
});
