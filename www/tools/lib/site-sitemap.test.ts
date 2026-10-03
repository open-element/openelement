/** Route-catalog sitemap enumeration unit tests (Beta.2.2, #1327). */
import { expect, test } from 'vitest';
import { join } from '@std/path';
import { SITE_LOCALES, type SiteLocale } from '../../site-config.ts';
import { enumeratePublicRoutes, renderRobotsTxt, renderSitemapXml } from './site-sitemap.ts';
import { articleLastmodByRoute } from './site-lastmod.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const LOCALES: readonly SiteLocale[] = SITE_LOCALES;

test('enumeratePublicRoutes: static catalog + blog enumeration, both locales', () => {
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
  expect(failures).toEqual([]);
  expect(routes).toEqual([
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

test('enumeratePublicRoutes: unenumerated dynamic route fails closed', () => {
  const { routes, failures } = enumeratePublicRoutes({
    routes: [{ path: '/shop/:id', type: 'page' }],
    blogPostRoutes: [],
    locales: LOCALES,
    defaultLocale: 'en',
  });
  expect(routes).toEqual([]);
  expect(failures.length).toEqual(1);
  expect(failures[0].includes('/shop/:id')).toBeTruthy();
});

test('enumeratePublicRoutes: duplicate localized route fails closed', () => {
  const { failures } = enumeratePublicRoutes({
    routes: [
      { path: '/docs', type: 'page' },
      { path: '/docs', type: 'page' },
    ],
    blogPostRoutes: [],
    locales: LOCALES,
    defaultLocale: 'en',
  });
  expect(
    failures.some((failure) => failure.includes("duplicate sitemap route '/docs'")),
  ).toBeTruthy();
});

test('renderSitemapXml: stable schema, home priority, per-route lastmod', () => {
  const xml = renderSitemapXml(['/', '/docs', '/guide/getting-started'], {
    lastmod: new Map([['/guide/getting-started', '2026-09-18']]),
  });
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBeTruthy();
  expect(xml.includes('<loc>https://openelement.org/</loc>')).toBeTruthy();
  expect(xml.includes('<lastmod>2026-09-18</lastmod>')).toBeTruthy();
  expect(xml.includes('<priority>1.0</priority>')).toBeTruthy();
  expect(xml.includes('<loc>https://openelement.org/docs</loc>')).toBeTruthy();
  expect(xml.includes('<priority>0.7</priority>')).toBeTruthy();
  expect(xml.includes('<changefreq>weekly</changefreq>')).toBeTruthy();
  // Routes without a known source date omit <lastmod> entirely instead of
  // falling back to the build clock.
  const docsBlock = xml.split('<loc>https://openelement.org/docs</loc>')[1].split('</url>')[0];
  expect(docsBlock.includes('<lastmod>')).toEqual(false);
  expect(xml.match(/<lastmod>/g)?.length).toEqual(1);
});

test('renderRobotsTxt: allow all plus sitemap pointer', () => {
  expect(renderRobotsTxt()).toEqual(
    'User-agent: *\nAllow: /\n\nSitemap: https://openelement.org/sitemap.xml\n',
  );
});

test('enumeratePublicRoutes: the default locale is explicit, not array order', () => {
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
  expect(failures).toEqual([]);
  expect(routes).toEqual(['/', '/guide', '/zh', '/zh/guide']);
});

test('enumeratePublicRoutes: invalid locale configuration fails closed', () => {
  const base = { routes: [], blogPostRoutes: [] } as const;
  const cases: Array<[string, { locales: string[]; defaultLocale: string }]> = [
    ['no locales', { locales: [], defaultLocale: 'en' }],
    ['duplicate locales', { locales: ['en', 'en'], defaultLocale: 'en' }],
    ['default not in locales', { locales: ['en', 'zh'], defaultLocale: 'fr' }],
  ];
  for (const [label, config] of cases) {
    const { routes, failures } = enumeratePublicRoutes({ ...base, ...config });
    expect(failures.length > 0, `${label}: must fail closed`).toEqual(true);
    expect(routes, label).toEqual([]);
  }
});

test('articleLastmodByRoute: source dates per locale, unknown routes omitted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'site-lastmod-fixture-'));
  try {
    const manifest = join(dir, 'content-dates.json');
    await writeFile(
      manifest,
      JSON.stringify({
        articles: {
          'guide/getting-started': { en: '2026-09-18', zh: '2026-09-17' },
          'architecture/architecture': { en: '2026-09-16', zh: 'uncommitted' },
        },
      }),
    );
    const map = await articleLastmodByRoute(
      [
        '/',
        '/guide/getting-started',
        '/zh/guide/getting-started',
        '/architecture',
        '/zh/architecture',
        '/blog/hello',
      ],
      manifest,
    );
    expect(map.get('/guide/getting-started')).toEqual('2026-09-18');
    expect(map.get('/zh/guide/getting-started')).toEqual('2026-09-17');
    expect(map.get('/architecture')).toEqual('2026-09-16');
    expect(map.has('/zh/architecture')).toEqual(false); // 'uncommitted' is hidden
    expect(map.has('/')).toEqual(false);
    expect(map.has('/blog/hello')).toEqual(false);
  } finally {
    await rm(dir, { recursive: true });
  }
});
