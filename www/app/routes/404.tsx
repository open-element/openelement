import { definePage } from '@openelement/router';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { localizePath } from '@openelement/site-ui/link.ts';
import redirectTableJson from '../../../tools/repo/site-redirects.json' with { type: 'json' };
import Page404 from '../components/page-404.tsx';

const redirectTable = redirectTableJson as {
  redirects: Array<{ from: string; to: string; toZh?: string; status: number }>;
};

/**
 * "You may be looking for" suggestions derived from the retired-URL table
 * (same data as _redirects), minus anything the curated popular list
 * already covers. A stale 404 that a cache lands on still heals itself.
 * The zh target honors toZh: translated heading ids differ per locale.
 */
function redirectSuggestions(locale: 'en' | 'zh', popularHrefs: Set<string>) {
  const seen = new Set<string>();
  const suggestions: Array<{ label: string; href: string }> = [];
  for (const mapping of redirectTable.redirects) {
    const raw = locale === 'zh' ? mapping.toZh ?? mapping.to : mapping.to;
    const hash = raw.indexOf('#');
    const toPath = hash < 0 ? raw : raw.slice(0, hash);
    const fragment = hash < 0 ? '' : raw.slice(hash);
    const href = localizePath(toPath, locale) + fragment;
    if (popularHrefs.has(href) || seen.has(href)) continue;
    seen.add(href);
    suggestions.push({ label: href, href });
  }
  return suggestions;
}

const marquee =
  'CUSTOM ELEMENTS ✳ SHADOW DOM ✳ DECLARATIVE SHADOW DOM ✳ ES MODULES ✳ SIGNALS ✳ HTML FIRST ✳ 404 ✳ ';

const content = {
  en: {
    headTitle: '404 — Page not found',
    headDescription:
      'The requested openElement page does not exist. Head back to the documentation or the homepage.',
    serifLine: 'Lost in the shadow DOM.',
    lede: 'This route never mounted. The page you want is probably one declarative template away.',
    backHome: 'Back home',
    readDocs: 'Read the docs',
    searchHint: 'Tip: press ⌘K (Ctrl+K) to search the whole site',
    popularLabel: 'Popular right now',
    suggestionsLabel: 'You may be looking for',
    popular: [
      ['Get started', '/guide/getting-started'],
      ['Tutorial', '/guide/tutorial'],
      ['API reference', '/reference'],
      ['Architecture', '/architecture'],
    ],
  },
  zh: {
    headTitle: '404 — 页面未找到',
    headDescription: '请求的 openElement 页面不存在。返回文档或首页继续浏览。',
    serifLine: '迷失在 shadow DOM 里。',
    lede: '这个路由从未被挂载。你要找的页面，也许只差一个 declarative template。',
    backHome: '回到首页',
    readDocs: '阅读文档',
    searchHint: '小提示：按 ⌘K（Ctrl+K）全站搜索',
    popularLabel: '热门直达',
    suggestionsLabel: '你可能在找',
    popular: [
      ['快速开始', '/guide/getting-started'],
      ['教程', '/guide/tutorial'],
      ['API 参考', '/reference'],
      ['架构', '/architecture'],
    ],
  },
} as const;

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
      href: localizePath(href, resolved),
    }));
    return {
      serifLine: text.serifLine,
      lede: text.lede,
      backHome: text.backHome,
      readDocs: text.readDocs,
      searchHint: text.searchHint,
      popularLabel: text.popularLabel,
      popular,
      suggestionsLabel: text.suggestionsLabel,
      suggestions: redirectSuggestions(resolved, new Set(popular.map((link) => link.href))),
      homeHref: localizePath('/', resolved),
      docsHref: localizePath('/docs', resolved),
      marqueeText: marquee + marquee,
    };
  },
});
