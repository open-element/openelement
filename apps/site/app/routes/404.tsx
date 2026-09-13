import { definePage } from '@openelement/router';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { localizePath } from '@openelement/site-ui/link.ts';
import Page404 from '../components/page-404.tsx';

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
  },
  zh: {
    headTitle: '404 — 页面未找到',
    headDescription: '请求的 openElement 页面不存在。返回文档或首页继续浏览。',
    serifLine: '迷失在 shadow DOM 里。',
    lede: '这个路由从未被挂载。你要找的页面，也许只差一个 declarative template。',
    backHome: '回到首页',
    readDocs: '阅读文档',
  },
} as const;

export default definePage(Page404, {
  // Error document: og fields but deliberately no canonical/hreflang — the
  // page is not indexable and stays out of the sitemap.
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
    return {
      serifLine: text.serifLine,
      lede: text.lede,
      backHome: text.backHome,
      readDocs: text.readDocs,
      homeHref: localizePath('/', resolved),
      docsHref: localizePath('/docs', resolved),
      marqueeText: marquee + marquee,
    };
  },
});
