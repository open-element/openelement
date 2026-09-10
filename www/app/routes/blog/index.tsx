/**
 * Blog Index Page - v4 dispatch journal: serif masthead, featured band,
 * and outlined-number article rows.
 *
 * The route owns content/locale projection; the compiled page component owns
 * only the markup and declared properties (ADR-0143/ADR-0148).
 */
import { definePage } from '@openelement/app';
import { posts } from '@openelement/generated/blog-data';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { localizePath } from '@openelement/site-ui/link.ts';
import BlogIndexPage from '../../components/page-blog-index.tsx';

export const meta = { section: 'History', label: 'Blog', order: 10 };

interface BlogIndexRow {
  slug: string;
  href: string;
  index: string;
  title: string;
  excerpt: string;
  date: string;
  langLabel: string;
}

/**
 * Bilingual chrome for the dispatch index (#1307): the /zh index previously
 * rendered hard-coded English strings under lang="zh". The origin note is
 * the standing honest marker: dispatches are single-language originals and
 * are not translated post by post.
 */
const content = {
  en: {
    headTitle: 'Blog — Dispatches',
    headDescription:
      'The openElement public audit trail: releases, architecture decisions and standards notes, published in their original language.',
    mastheadEyebrow: 'Blog — Dispatches from the lab',
    mastheadTitle: 'Dispatches.',
    mastheadLede:
      'The public audit trail: what changed, why the package graph moved, and which standards boundary matters next.',
    originNote:
      'Dispatches are published in their original language — English or Chinese — and are not translated post by post. The language label on each row names the original.',
    latestLabel: 'Latest dispatch',
    readMoreLabel: 'Read the dispatch →',
    streamLabel: 'Recent dispatches',
    featuredPrefix: 'Featured',
  },
  zh: {
    headTitle: '博客 — 通讯',
    headDescription: 'openElement 的公开审计轨迹：发布记录、架构决策与标准说明，以原始语言发布。',
    mastheadEyebrow: '博客 — 来自实验室的通讯',
    mastheadTitle: '通讯集。',
    mastheadLede: '公开的审计轨迹：改了什么、包图为何变动、下一条标准边界在哪里。',
    originNote: '通讯以原始语言发布——中文或英文——不逐篇翻译。每行的语言标签标明原文语种。',
    latestLabel: '最新通讯',
    readMoreLabel: '阅读全文 →',
    streamLabel: '近期通讯',
    featuredPrefix: '精选',
  },
} as const;

// Keep the dispatch index and blog-post prev/next ordering aligned: ADR posts
// are decision records, not public dispatches, and the newest date leads.
const visiblePosts = posts
  .filter((post) => post.frontmatter.type !== 'adr')
  .sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));

function postTags(post: typeof posts[number]): string[] {
  return post.frontmatter.tags ?? [];
}

function padIndex(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export default definePage(BlogIndexPage, {
  head({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const copy = content[resolved];
    return siteHead({
      route: '/blog',
      locale: resolved,
      title: copy.headTitle,
      description: copy.headDescription,
    });
  },
  props({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const t = content[resolved];
    const langLabel = (post: typeof posts[number]) =>
      (post.frontmatter.lang ?? 'en') === 'zh' ? '中文' : 'EN';
    const featured = visiblePosts[0];
    const rows: BlogIndexRow[] = visiblePosts.slice(1, 5).map((post, index) => ({
      slug: post.slug,
      href: localizePath(`/blog/${post.slug}`, resolved),
      index: padIndex(index),
      title: post.frontmatter.title,
      excerpt: post.frontmatter.excerpt ?? '',
      date: post.frontmatter.date,
      langLabel: langLabel(post),
    }));

    return {
      mastheadEyebrow: t.mastheadEyebrow,
      mastheadTitle: t.mastheadTitle,
      mastheadLede: t.mastheadLede,
      originNote: t.originNote,
      latestLabel: t.latestLabel,
      readMoreLabel: t.readMoreLabel,
      streamLabel: t.streamLabel,
      featuredHref: featured ? localizePath(`/blog/${featured.slug}`, resolved) : '',
      featuredKicker: featured
        ? `${t.featuredPrefix} — ${featured.frontmatter.date}${
          postTags(featured)[0] ? ` · ${postTags(featured)[0]}` : ''
        } · ${langLabel(featured)}`
        : '',
      featuredTitle: featured?.frontmatter.title ?? '',
      featuredExcerpt: featured?.frontmatter.excerpt ?? '',
      rows,
    };
  },
});
