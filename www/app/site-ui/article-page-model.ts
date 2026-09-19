import type { PageHead } from '@openelement/router';
import { prepareArticle } from './article-body.ts';
import { siteHead } from './head.ts';
import { contentLocale } from './locale.ts';
import { localizePath } from './link.ts';
import type { ReadingMetadata } from './page-contract.ts';
import { getPage as getGuidePage, pages as guidePages } from '../data/_generated-guide-data.ts';
import {
  getPage as getArchitecturePage,
  pages as architecturePages,
} from '../data/_generated-architecture-data.ts';
import { contentMeta } from '../data/_generated-content-meta.ts';
import { sourceLineAppliesLabel, sourceLineNote, sourceLineStamp } from '../data/version.ts';

export type ArticleCollection = 'guide' | 'architecture';

export interface ArticlePageModel {
  notFoundClass: string;
  articleClass: string;
  slug: string;
  notFoundMessage: string;
  // The contract type is the single source (page-contract.ts); lede stays
  // required here because projectArticlePage always projects one.
  metadata: ReadingMetadata & { lede: string };
  navigation: {
    previous?: { href: string; label: string };
    next?: { href: string; label: string };
  };
  railItems: Array<{ id: string; href: string; label: string; depth: string }>;
  articleHtml: string;
}

const collectionShell = {
  // The guide breadcrumb names its landing page (/docs, the Docs hub —
  // headerNav agrees), not the /guide URL prefix.
  guide: { breadcrumb: { en: 'Docs', zh: '文档' }, basePath: '/guide', root: '/docs' },
  architecture: {
    breadcrumb: { en: 'Architecture', zh: '架构' },
    basePath: '/architecture',
    root: '/architecture',
  },
} as const;

const collectionData = {
  guide: { pages: guidePages, getPage: getGuidePage },
  architecture: { pages: architecturePages, getPage: getArchitecturePage },
};

/**
 * The route path serving an article: the collection overview article lives at
 * the collection root (`/architecture`, `/docs` — the shell root, not the
 * article basePath, so a future guide overview can never canonicalize to the
 * 404ing `/guide`), every other article at `basePath/slug`. One home for the
 * mapping so head canonicals and the pager can never point at a renamed-away
 * URL.
 */
export function articleRoutePath(collection: ArticleCollection, slug: string): string {
  const shell = collectionShell[collection];
  return slug === collection ? shell.root : `${shell.basePath}/${slug}`;
}

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
  const data = collectionData[collection];
  const page = data.getPage(slug, locale) ?? data.getPage(slug, 'en');
  return siteHead({
    route: articleRoutePath(collection, slug),
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
    // Version wording derives from release-state truth (data/version.ts):
    // stamps read "repository baseline" until the source line is published
    // to @alpha for every package, then rewrite themselves on the next build.
    page.html
      .replaceAll('{{OPENELEMENT_VERSION}}', sourceLineAppliesLabel(locale))
      .replaceAll('{{SOURCE_LINE_NOTE}}', sourceLineNote(locale)),
    locale,
    // The reading shell owns <span id="start"> (open-reading-shell.tsx):
    // keep the allocator from handing that id to a "Start" heading.
    ['start'],
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
        href: localizePath(articleRoutePath(collection, candidate.slug), locale),
        label: localizedTitle(candidate.slug),
      }
      : undefined;
  // Machine-derived freshness: the render locale's source-file stamp
  // from generated content meta. The 'uncommitted' sentinel hides the row
  // instead of showing a date that differs per machine.
  const stamp = contentMeta[`${collection}/${slug}`]?.[locale] ?? '';

  return {
    notFoundClass: 'container is-hidden',
    articleClass: '',
    slug,
    notFoundMessage: '',
    metadata: {
      breadcrumb: shell.breadcrumb[locale],
      breadcrumbHref: localizePath(shell.root, locale),
      title: page.frontmatter.title,
      lede: page.frontmatter.lede ?? '',
      // The version mark is the source-line stamp (never the bare
      // constant — version.ts:1-3 forbids claiming a published line while
      // SOURCE_LINE_PUBLISHED is false).
      updated: stamp === 'uncommitted' ? '' : stamp,
      version: sourceLineStamp(locale),
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
