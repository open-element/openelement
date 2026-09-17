import { assert, assertEquals, assertFalse } from '@std/assert';
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
} from '../app/site-ui/open-layout-navigation.ts';

Deno.test('open-layout navigation rejects executable and protocol-relative URLs', () => {
  assert(isSafeLayoutUrl('/guide'));
  assert(isSafeLayoutUrl('https://github.com/open-element'));
  assertFalse(isSafeLayoutUrl('javascript:alert(1)'));
  assertFalse(isSafeLayoutUrl('//attacker.example/path'));
  assert(isExternalLayoutUrl('https://github.com/open-element'));
  assertFalse(isExternalLayoutUrl('/guide'));
});

Deno.test('open-layout navigation localizes and switches canonical paths', () => {
  assertEquals(localizeLayoutPath('/guide', 'zh', ['en', 'zh'], 'en'), '/zh/guide');
  assertEquals(localizeLayoutPath('/guide', 'en', ['en', 'zh'], 'en'), '/guide');
  assertEquals(localeSwitchPath('/zh/guide', 'zh', ['en', 'zh'], 'en'), '/guide');
  assertEquals(localeSwitchLabel('en'), '中文');
});

Deno.test('localeSwitchPath degrades unresolved route params to the static ancestor', () => {
  // A pattern path must never put a literal ":slug" into the switcher href.
  assertEquals(localeSwitchPath('/blog/:slug', 'en', ['en', 'zh'], 'en'), '/zh/blog');
  assertEquals(localeSwitchPath('/zh/blog/:slug', 'zh', ['en', 'zh'], 'en'), '/blog');
  // A leading param collapses to the locale home.
  assertEquals(localeSwitchPath('/:slug', 'en', ['en', 'zh'], 'en'), '/zh');
  assertEquals(localeSwitchScopeNote('zh'), 'Switch to English');
});

Deno.test('open-layout navigation filters only the active section family', () => {
  const sections = [
    { section: 'Quick Start', items: [] },
    { section: 'Guide', items: [] },
    { section: 'Core', items: [] },
    { section: 'Principles', items: [] },
    { section: 'Reference', items: [] },
    { section: 'History', items: [] },
  ];
  // Guide pages see the full guide tree (14 pages must stay reachable).
  assertEquals(filterNavSections(sections, '/guide/api'), [sections[0], sections[1], sections[2]]);
  assertEquals(filterNavSections(sections, '/architecture/dsd'), [sections[3], sections[4]]);
  assertEquals(filterNavSections(sections, '/blog'), [sections[5]]);
  assertEquals(mobileSectionRoot('/zh/guide/api', ['en', 'zh']), '/guide');
});

Deno.test('open-layout navigation labels the nameless generated group as Project', () => {
  const sections = [
    { section: 'History', items: [] },
    { section: 'Project', items: [{ label: 'Roadmap', path: '/roadmap' }] },
    { section: 'Reference', items: [] },
  ];
  const generated = [
    { section: 'History', items: [] as never[] },
    { section: '', items: [{ label: 'Roadmap', path: '/roadmap' }] },
    { section: 'Reference', items: [] as never[] },
  ];
  // Unfiltered paths keep every group, with the empty one renamed.
  assertEquals(filterNavSections(generated, '/docs').map((s) => s.section), [
    'History',
    'Project',
    'Reference',
  ]);
  assertEquals(filterNavSections(sections, '/roadmap').map((s) => s.section), [
    'History',
    'Project',
  ]);
  assertEquals(filterNavSections(sections, '/blog').map((s) => s.section), ['History']);
  assertEquals(filterNavSections(sections, '/apilist').map((s) => s.section), ['Reference']);
});

const GENERATED_LIKE_SECTIONS = [
  { section: 'Quick Start', items: [{ path: '/docs', label: 'Docs' }] },
  {
    section: 'Guide',
    items: [
      { path: '/guide/getting-started', label: 'Getting Started' },
      { path: '/guide/api', label: 'API Routes' },
    ],
  },
  { section: 'Core', items: [{ path: '/guide/deployment', label: 'Deployment' }] },
  { section: 'Principles', items: [{ path: '/architecture/dsd', label: 'DSD Rendering' }] },
  { section: 'Reference', items: [{ path: '/apilist', label: 'API Reference' }] },
];

Deno.test('buildSidebarRows flattens the filtered section tree into heading and link rows', () => {
  const rows = buildSidebarRows(GENERATED_LIKE_SECTIONS, '/guide/api', 'en', ['en', 'zh']);
  assertEquals(rows.map((row) => row.kind), [
    'section',
    'link',
    'section',
    'link',
    'link',
    'section',
    'link',
  ]);
  assertEquals(rows[0].heading, 'Quick Start');
  assertEquals(rows[3].label, 'Getting Started');
  // The active page is marked exactly once, on the exact-match link.
  assertEquals(rows.filter((row) => row.current === 'page').map((row) => row.href), ['/guide/api']);
  // Heading rows carry no link affordance; link rows carry no heading.
  assertEquals(rows[0].href, false);
  assertEquals(rows[3].heading, '');
  // Row keys are unique and stable for the keyed Region.
  assertEquals(new Set(rows.map((row) => row.key)).size, rows.length);
});

Deno.test('buildSidebarRows localizes link targets and matches the localized current path', () => {
  const rows = buildSidebarRows(GENERATED_LIKE_SECTIONS, '/zh/guide/api', 'zh', ['en', 'zh']);
  const links = rows.filter((row) => row.kind === 'link');
  assert(links.every((row) => row.href !== false && row.href.startsWith('/zh/')));
  assertEquals(rows.filter((row) => row.current === 'page').map((row) => row.href), [
    '/zh/guide/api',
  ]);
});

Deno.test('buildSidebarRows filters to the active section family before flattening', () => {
  const rows = buildSidebarRows(GENERATED_LIKE_SECTIONS, '/architecture/dsd', 'en', ['en', 'zh']);
  assertEquals(
    rows.filter((row) => row.kind === 'section').map((row) => row.heading),
    ['Principles', 'Reference'],
  );
});

Deno.test('buildSidebarRows guards unsafe hrefs and marks external links', () => {
  const rows = buildSidebarRows(
    [{
      section: 'Guide',
      items: [
        { href: 'javascript:alert(1)', label: 'Evil' },
        { href: 'https://example.com/x', label: 'External' },
      ],
    }],
    '/guide',
    'en',
    ['en', 'zh'],
  );
  const evil = rows.find((row) => row.label === 'Evil');
  const external = rows.find((row) => row.label === 'External');
  assertEquals(evil?.href, false);
  assertEquals(external?.href, 'https://example.com/x');
  assertEquals(external?.rel, 'noopener noreferrer');
});

Deno.test('decorateHeaderNav marks the current section and never external links', () => {
  const links = [
    { href: '/docs', label: 'Docs' },
    { href: '/blog', label: 'Blog' },
    { href: 'https://github.com/open-element/openelement', label: 'GitHub' },
  ];
  assertEquals(decorateHeaderNav(links, '/docs', 'en', ['en', 'zh']).map((link) => link.current), [
    'page',
    false,
    false,
  ]);
  // Section roots stay current on nested routes (blog posts keep Blog current).
  assertEquals(
    decorateHeaderNav(links, '/blog/1-0-0-alpha-1-baseline', 'en', ['en', 'zh'])[1].current,
    'page',
  );
  // Router 1.0 does not pre-localize shell nav; the Site builder localizes
  // bare hrefs, and current marking must still land for non-default locales.
  const zhNav = decorateHeaderNav(links, '/blog', 'zh', ['en', 'zh']);
  assertEquals(zhNav.map((link) => link.current), [false, 'page', false]);
  assertEquals(zhNav[0].href, '/zh/docs');
  assertEquals(zhNav[2].href, 'https://github.com/open-element/openelement');
  // A locale-prefixed request-time path normalizes to the same result.
  assertEquals(
    decorateHeaderNav(links, '/zh/blog', 'zh', ['en', 'zh']).map((link) => link.current),
    [false, 'page', false],
  );
});

Deno.test('footerColumn restores the four-column link structure with localized targets', () => {
  const product = footerColumn('en', ['en', 'zh'], 'product');
  assertEquals(product.label, 'Product');
  assertEquals(
    product.links.map((link) => link.href),
    [
      '/guide/core-concepts',
      '/architecture/design-system',
      '/architecture/architecture',
      '/architecture/standards-registry',
    ],
  );
  const zhProduct = footerColumn('zh', ['en', 'zh'], 'product');
  assertEquals(zhProduct.label, '产品');
  assert(zhProduct.links.every((link) => link.href.startsWith('/zh/')));
  const company = footerColumn('en', ['en', 'zh'], 'company');
  const github = company.links.find((link) => link.label === 'GitHub');
  assertEquals(github?.href, 'https://github.com/open-element/openelement');
  assertEquals(github?.rel, 'noopener noreferrer');
  const legal = footerColumn('zh', ['en', 'zh'], 'legal');
  assertEquals(legal.label, '法律');
  assertEquals(legal.links.map((link) => link.label), ['MIT 许可证', '参与贡献']);
});

Deno.test('layoutChromeStrings carries the bilingual shell chrome copy', () => {
  assertEquals(layoutChromeStrings('en').sidebarLabel, 'Documentation navigation');
  assertEquals(layoutChromeStrings('zh').sidebarLabel, '文档导航');
  assertEquals(layoutChromeStrings('en').sidebarToggle, 'Documentation');
  assertEquals(layoutChromeStrings('zh').sidebarToggle, '文档');
  assertEquals(typeof layoutChromeStrings('zh').footerTagline, 'string');
  // Skip link and header chrome; the English literals are e2e landmark pins.
  assertEquals(layoutChromeStrings('en').skipToMain, 'Skip to main content');
  assertEquals(layoutChromeStrings('zh').skipToMain, '跳到主要内容');
  assertEquals(layoutChromeStrings('en').menuOpen, 'Open navigation');
  assertEquals(layoutChromeStrings('zh').menuOpen, '打开导航');
  assertEquals(layoutChromeStrings('en').primaryNavLabel, 'Primary navigation');
  assertEquals(layoutChromeStrings('zh').primaryNavLabel, '主导航');
  assertEquals(layoutChromeStrings('en').mobileNavLabel, 'Mobile navigation');
  assertEquals(layoutChromeStrings('zh').mobileNavLabel, '移动端导航');
});

Deno.test('readingChromeStrings carries the bilingual reading chrome copy', () => {
  // The English literals are e2e landmark pins ('On this page' complementary).
  assertEquals(readingChromeStrings('en'), {
    onThisPage: 'On this page',
    overview: 'Overview',
    pageNavigation: 'Page navigation',
  });
  assertEquals(readingChromeStrings('zh'), {
    onThisPage: '本页目录',
    overview: '概览',
    pageNavigation: '页面导航',
  });
});

Deno.test('decorateHeaderNav projects zh labels and keeps the en default', () => {
  const links = [
    { href: '/docs', label: 'Docs', labelZh: '文档' },
    { href: '/blog', label: 'Blog' },
  ];
  assertEquals(decorateHeaderNav(links, '/docs', 'zh', ['en', 'zh']).map((link) => link.label), [
    '文档',
    'Blog', // no labelZh: falls back to the English label
  ]);
  assertEquals(decorateHeaderNav(links, '/docs', 'en', ['en', 'zh']).map((link) => link.label), [
    'Docs',
    'Blog',
  ]);
});

Deno.test('buildSidebarRows projects zh item labels and section headings', () => {
  const sections = [{
    section: 'Guide',
    sectionZh: '指南',
    items: [
      { path: '/guide/getting-started', label: 'Getting Started', labelZh: '快速开始' },
      { path: '/guide/api', label: 'API Routes', labelZh: 'API 路由' },
    ],
  }];
  const zhRows = buildSidebarRows(sections, '/zh/guide/api', 'zh', ['en', 'zh']);
  assertEquals(zhRows[0].heading, '指南');
  assertEquals(
    zhRows.filter((row) => row.kind === 'link').map((row) => row.label),
    ['快速开始', 'API 路由'],
  );
  assertEquals(zhRows.find((row) => row.current === 'page')?.label, 'API 路由');
  const enRows = buildSidebarRows(sections, '/guide/api', 'en', ['en', 'zh']);
  assertEquals(enRows[0].heading, 'Guide');
  assertEquals(enRows[1].label, 'Getting Started');
});
