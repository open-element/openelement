/**
 * @openelement/router/i18n - Unit Tests
 * ADR 0018: Tests updated for pure function pattern (loadI18nData)
 */
import { assertEquals, assertStrictEquals } from '@std/assert';
import { loadI18nData, normalizeLocalePath } from '../src/i18n.ts';

// ─── loadI18nData ─────────────────────────────────────────────────

Deno.test('loadI18nData: returns options copy', () => {
  const opts = { locales: ['en', 'zh'], defaultLocale: 'en' };
  const result = loadI18nData(opts);
  assertEquals(result.locales, ['en', 'zh']);
  assertStrictEquals(result.defaultLocale, 'en');
});

Deno.test('loadI18nData: returns independent copy', () => {
  const opts = { locales: ['en', 'zh'], defaultLocale: 'en' };
  const result = loadI18nData(opts);
  // Mutating the result should not affect the original
  result.locales.push('ja');
  assertEquals(opts.locales, ['en', 'zh']);
});

// ─── normalizeLocalePath ───────────────────────────────────────────

Deno.test('normalizeLocalePath: only configured locales are parsed as locale', () => {
  assertEquals(
    normalizeLocalePath('/guide/getting-started', {
      locales: ['en', 'zh'],
      defaultLocale: 'en',
    }),
    {
      locale: 'en',
      path: '/guide/getting-started',
      localizedPath: '/guide/getting-started',
      isDefaultLocalePath: true,
    },
  );
});

Deno.test('normalizeLocalePath: localized path keeps configured prefix', () => {
  assertEquals(
    normalizeLocalePath('/zh/guide/getting-started', {
      locales: ['en', 'zh'],
      defaultLocale: 'en',
    }),
    {
      locale: 'zh',
      path: '/guide/getting-started',
      localizedPath: '/zh/guide/getting-started',
      isDefaultLocalePath: false,
    },
  );
});
