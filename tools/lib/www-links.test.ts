/** Built-output link/fragment/SEO checker unit tests (#1159). */
import { assertEquals } from '@std/assert';
import {
  anchorsFragment,
  extractBuiltLinks,
  findCrossPageSeoFailures,
  findSeoFailures,
  pageSeo,
  resolveBuiltPath,
} from './www-links.ts';

Deno.test('extractBuiltLinks: keeps internal targets, skips external/protocol/fragment-only', () => {
  const links = extractBuiltLinks(
    'index.html',
    [
      '<a href="/guide/getting-started">x</a>',
      '<a href="/guide/api#signals">y</a>',
      '<a href="#top">z</a>',
      '<a href="https://example.com">e</a>',
      '<a href="mailto:a@b.c">m</a>',
      '<a href="//cdn.example.com/x.js">p</a>',
      '<script src="/assets/app.js"></script>',
      '<img src="data:image/png;base64,xx">',
    ].join('\n'),
  );
  assertEquals(links.map((link) => [link.path, link.fragment]), [
    ['/guide/getting-started', ''],
    ['/guide/api', 'signals'],
    ['', 'top'],
    ['/assets/app.js', ''],
  ]);
});

Deno.test('resolveBuiltPath: routes, files and assets', () => {
  const files = new Set([
    'index.html',
    'guide/getting-started/index.html',
    'assets/app.js',
    '404.html',
  ]);
  const exists = (file: string) => files.has(file);
  assertEquals(resolveBuiltPath('/', exists), 'index.html');
  assertEquals(
    resolveBuiltPath('/guide/getting-started', exists),
    'guide/getting-started/index.html',
  );
  assertEquals(
    resolveBuiltPath('/guide/getting-started/', exists),
    'guide/getting-started/index.html',
  );
  assertEquals(resolveBuiltPath('/assets/app.js', exists), 'assets/app.js');
  assertEquals(resolveBuiltPath('/404', exists), '404.html');
  assertEquals(resolveBuiltPath('/nope', exists), null);
  assertEquals(resolveBuiltPath('/assets/missing.js', exists), null);
});

Deno.test('anchorsFragment: id and name anchor the fragment', () => {
  const html = '<section id="signals"></section><a name="legacy"></a>';
  assertEquals(anchorsFragment(html, 'signals'), true);
  assertEquals(anchorsFragment(html, 'legacy'), true);
  assertEquals(anchorsFragment(html, 'missing'), false);
});

Deno.test('findSeoFailures: title/description/og:title/canonical/hreflang invariants (#1307)', () => {
  // Link attribute order matches the framework serializer (#1326): rel, href,
  // then hreflang. The checker is order-tolerant; the fixture tracks the
  // single writer's real output.
  const good = '<head><title>Home — openElement</title>' +
    '<meta name="description" content="A sufficiently long description."/>' +
    '<meta property="og:title" content="Home — openElement"/>' +
    '<link rel="canonical" href="https://openelement.org/">' +
    '<link rel="alternate" href="https://openelement.org/" hreflang="en">' +
    '<link rel="alternate" href="https://openelement.org/zh" hreflang="zh">' +
    '</head>';
  assertEquals(findSeoFailures(good, 'index.html'), []);
  // 404 documents carry no canonical/hreflang by design.
  const bare404 = '<head><title>404 — Page not found — openElement</title>' +
    '<meta name="description" content="A sufficiently long description."/>' +
    '<meta property="og:title" content="404"/></head>';
  assertEquals(findSeoFailures(bare404, '404.html'), []);
  assertEquals(findSeoFailures(bare404, 'zh/404/index.html'), []);
  const failures = findSeoFailures('<head></head>', 'index.html');
  assertEquals(failures.length, 7);
  assertEquals(
    findSeoFailures('<title>a</title><title>b</title>' + good, 'index.html')[0].message
      .includes('exactly one <title>'),
    true,
  );
  // The boilerplate bare-brand title is a failure even when present once.
  const boilerplate = good.replace(
    '<title>Home — openElement</title>',
    '<title>openElement</title>',
  );
  assertEquals(
    findSeoFailures(boilerplate, 'index.html').some((f) => f.message.includes('boilerplate')),
    true,
  );
  // A non-404 page without canonical/hreflang fails.
  const noLinks = '<head><title>Home — openElement</title>' +
    '<meta name="description" content="A sufficiently long description."/>' +
    '<meta property="og:title" content="t"/></head>';
  assertEquals(findSeoFailures(noLinks, 'apilist/index.html').length, 3);
});

Deno.test('findCrossPageSeoFailures: per-locale title uniqueness', () => {
  const pages = [
    { file: 'index.html', title: 'Home — openElement', description: 'x'.repeat(24), locale: 'en' },
    { file: 'zh/index.html', title: '首页 — openElement', description: '中文描述。', locale: 'zh' },
    {
      file: 'apilist/index.html',
      title: 'API — openElement',
      description: 'x'.repeat(24),
      locale: 'en',
    },
  ];
  assertEquals(findCrossPageSeoFailures(pages), []);
  const duplicated = [...pages, {
    file: 'other/index.html',
    title: 'Home — openElement',
    description: 'y'.repeat(24),
    locale: 'en',
  }];
  assertEquals(findCrossPageSeoFailures(duplicated).length, 1);
  // The same title across DIFFERENT locales is fine (original-language posts).
  const crossLocale = [...pages, {
    file: 'zh/blog/post/index.html',
    title: 'API — openElement',
    description: 'Original-language excerpt.',
    locale: 'zh',
  }];
  assertEquals(findCrossPageSeoFailures(crossLocale), []);
});

Deno.test('pageSeo extracts title/description and resolves locale from path', () => {
  const html = '<head><title>T — openElement</title>' +
    '<meta name="description" content="D for the page, long enough."/></head>';
  assertEquals(pageSeo(html, 'zh/apilist/index.html', ['en', 'zh']), {
    file: 'zh/apilist/index.html',
    title: 'T — openElement',
    description: 'D for the page, long enough.',
    locale: 'zh',
  });
  assertEquals(pageSeo(html, 'apilist/index.html', ['en', 'zh']).locale, 'en');
});
