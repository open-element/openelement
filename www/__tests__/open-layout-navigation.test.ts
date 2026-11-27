import { expect, test } from 'vitest';
import { readingChromeStrings } from '../app/site-ui/chrome-strings.ts';
import {
  buildSidebarRows,
  decorateHeaderNav,
  globalNavSections,
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
  showsDocumentationSidebar,
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
  expect(localeSwitchPath('/zh/guide', 'zh', ['en', 'zh'], 'en')).toEqual('/guide/');
  // The switcher's href is emitted in the outward canonical form (D-02).
  expect(localeSwitchPath('/zh', 'zh', ['en', 'zh'], 'en')).toEqual('/');
  expect(localeSwitchLabel('en')).toEqual('中文');
});

test('localeSwitchPath degrades unresolved route params to the static ancestor', () => {
  // A pattern path must never put a literal ":slug" into the switcher href.
  expect(localeSwitchPath('/articles/:slug', 'en', ['en', 'zh'], 'en')).toEqual('/zh/articles/');
  expect(localeSwitchPath('/zh/articles/:slug', 'zh', ['en', 'zh'], 'en')).toEqual('/articles/');
  // A leading param collapses to the locale home.
  expect(localeSwitchPath('/:slug', 'en', ['en', 'zh'], 'en')).toEqual('/zh/');
  // The sr-only note completes the target-locale label in the READER's language
  // (the branches were swapped: a zh page carried an English sentence).
  expect(localeSwitchScopeNote('zh')).toContain('查看本页的英文版本');
  expect(localeSwitchScopeNote('en')).toContain('View this page in Chinese');
});

test('open-layout navigation keeps the complete global section tree', () => {
  const sections = [
    { section: 'LEARN', items: [] },
    { section: 'GUIDES', items: [] },
    { section: 'REFERENCE', items: [] },
    { section: 'PROJECT', items: [] },
  ];
  expect(globalNavSections(sections)).toEqual(sections);
  expect(globalNavSections(sections)).toEqual(sections);
  expect(globalNavSections(sections)).toEqual(sections);
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
  expect(globalNavSections(generated).map((s) => s.section)).toEqual(['Reference', 'Project']);
  expect(globalNavSections(sections).map((s) => s.section)).toEqual(['Reference', 'Project']);
  // Release status belongs to the project section.
  expect(globalNavSections(sections).map((s) => s.section)).toEqual(['Reference', 'Project']);
  expect(globalNavSections(sections).map((s) => s.section)).toEqual(['Reference', 'Project']);
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

test('buildSidebarRows flattens the global section tree into heading and link rows', () => {
  const rows = buildSidebarRows(GENERATED_LIKE_SECTIONS, '/guide/api', 'en', ['en', 'zh']);
  expect(rows.map((row) => row.kind)).toEqual([
    'section',
    'link',
    'link',
    'link',
    'section',
    'link',
    'section',
    'link',
    'section',
    'link',
  ]);
  expect(rows[0].heading).toEqual('Guide');
  expect(rows[2].label).toEqual('Getting Started');
  // The active page is marked exactly once, on the exact-match link.
  expect(rows.filter((row) => row.current === 'page').map((row) => row.href)).toEqual([
    '/guide/api/',
  ]);
  // Heading rows carry no link affordance; link rows carry no heading.
  expect(rows[0].href).toBeNull();
  expect(rows[2].heading).toEqual('');
  // Row keys are unique and stable for the keyed Block.
  expect(new Set(rows.map((row) => row.key)).size).toEqual(rows.length);
});

test('buildSidebarRows localizes link targets and matches the localized current path', () => {
  const rows = buildSidebarRows(GENERATED_LIKE_SECTIONS, '/zh/guide/api', 'zh', ['en', 'zh']);
  const links = rows.filter((row) => row.kind === 'link');
  expect(links.every((row) => row.href !== false && row.href.startsWith('/zh/'))).toBeTruthy();
  expect(rows.filter((row) => row.current === 'page').map((row) => row.href)).toEqual([
    '/zh/guide/api/',
  ]);
});

test('buildSidebarRows keeps every global section while flattening', () => {
  const rows = buildSidebarRows(GENERATED_LIKE_SECTIONS, '/architecture/dsd', 'en', ['en', 'zh']);
  expect(rows.filter((row) => row.kind === 'section').map((row) => row.heading)).toEqual([
    'Guide',
    'Core',
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
  expect(evil?.href).toBeNull();
  expect(external?.href).toEqual('https://example.com/x');
  expect(external?.rel).toEqual('noopener noreferrer');
});

test('documentation navigation stays out of home, Blog and error recovery pages', () => {
  const locales = ['en', 'zh'];
  for (const path of [
    '/',
    '/zh',
    '/zh/',
    '/blog',
    '/zh/blog/',
    '/zh/blog/first-post/',
    '/404',
    '/zh/404/',
    '/zh/404.html',
  ]) {
    expect(showsDocumentationSidebar(path, locales), path).toBe(false);
  }
  for (const path of ['/docs/', '/zh/guide/getting-started/', '/blogger/']) {
    expect(showsDocumentationSidebar(path, locales), path).toBe(true);
  }
});

test('decorateHeaderNav distinguishes the active page from its active section', () => {
  const links = [
    { href: '/docs', label: 'Docs' },
    { href: '/blog', label: 'Blog', labelZh: '博客' },
    { href: 'https://github.com/open-element/openelement', label: 'GitHub' },
  ];
  expect(decorateHeaderNav(links, '/docs', 'en', ['en', 'zh']).map((link) => link.current)).toEqual(
    ['page', undefined, undefined],
  );
  expect(decorateHeaderNav(links, '/blog/first-post', 'en', ['en', 'zh'])[1].current).toBe(
    'location',
  );
  const zhNav = decorateHeaderNav(links, '/blog', 'zh', ['en', 'zh']);
  expect(zhNav.map((link) => link.current)).toEqual([undefined, 'page', undefined]);
  expect(zhNav[0].href).toEqual('/zh/docs/');
  expect(zhNav[1].href).toEqual('/zh/blog/');
  expect(zhNav[2].href).toEqual('https://github.com/open-element/openelement');
  expect(
    decorateHeaderNav(links, '/zh/blog/first-post/', 'zh', ['en', 'zh']).map(
      (link) => link.current,
    ),
  ).toEqual([undefined, 'location', undefined]);
  expect(decorateHeaderNav(links, '/blogger/', 'en', ['en', 'zh'])[1].current).toBeUndefined();
  for (const path of [
    '/guide/tutorial/',
    '/architecture',
    '/architecture/dsd',
    '/reference',
    '/errors',
  ]) {
    expect(decorateHeaderNav(links, path, 'en', ['en', 'zh'])[0].current, path).toBe('location');
  }
  expect(decorateHeaderNav(links, '/zh/guide/api/', 'zh', ['en', 'zh'])[0].current).toBe(
    'location',
  );
  expect(decorateHeaderNav(links, '/roadmap', 'en', ['en', 'zh'])[0].current).toBeUndefined();
});

test('footer Docs and Project link groups point to the localized core destinations', () => {
  for (const [locale, prefix] of [
    ['en', ''],
    ['zh', '/zh'],
  ]) {
    const docs = footerColumn(locale, ['en', 'zh'], 'docs');
    expect(docs.label).toBe(locale === 'zh' ? '文档' : 'Docs');
    expect(docs.links.map((link) => link.href)).toEqual(
      ['/docs/', '/guide/getting-started/', '/reference/', '/errors/'].map((path) => prefix + path),
    );
    const project = footerColumn(locale, ['en', 'zh'], 'project');
    expect(project.label).toBe(locale === 'zh' ? '项目' : 'Project');
    expect(project.links.map((link) => link.href)).toEqual(
      ['/blog/', '/changelog/', '/contributing/', '/roadmap/'].map((path) => prefix + path),
    );
  }
});

test('layoutChromeStrings carries the bilingual shell chrome copy', () => {
  expect(layoutChromeStrings('en').sidebarLabel).toEqual('Documentation navigation');
  expect(layoutChromeStrings('zh').sidebarLabel).toEqual('文档导航');
  expect(layoutChromeStrings('en').sidebarToggle).toEqual('Browse documentation');
  expect(layoutChromeStrings('zh').sidebarToggle).toEqual('浏览文档');
  expect(layoutChromeStrings('en').footerLicense).toEqual('MIT License');
  expect(layoutChromeStrings('zh').footerLicense).toEqual('MIT 许可证');
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
    { href: '/changelog', label: 'Releases' },
  ];
  expect(decorateHeaderNav(links, '/docs', 'zh', ['en', 'zh']).map((link) => link.label)).toEqual([
    '文档',
    'Releases', // no labelZh: falls back to the English label
  ]);
  expect(decorateHeaderNav(links, '/docs', 'en', ['en', 'zh']).map((link) => link.label)).toEqual([
    'Docs',
    'Releases',
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
