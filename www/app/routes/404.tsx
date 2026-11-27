import { definePage } from '@openelement/router';
import '@openelement/ui/open-button';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { siteHref } from '#site-ui/site-url.ts';
import { headerNav, navSections } from '../data/_generated-nav-data.ts';
const content = {
  en: {
    headTitle: '404 — Page not found',
    headDescription:
      'The requested openElement page does not exist. Head back to the documentation or the homepage.',
    title: 'Page not found',
    lede: 'This link may be out of date, or the page may have moved.',
    backHome: 'Back home',
    readDocs: 'Read the docs',
    search: 'Search the docs',
    suggestion: 'Did you mean',
    suggestionEnd: '?',
    popularLabel: 'Useful links',
    popular: [
      ['Get started', '/guide/getting-started'],
      ['API reference', '/reference'],
    ],
  },
  zh: {
    headTitle: '404 — 页面未找到',
    headDescription: '请求的 openElement 页面不存在。返回文档或首页继续浏览。',
    title: '页面未找到',
    lede: '链接可能已失效，或者页面已移到其他位置。',
    backHome: '回到首页',
    readDocs: '阅读文档',
    search: '搜索文档',
    suggestion: '你是否要访问',
    suggestionEnd: '？',
    popularLabel: '常用链接',
    popular: [
      ['快速开始', '/guide/getting-started'],
      ['API 参考', '/reference'],
    ],
  },
} as const;

/**
 * The 404 page as a server function component (alpha15 server architecture):
 * the route module's own exported TSX function, lowered by the compiler into
 * a generative HTML constructor. The page hook class (`page-404`) scopes the
 * former component sheet's authored rules in the linked document stylesheet.
 */
export function Page404(props: {
  title: string;
  lede: string;
  backHome: string;
  readDocs: string;
  search: string;
  suggestion: string;
  suggestionEnd: string;
  suggestions: Array<{ href: string; label: string }>;
  popularLabel: string;
  popular: Array<{ href: string; label: string }>;
  homeHref: string;
  docsHref: string;
}) {
  return (
    <div class='page-404 bg-background text-foreground' data-pagefind-ignore>
      <section class='stage relative isolate grid min-h-[min(36rem,calc(100svh-var(--nav-height)))] content-center justify-items-center gap-3 px-6 py-8 text-center min-[601px]:min-h-[calc(100svh-var(--nav-height)-calc(var(--spacing)*12))] min-[601px]:gap-5 min-[601px]:py-[clamp(3rem,8vh,6rem)]'>
        <p
          class='code m-0 flex font-mono text-[clamp(6rem,24vw,9rem)] leading-[0.9] font-extrabold tracking-[-0.06em] text-transparent select-none min-[601px]:text-[clamp(9rem,26vw,24rem)]'
          aria-hidden='true'
        >
          <span aria-hidden='true'>4</span>
          <span class='solid text-foreground' aria-hidden='true'>
            {'0'}
          </span>
          <span aria-hidden='true'>4</span>
        </p>
        <h1 class='serif-line m-0 font-serif text-[clamp(2rem,5vw,4rem)] font-normal italic tracking-[-0.01em] text-primary'>
          {props.title}
        </h1>
        <p class='lede m-0 max-w-[34rem] font-mono text-sm leading-[1.75] text-muted-foreground'>
          {props.lede}
        </p>
        <p class='m-0 text-sm text-muted-foreground' data-not-found-suggestion hidden>
          {props.suggestion}{' '}
          <a class='inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4'></a>
          {props.suggestionEnd}
        </p>
        <template data-not-found-candidates>
          {props.suggestions.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </template>
        <div class='mt-3 flex flex-wrap justify-center gap-3'>
          <open-button variant='primary' href={props.homeHref}>
            {props.backHome}
          </open-button>
          <open-button href={props.docsHref}>{props.readDocs}</open-button>
        </div>
        <button
          class='min-h-11 cursor-pointer rounded-sm border-0 bg-transparent px-3 text-sm text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2'
          type='button'
          aria-haspopup='dialog'
          data-search-recovery
          hidden
        >
          {props.search}
        </button>
        <nav
          class='popular mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-0'
          aria-labelledby='popular-heading'
        >
          <p
            class='popular-label m-0 font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase'
            id='popular-heading'
          >
            {props.popularLabel}
          </p>
          {props.popular.map((link) => (
            <a
              class='inline-flex min-h-11 items-center font-mono text-sm text-muted-foreground underline underline-offset-4 hover:text-primary'
              key={link.href}
              href={link.href}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </section>
    </div>
  );
}

export default definePage(Page404, {
  // Error document: og fields plus the siteHead robots noindex, and
  // deliberately no canonical/hreflang — the page is not indexable and stays
  // out of the sitemap.
  head({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const copy = content[resolved];
    return siteHead({
      route: '/404',
      locale: resolved,
      title: copy.headTitle,
      description: copy.headDescription,
      error: true,
    });
  },
  props({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const text = content[resolved];
    const popular = text.popular.map(([label, href]) => ({
      label,
      href: siteHref(href, resolved),
    }));
    const suggestions = [
      ...headerNav.map(({ href, label, labelZh }) => ({ path: href, label, labelZh })),
      ...navSections.flatMap(({ items }) => items),
    ].flatMap(({ path, label, labelZh }) =>
      path?.startsWith('/') && !path.startsWith('//')
        ? [
            {
              href: siteHref(path, resolved),
              label: resolved === 'zh' ? (labelZh ?? label) : label,
            },
          ]
        : [],
    );
    return {
      title: text.title,
      lede: text.lede,
      backHome: text.backHome,
      readDocs: text.readDocs,
      search: text.search,
      suggestion: text.suggestion,
      suggestionEnd: text.suggestionEnd,
      suggestions,
      popularLabel: text.popularLabel,
      popular,
      homeHref: siteHref('/', resolved),
      docsHref: siteHref('/docs', resolved),
    };
  },
});
