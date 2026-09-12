import type { PageHead } from '@openelement/app';
import { prepareArticle } from './article-body.ts';
import { siteHead } from './head.ts';
import { contentLocale } from './locale.ts';
import { localizePath } from './link.ts';
import { getPage as getGuidePage, pages as guidePages } from '../data/_generated-guide-data.ts';
import {
  getPage as getArchitecturePage,
  pages as architecturePages,
} from '../data/_generated-architecture-data.ts';
import { OPENELEMENT_VERSION } from '../data/version.ts';

export type ArticleCollection = 'guide' | 'architecture';

export interface ArticlePageModel {
  notFoundClass: string;
  articleClass: string;
  slug: string;
  notFoundMessage: string;
  metadata: { breadcrumb: string; title: string; lede: string };
  navigation: {
    previous?: { href: string; label: string };
    next?: { href: string; label: string };
  };
  railItems: Array<{ id: string; href: string; label: string; depth: string }>;
  articleHtml: string;
}

const collectionShell = {
  guide: { breadcrumb: { en: 'Guide', zh: '指南' }, basePath: '/guide' },
  architecture: { breadcrumb: { en: 'Architecture', zh: '架构' }, basePath: '/architecture' },
} as const;

const collectionData = {
  guide: { pages: guidePages, getPage: getGuidePage },
  architecture: { pages: architecturePages, getPage: getArchitecturePage },
};

export function emptyArticlePageModel(): ArticlePageModel {
  return {
    notFoundClass: 'container',
    articleClass: 'is-hidden',
    slug: '',
    notFoundMessage: '',
    metadata: { breadcrumb: '', title: '', lede: '' },
    navigation: {},
    railItems: [],
    articleHtml: '',
  };
}

/**
 * Content-route head (Beta.2.2, #1327): the route modules declare their head
 * as a resolver reading the same generated collection truth the body model
 * projects — title and lede come from the render-locale frontmatter, with the
 * English original as the fallback, exactly like the article body.
 */
export function articlePageHead(
  collection: ArticleCollection,
  slug: string,
  localeInput: string | undefined,
): PageHead {
  const locale = contentLocale(localeInput ?? 'en');
  const shell = collectionShell[collection];
  const data = collectionData[collection];
  const page = data.getPage(slug, locale) ?? data.getPage(slug, 'en');
  return siteHead({
    route: `${shell.basePath}/${slug}`,
    locale,
    title: page?.frontmatter.title ?? slug,
    description: page?.frontmatter.lede ?? '',
  });
}

export function projectArticlePage(
  collection: ArticleCollection,
  slug: string,
  localeInput: string | undefined,
): ArticlePageModel {
  const locale = contentLocale(localeInput ?? 'en');
  const shell = collectionShell[collection];
  const data = collectionData[collection];
  const page = data.getPage(slug, locale) ?? data.getPage(slug, 'en');
  if (!page) {
    return {
      ...emptyArticlePageModel(),
      slug,
      notFoundMessage: locale === 'en' ? 'Page not found' : '未找到页面',
    };
  }

  const article = prepareArticle(
    page.html.replaceAll('{{OPENELEMENT_VERSION}}', OPENELEMENT_VERSION),
  );
  const ordered = data.pages
    .filter((candidate) => candidate.locale === 'en')
    .sort((a, b) => a.frontmatter.order - b.frontmatter.order);
  const index = ordered.findIndex((candidate) => candidate.slug === slug);
  const previous = index > 0 ? ordered[index - 1] : undefined;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : undefined;
  const localizedTitle = (targetSlug: string): string =>
    (data.getPage(targetSlug, locale) ?? data.getPage(targetSlug, 'en'))?.frontmatter.title ??
      targetSlug;
  const navigationItem = (candidate: typeof previous) =>
    candidate
      ? {
        href: localizePath(`${shell.basePath}/${candidate.slug}`, locale),
        label: localizedTitle(candidate.slug),
      }
      : undefined;

  return {
    notFoundClass: 'container is-hidden',
    articleClass: '',
    slug,
    notFoundMessage: '',
    metadata: {
      breadcrumb: shell.breadcrumb[locale],
      title: page.frontmatter.title,
      lede: page.frontmatter.lede ?? '',
    },
    navigation: {
      previous: navigationItem(previous),
      next: navigationItem(next),
    },
    railItems: article.outline.map((item) => ({
      id: item.id,
      href: `#${item.id}`,
      label: item.label,
      depth: String(item.level ?? 2),
    })),
    articleHtml: article.html,
  };
}
