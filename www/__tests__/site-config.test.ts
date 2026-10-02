/**
 * Canonical site locale configuration contract.
 *
 * These assertions guard the invariants that every derived consumer (Vite
 * i18n, link helpers, sitemap, redirects, head alternates) relies on; adding
 * a locale must stay a single edit in www/site-config.ts.
 */
import { expect, test } from 'vitest';
import { isSiteLocale, SITE_DEFAULT_LOCALE, SITE_LOCALES } from '../site-config.ts';

test('site-config: locales are non-empty and unique', () => {
  expect(SITE_LOCALES.length > 0, 'the site must build at least one locale').toEqual(true);
  expect(new Set(SITE_LOCALES).size, 'duplicate locale entry').toEqual(SITE_LOCALES.length);
  for (const locale of SITE_LOCALES) {
    expect(/^[a-z]{2}(?:-[A-Za-z0-9]+)*$/.test(locale), `invalid locale tag: ${locale}`).toEqual(
      true,
    );
  }
});

test('site-config: the default locale is one of the built locales', () => {
  expect(SITE_LOCALES.includes(SITE_DEFAULT_LOCALE)).toEqual(true);
  expect(isSiteLocale(SITE_DEFAULT_LOCALE)).toEqual(true);
  expect(isSiteLocale('not-a-locale')).toEqual(false);
});
