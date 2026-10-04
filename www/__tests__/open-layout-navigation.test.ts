import { expect, test } from 'vitest';
import { readingChromeStrings } from '../app/site-ui/chrome-strings.ts';
import {
  buildSidebarRows,
  decorateHeaderNav,
  filterNavSections,
  footerColumn,
  isExternalLayoutUrl,
  isSafeLayoutUrl,
  layoutChromeStrings,
  localeSwitchLabel,
  localeSwitchPath,
  localeSwitchScopeNote,
  localizeLayoutPath,
  mobileSectionRoot,
  REPOSITORY_URL,
} from '../app/site-ui/open-layout-navigation.ts';

test('open-layout navigation rejects executable and protocol-relative URLs', () => {
  expect(isSafeLayoutUrl('/guide')).toBeTruthy();
  expect(isSafeLayoutUrl('https://github.com/open-element')).toBeTruthy();
  expect(isSafeLayoutUrl('javascript:alert(1)')).toBeFalsy();
  expect(isSafeLayoutUrl('//attacker.example/path')).toBeFalsy();
  expect(isExternalLayoutUrl('https://github.com/open-element')).toBeTruthy();
  expect(isExternalLayoutUrl('/guide')).toBeFalsy();
});

test('open-layout navigation localizes and switches canonical paths', () => {
  expect(localizeLayoutPath('/guide', 'zh', ['en', 'zh'], 'en')).toEqual('/zh/guide');
  expect(localizeLayoutPath('/guide', 'en', ['en', 'zh'], 'en')).toEqual('/guide');
  expect(localeSwitchPath('/zh/guide', 'zh', ['en', 'zh'], 'en')).toEqual('/guide');
  expect(localeSwitchLabel('en')).toEqual('中文');
});

test('localeSwitchPath degrades unresolved route params to the static ancestor', () => {
  // A pattern path must never put a literal ":slug" into the switcher href.
  expect(localeSwitchPath('/blog/:slug', 'en', ['en', 'zh'], 'en')).toEqual('/zh/blog');
  expect(localeSwitchPath('/zh/blog/:slug', 'zh', ['en', 'zh'], 'en')).toEqual('/blog');
  // A leading param collapses to the locale home.
  expect(localeSwitchPath('/:slug', 'en', ['en', 'zh'], 'en')).toEqual('/zh');
  expect(localeSwitchScopeNote('zh')).toEqual('Switch to English');
});

test('open-layout navigation filters only the active section family', () => {
  const sections = [
    { section: 'Guide', items: [] },
    { section: 'Core', items: [] },
    { section: 'Principles', items: [] },
    { section: 'Reference', items: [] },
    { section: 'Project', items: [] },
  ];
  // A guide page sees the manual (the docs hub's group) and nothing else.
  expect(filterNavSections(sections, '/guide/api')).toEqual([sections[0], sections[1]]);
  expect(filterNavSections(sections, '/architecture/dsd')).toEqual([sections[2], sections[3]]);
  expect(filterNavSections(sections, '/blog')).toEqual([sections[4]]);
  expect(mobileSectionRoot('/zh/guide/api', ['en', 'zh'])).toEqual('/guide');
});

test('open-layout navigation labels the nameless generated group as Project', () => {
  const sections = [
    { section: 'Reference', items: [] },
    { section: 'Project', items: [{ label: 'Roadmap', path: '/roadmap' }] },
  ];
  const generated = [
    { section: 'Reference', items: [] as never[] },
    { section: '', items: [{ label: 'Roadmap', path: '/roadmap' }] },
  ];
  // Unfiltered paths keep every group, with the empty one renamed.
  expect(filterNavSections(generated, '/docs').map((s) => s.section)).toEqual([
    'Reference',
    'Project',
  ]);
  expect(filterNavSections(sections, '/roadmap').map((s) => s.section)).toEqual(['Project']);
  // The blog is a project page, not a stream of its own.
  expect(filterNavSections(sections, '/blog').map((s) => s.section)).toEqual(['Project']);
  expect(filterNavSections(sections, '/reference').map((s) => s.section)).toEqual(['Reference']);
});

const GENERATED_LIKE_SECTIONS = [
  {
    section: 'Guide',
    items: [
      { path: '/docs', label: 'Docs' },
      { path: '/guide/getting-started', label: 'Getting Started' },
      { path: '/guide/api', label: 'API Routes' },
    ],
  },
  { section: 'Core', items: [{ path: '/guide/deployment', label: 'Deployment' }] },
  { section: 'Principles', items: [{ path: '/architecture/dsd', label: 'DSD Rendering' }] },
  { section: 'Reference', items: [{ path: '/reference', label: 'API Reference' }] },
];

test('buildSidebarRows flattens the filtered section tree into heading and link rows', () => {
  const rows = buildSidebarRows(GENERATED_LIKE_SECTIONS, '/guide/api', 'en', ['en', 'zh']);
  expect(rows.map((row) => row.kind)).toEqual([
    'section',
    'link',
    'link',
    'link',
    'section',
    'link',
  ]);
  expect(rows[0].heading).toEqual('Guide');
  expect(rows[2].label).toEqual('Getting Started');
  // The active page is marked exactly once, on the exact-match link.
  expect(rows.filter((row) => row.current === 'page').map((row) => row.href)).toEqual([
    '/guide/api',
  ]);
  // Heading rows carry no link affordance; link rows carry no heading.
  expect(rows[0].href).toEqual(false);
  expect(rows[2].heading).toEqual('');
  // Row keys are unique and stable for the keyed Region.
  expect(new Set(rows.map((row) => row.key)).size).toEqual(rows.length);
});

test('buildSidebarRows localizes link targets and matches the localized current path', () => {
  const rows = buildSidebarRows(GENERATED_LIKE_SECTIONS, '/zh/guide/api', 'zh', ['en', 'zh']);
  const links = rows.filter((row) => row.kind === 'link');
  expect(links.every((row) => row.href !== false && row.href.startsWith('/zh/'))).toBeTruthy();
  expect(rows.filter((row) => row.current === 'page').map((row) => row.href)).toEqual([
    '/zh/guide/api',
  ]);
});

test('buildSidebarRows filters to the active section family before flattening', () => {
  const rows = buildSidebarRows(GENERATED_LIKE_SECTIONS, '/architecture/dsd', 'en', ['en', 'zh']);
  expect(rows.filter((row) => row.kind === 'section').map((row) => row.heading)).toEqual([
    'Principles',
    'Reference',
  ]);
});

test('buildSidebarRows guards unsafe hrefs and marks external links', () => {
  const rows = buildSidebarRows(
    [
      {
        section: 'Guide',
        items: [
          { href: 'javascript:alert(1)', label: 'Evil' },
          { href: 'https://example.com/x', label: 'External' },
        ],
      },
    ],
    '/guide',
    'en',
    ['en', 'zh'],
  );
  const evil = rows.find((row) => row.label === 'Evil');
  const external = rows.find((row) => row.label === 'External');
  expect(evil?.href).toEqual(false);
  expect(external?.href).toEqual('https://example.com/x');
  expect(external?.rel).toEqual('noopener noreferrer');
});

test('decorateHeaderNav marks the current section and never external links', () => {
  const links = [
    { href: '/docs', label: 'Docs' },
    { href: '/blog', label: 'Blog' },
    { href: 'https://github.com/open-element/openelement', label: 'GitHub' },
  ];
  expect(decorateHeaderNav(links, '/docs', 'en', ['en', 'zh']).map((link) => link.current)).toEqual(
    ['page', false, false],
  );
  // Section roots stay current on nested routes (blog posts keep Blog current).
  expect(
    decorateHeaderNav(links, '/blog/1-0-0-alpha-1-baseline', 'en', ['en', 'zh'])[1].current,
  ).toEqual('page');
  // Router 1.0 does not pre-localize shell nav; the Site builder localizes
  // bare hrefs, and current marking must still land for non-default locales.
  const zhNav = decorateHeaderNav(links, '/blog', 'zh', ['en', 'zh']);
  expect(zhNav.map((link) => link.current)).toEqual([false, 'page', false]);
  expect(zhNav[0].href).toEqual('/zh/docs');
  expect(zhNav[2].href).toEqual('https://github.com/open-element/openelement');
  // A locale-prefixed request-time path normalizes to the same result.
  expect(
    decorateHeaderNav(links, '/zh/blog', 'zh', ['en', 'zh']).map((link) => link.current),
  ).toEqual([false, 'page', false]);
});

test('footerColumn restores the four-column link structure with localized targets', () => {
  const product = footerColumn('en', ['en', 'zh'], 'product');
  expect(product.label).toEqual('Product');
  expect(product.links.map((link) => link.href)).toEqual([
    '/guide/core-concepts',
    '/architecture/design-system',
    '/architecture',
    '/architecture/dsd',
  ]);
  const zhProduct = footerColumn('zh', ['en', 'zh'], 'product');
  expect(zhProduct.label).toEqual('产品');
  expect(zhProduct.links.every((link) => link.href.startsWith('/zh/'))).toBeTruthy();
  const company = footerColumn('en', ['en', 'zh'], 'company');
  const github = company.links.find((link) => link.label === 'GitHub');
  expect(github?.href).toEqual('https://github.com/open-element/openelement');
  expect(github?.rel).toEqual('noopener noreferrer');
  const legal = footerColumn('zh', ['en', 'zh'], 'legal');
  expect(legal.label).toEqual('法律');
  expect(legal.links.map((link) => link.label)).toEqual(['MIT 许可证', '参与贡献']);
});

test('layoutChromeStrings carries the bilingual shell chrome copy', () => {
  expect(layoutChromeStrings('en').sidebarLabel).toEqual('Documentation navigation');
  expect(layoutChromeStrings('zh').sidebarLabel).toEqual('文档导航');
  expect(layoutChromeStrings('en').sidebarToggle).toEqual('Documentation');
  expect(layoutChromeStrings('zh').sidebarToggle).toEqual('文档');
  expect(typeof layoutChromeStrings('zh').footerTagline).toEqual('string');
  // Skip link and header chrome; the English literals are e2e landmark pins.
  expect(layoutChromeStrings('en').skipToMain).toEqual('Skip to main content');
  expect(layoutChromeStrings('zh').skipToMain).toEqual('跳到主要内容');
  expect(layoutChromeStrings('en').menuOpen).toEqual('Open navigation');
  expect(layoutChromeStrings('zh').menuOpen).toEqual('打开导航');
  expect(layoutChromeStrings('en').primaryNavLabel).toEqual('Primary navigation');
  expect(layoutChromeStrings('zh').primaryNavLabel).toEqual('主导航');
  expect(layoutChromeStrings('en').mobileNavLabel).toEqual('Mobile navigation');
  expect(layoutChromeStrings('zh').mobileNavLabel).toEqual('移动端导航');
  // Repository link: labeled because the control is icon-only.
  expect(layoutChromeStrings('en').repositoryLabel).toContain('GitHub repository');
  expect(layoutChromeStrings('zh').repositoryLabel).toContain('GitHub 仓库');
});

test('the header repository link targets the public repository', () => {
  expect(REPOSITORY_URL).toEqual('https://github.com/open-element/openelement');
  expect(isSafeLayoutUrl(REPOSITORY_URL)).toBeTruthy();
  expect(isExternalLayoutUrl(REPOSITORY_URL)).toBeTruthy();
});

test('readingChromeStrings carries the bilingual reading chrome copy', () => {
  // The English literals are e2e landmark pins ('On this page' complementary).
  expect(readingChromeStrings('en')).toEqual({
    onThisPage: 'On this page',
    overview: 'Overview',
    pageNavigation: 'Page navigation',
    breadcrumb: 'Breadcrumb',
    sectionAnchor: 'Link to this section',
    previous: 'Previous',
    next: 'Next',
    appliesTo: 'Applies to',
    updated: 'Updated',
    freshnessSeparator: ' · ',
  });
  expect(readingChromeStrings('zh')).toEqual({
    onThisPage: '本页目录',
    overview: '概览',
    pageNavigation: '页面导航',
    breadcrumb: '面包屑',
    sectionAnchor: '链接到本节',
    previous: '上一篇',
    next: '下一篇',
    appliesTo: '适用于',
    updated: '更新于',
    freshnessSeparator: ' · ',
  });
});

test('decorateHeaderNav projects zh labels and keeps the en default', () => {
  const links = [
    { href: '/docs', label: 'Docs', labelZh: '文档' },
    { href: '/blog', label: 'Blog' },
  ];
  expect(decorateHeaderNav(links, '/docs', 'zh', ['en', 'zh']).map((link) => link.label)).toEqual([
    '文档',
    'Blog', // no labelZh: falls back to the English label
  ]);
  expect(decorateHeaderNav(links, '/docs', 'en', ['en', 'zh']).map((link) => link.label)).toEqual([
    'Docs',
    'Blog',
  ]);
});

test('buildSidebarRows projects zh item labels and section headings', () => {
  const sections = [
    {
      section: 'Guide',
      sectionZh: '指南',
      items: [
        { path: '/guide/getting-started', label: 'Getting Started', labelZh: '快速开始' },
        { path: '/guide/api', label: 'API Routes', labelZh: 'API 路由' },
      ],
    },
  ];
  const zhRows = buildSidebarRows(sections, '/zh/guide/api', 'zh', ['en', 'zh']);
  expect(zhRows[0].heading).toEqual('指南');
  expect(zhRows.filter((row) => row.kind === 'link').map((row) => row.label)).toEqual([
    '快速开始',
    'API 路由',
  ]);
  expect(zhRows.find((row) => row.current === 'page')?.label).toEqual('API 路由');
  const enRows = buildSidebarRows(sections, '/guide/api', 'en', ['en', 'zh']);
  expect(enRows[0].heading).toEqual('Guide');
  expect(enRows[1].label).toEqual('Getting Started');
});
