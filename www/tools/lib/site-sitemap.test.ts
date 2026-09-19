/** Route-catalog sitemap enumeration unit tests (Beta.2.2, #1327). */
import { assert, assertEquals } from '@std/assert';
import { join } from '@std/path';
import { enumeratePublicRoutes, renderRobotsTxt, renderSitemapXml } from './site-sitemap.ts';
import { articleLastmodByRoute } from './site-lastmod.ts';

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

Deno.test('renderSitemapXml: stable schema, home priority, per-route lastmod', () => {
  const xml = renderSitemapXml(['/', '/docs', '/guide/getting-started'], {
    lastmod: new Map([['/guide/getting-started', '2026-09-18']]),
  });
  assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert(xml.includes('<loc>https://openelement.org/</loc>'));
  assert(xml.includes('<lastmod>2026-09-18</lastmod>'));
  assert(xml.includes('<priority>1.0</priority>'));
  assert(xml.includes('<loc>https://openelement.org/docs</loc>'));
  assert(xml.includes('<priority>0.7</priority>'));
  assert(xml.includes('<changefreq>weekly</changefreq>'));
  // Routes without a known source date omit <lastmod> entirely instead of
  // falling back to the build clock.
  const docsBlock = xml.split('<loc>https://openelement.org/docs</loc>')[1].split('</url>')[0];
  assertEquals(docsBlock.includes('<lastmod>'), false);
  assertEquals(xml.match(/<lastmod>/g)?.length, 1);
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

Deno.test('articleLastmodByRoute: source dates per locale, unknown routes omitted', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'site-lastmod-fixture-' });
  try {
    const manifest = join(dir, 'content-dates.json');
    await Deno.writeTextFile(
      manifest,
      JSON.stringify({
        articles: {
          'guide/getting-started': { en: '2026-09-18', zh: '2026-09-17' },
          'architecture/architecture': { en: '2026-09-16', zh: 'uncommitted' },
        },
      }),
    );
    const map = await articleLastmodByRoute([
      '/',
      '/guide/getting-started',
      '/zh/guide/getting-started',
      '/architecture',
      '/zh/architecture',
      '/blog/hello',
    ], manifest);
    assertEquals(map.get('/guide/getting-started'), '2026-09-18');
    assertEquals(map.get('/zh/guide/getting-started'), '2026-09-17');
    assertEquals(map.get('/architecture'), '2026-09-16');
    assertEquals(map.has('/zh/architecture'), false); // 'uncommitted' is hidden
    assertEquals(map.has('/'), false);
    assertEquals(map.has('/blog/hello'), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
