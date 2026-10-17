/**
 * Blog Index Page - v4 dispatch journal: serif masthead, featured band,
 * and outlined-number article rows.
 *
 * The route owns content/locale projection; the compiled page component owns
 * only the markup and declared properties (ADR-0143/ADR-0148).
 */
import { definePage } from '@openelement/router';
import { posts } from '#generated/blog-data';
import { visibleBlogPosts } from '#site-ui/blog-stream.ts';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { localizePath } from '#site-ui/link.ts';
import '#site-ui/open-reading-shell.tsx';
import '#site-ui/open-artifact-panel.tsx';
import '../../islands/open-page-rail.tsx';

// Blog, changelog, roadmap and contributing are the project's own pages, not
// documentation chapters: they share the nameless group the sidebar labels
// "Project" (FALLBACK_SECTION in site-ui/open-layout-navigation.ts).
export const meta = { section: '', label: 'Blog', order: 5 };

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
const visiblePosts = visibleBlogPosts();

function postTags(post: (typeof posts)[number]): string[] {
  return post.frontmatter.tags ?? [];
}

function padIndex(index: number): string {
  return String(index + 1).padStart(2, '0');
}

/**
 * The dispatch index as a server function page (alpha15 server architecture):
 * the route module's own exported TSX function, lowered by the compiler into
 * a generative HTML constructor. The page hook class (`page-blog-index`)
 * scopes the former component sheet's authored rules in the linked document
 * stylesheet.
 */
export function BlogIndexPage(props: {
  featuredHref: string;
  featuredKicker: string;
  featuredTitle: string;
  featuredExcerpt: string;
  rows: Array<{
    slug: string;
    href: string;
    index: string;
    title: string;
    excerpt: string;
    date: string;
    langLabel: string;
  }>;
  mastheadEyebrow: string;
  mastheadTitle: string;
  mastheadLede: string;
  originNote: string;
  latestLabel: string;
  readMoreLabel: string;
  streamLabel: string;
}) {
  return (
    <div class='page-blog-index' data-pagefind-body>
      <header class='masthead relative isolate px-[clamp(1.5rem,5vw,4.5rem)] pt-[clamp(4rem,11vh,8rem)] pb-[clamp(2.5rem,6vh,4.5rem)]'>
        <p class='eyebrow flex items-center gap-3 text-primary font-mono text-(length:--text-xs) font-extrabold tracking-[0.29em] uppercase [&:lang(zh)]:normal-case [&:lang(zh)]:tracking-[0.08em]'>
          {props.mastheadEyebrow}
        </p>
        <h1 class='mt-[clamp(1.5rem,4vh,3rem)] font-serif italic font-normal text-[clamp(4.2rem,13vw,11rem)] leading-[0.92] tracking-[-0.02em] text-primary'>
          {props.mastheadTitle}
        </h1>
        <p class='max-w-[38rem] mt-[clamp(1.25rem,3vh,2rem)] text-muted-foreground text-[clamp(1rem,1.2vw,1.1rem)] leading-[1.75]'>
          {props.mastheadLede}
        </p>
        <p class='max-w-[38rem] mt-3 font-mono text-(length:--text-xs) leading-[1.75] text-muted-foreground empty:hidden'>
          {props.originNote}
        </p>
      </header>

      <a
        class='group block border-y border-border bg-[color-mix(in_srgb,var(--color-popover)_55%,var(--color-background))] px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(2.5rem,6vh,4.5rem)] text-inherit no-underline'
        href={props.featuredHref}
      >
        <p class='flex flex-wrap items-baseline gap-3 text-primary font-mono text-(length:--text-xs) font-extrabold tracking-[0.16em] uppercase'>
          <span>{props.featuredKicker}</span>
          <span class='ms-auto text-muted-foreground font-medium tracking-[0.08em]'>
            {props.latestLabel}
          </span>
        </p>
        <h2 class='max-w-[20ch] mt-5 font-serif font-normal text-[clamp(2.4rem,5.5vw,4.6rem)] leading-none tracking-[-0.01em] text-foreground transition-[color] duration-150 ease-[ease] group-hover:text-primary'>
          {props.featuredTitle}
        </h2>
        <p class='max-w-[44rem] mt-4 font-mono text-(length:--text-sm) leading-[1.75] text-muted-foreground empty:hidden'>
          {props.featuredExcerpt}
        </p>
        <span class='inline-block mt-5 text-primary font-mono text-(length:--text-sm) font-bold'>
          {props.readMoreLabel}
        </span>
      </a>

      <section class='grid pb-[clamp(3rem,8vh,6rem)]' aria-label={props.streamLabel}>
        {props.rows.map((row) => (
          <a
            class='group grid grid-cols-[minmax(0,1fr)] gap-2 border-b border-border px-[clamp(1.5rem,5vw,4.5rem)] py-[clamp(1.5rem,4vh,2.75rem)] text-inherit no-underline transition-[background] duration-150 ease-[ease] hover:bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-primary)_8%,transparent),transparent)] min-[721px]:grid-cols-[minmax(4rem,0.14fr)_minmax(0,1fr)_auto] min-[721px]:gap-[clamp(1rem,4vw,4rem)]'
            key={row.slug}
            href={row.href}
          >
            <span
              class='font-mono text-[clamp(2.4rem,5vw,4rem)] font-[800] leading-none text-transparent [-webkit-text-stroke:1.5px_color-mix(in_srgb,var(--color-ring)_55%,transparent)]'
              aria-hidden='true'
            >
              {row.index}
            </span>
            <div>
              <span class='block font-serif font-normal text-[clamp(1.6rem,3vw,2.6rem)] leading-[1.05] text-foreground transition-[color] duration-150 ease-[ease] group-hover:text-primary'>
                {row.title}
              </span>
              <span class='inline-block px-2 py-0 mt-2 border border-[color-mix(in_srgb,var(--color-ring)_45%,transparent)] rounded-md text-muted-foreground font-mono text-(length:--text-xs) tracking-[0.08em] empty:hidden'>
                {row.langLabel}
              </span>
              <p class='mt-2 text-muted-foreground font-mono text-(length:--text-xs) leading-[1.6] empty:hidden'>
                {row.excerpt}
              </p>
            </div>
            <span class='text-muted-foreground font-mono text-(length:--text-xs) whitespace-nowrap justify-self-start min-[721px]:justify-self-auto'>
              {row.date}
            </span>
          </a>
        ))}
      </section>
    </div>
  );
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
    const langLabel = (post: (typeof posts)[number]) =>
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
