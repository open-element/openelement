/** Route-catalog sitemap enumeration unit tests (Beta.2.2, #1327). */
import { assert, assertEquals } from '@std/assert';
import { enumeratePublicRoutes, renderRobotsTxt, renderSitemapXml } from './site-sitemap.ts';

const LOCALES = ['en', 'zh'] as const;

Deno.test('enumeratePublicRoutes: static catalog + blog enumeration, both locales', () => {
  const { routes, failures } = enumeratePublicRoutes({
    routes: [
      { path: '/', type: 'page' },
      { path: '/404', type: 'page' },
      { path: '/docs', type: 'page' },
      { path: '/blog/:slug', type: 'page' },
      { path: '/api/hello', type: 'api' },
      { path: '/_renderer', type: 'special' },
    ],
    blogPostRoutes: ['/blog/a', '/blog/b'],
    locales: LOCALES,
    defaultLocale: 'en',
  });
  assertEquals(failures, []);
  assertEquals(routes, [
    '/',
    '/blog/a',
    '/blog/b',
    '/docs',
    '/zh',
    '/zh/blog/a',
    '/zh/blog/b',
    '/zh/docs',
  ]);
});

Deno.test('enumeratePublicRoutes: unenumerated dynamic route fails closed', () => {
  const { routes, failures } = enumeratePublicRoutes({
    routes: [{ path: '/shop/:id', type: 'page' }],
    blogPostRoutes: [],
    locales: LOCALES,
    defaultLocale: 'en',
  });
  assertEquals(routes, []);
  assertEquals(failures.length, 1);
  assert(failures[0].includes('/shop/:id'));
});

Deno.test('enumeratePublicRoutes: duplicate localized route fails closed', () => {
  const { failures } = enumeratePublicRoutes({
    routes: [
      { path: '/docs', type: 'page' },
      { path: '/docs', type: 'page' },
    ],
    blogPostRoutes: [],
    locales: LOCALES,
    defaultLocale: 'en',
  });
  assert(failures.some((failure) => failure.includes("duplicate sitemap route '/docs'")));
});

Deno.test('renderSitemapXml: stable schema, home priority, build-date lastmod', () => {
  const xml = renderSitemapXml(['/', '/docs'], { today: '2026-09-10' });
  assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert(xml.includes('<loc>https://openelement.org/</loc>'));
  assert(xml.includes('<lastmod>2026-09-10</lastmod>'));
  assert(xml.includes('<priority>1.0</priority>'));
  assert(xml.includes('<loc>https://openelement.org/docs</loc>'));
  assert(xml.includes('<priority>0.7</priority>'));
  assert(xml.includes('<changefreq>weekly</changefreq>'));
});

Deno.test('renderRobotsTxt: allow all plus sitemap pointer', () => {
  assertEquals(
    renderRobotsTxt(),
    'User-agent: *\nAllow: /\n\nSitemap: https://openelement.org/sitemap.xml\n',
  );
});

Deno.test('enumeratePublicRoutes: the default locale is explicit, not array order', () => {
  // 'zh' first but 'en' default: unprefixed paths stay English, and the
  // Chinese tree gets the /zh prefix.
  const { routes, failures } = enumeratePublicRoutes({
    routes: [
      { type: 'page', path: '/' },
      { type: 'page', path: '/guide' },
    ],
    blogPostRoutes: [],
    locales: ['zh', 'en'],
    defaultLocale: 'en',
  });
  assertEquals(failures, []);
  assertEquals(routes, ['/', '/guide', '/zh', '/zh/guide']);
});

Deno.test('enumeratePublicRoutes: invalid locale configuration fails closed', () => {
  const base = { routes: [], blogPostRoutes: [] } as const;
  const cases: Array<[string, { locales: string[]; defaultLocale: string }]> = [
    ['no locales', { locales: [], defaultLocale: 'en' }],
    ['duplicate locales', { locales: ['en', 'en'], defaultLocale: 'en' }],
    ['default not in locales', { locales: ['en', 'zh'], defaultLocale: 'fr' }],
  ];
  for (const [label, config] of cases) {
    const { routes, failures } = enumeratePublicRoutes({ ...base, ...config });
    assertEquals(failures.length > 0, true, `${label}: must fail closed`);
    assertEquals(routes, [], label);
  }
});
