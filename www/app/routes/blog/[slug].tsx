/** Dynamic blog route; all request data is projected into the page function. */
import { definePage } from '@openelement/router';
import { trustedHtml, type TrustedHtml } from '@openelement/element';
import { getPostBySlug, posts } from '#generated/blog-data';
import { prepareArticle } from '#site-ui/article-body.ts';
import { visibleBlogPosts } from '#site-ui/blog-stream.ts';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { localizePath } from '#site-ui/link.ts';
import '#site-ui/open-reading-shell.tsx';
import '../../islands/open-page-rail.tsx';
import '#site-ui/open-artifact-panel.tsx';

export function getStaticPaths(): Array<Record<string, string>> {
  return posts.map((post) => ({ slug: post.slug }));
}

/**
 * The blog dispatch as a server function page (alpha15 server architecture):
 * the route module's own exported TSX function, lowered by the compiler into
 * a generative HTML constructor. The page hook class (`page-blog-post`) scopes
 * the former component sheet's authored rules in the linked document
 * stylesheet. Visibility is the native `hidden` attribute: the projector
 * derives the booleans from the post's existence (the retired computed fields
 * read the same token).
 */
export function PageBlogPost(props: {
  notFoundHidden: boolean;
  articleHidden: boolean;
  notFoundMessage: string;
  slug: string;
  blogHref: string;
  backLabel: string;
  breadcrumbLabel: string;
  crumbCurrent: string;
  postTitle: string;
  lede: string;
  date: string;
  postLang: string;
  langNotice: string;
  tags: Array<{ key: string; label: string }>;
  railItems: Array<{ id: string; href: string; label: string; depth: string }>;
  navigation: {
    previous?: { href: string; label: string };
    next?: { href: string; label: string };
  };
  articleHtml: TrustedHtml;
  nextDispatchLabel: string;
  nextDispatchHref: string;
  nextDispatchText: string;
  locale: string;
}) {
  return (
    <div class='page-blog-post'>
      <div
        class='px-4 py-12 text-center text-muted-foreground'
        hidden={props.notFoundHidden}
        data-pagefind-ignore
      >
        <h1 class='mb-4 font-black leading-[1.05] tracking-[-0.06em] text-foreground text-(length:--text-5xl) min-[481px]:text-(length:--text-6xl) min-[901px]:text-[clamp(2.7rem,6vw,5.5rem)]'>
          404
        </h1>
        <p class='my-2 text-sm leading-[1.72] text-foreground min-[901px]:text-(length:--text-base)'>
          {props.notFoundMessage}: {props.slug}
        </p>
        <a
          class='text-primary underline underline-offset-[3px] decoration-[color-mix(in_srgb,var(--color-primary)_34%,transparent)] decoration-1 transition-[color,text-decoration-color] duration-150 ease-in-out hover:text-[color-mix(in_srgb,var(--color-primary)_80%,var(--color-foreground))] hover:decoration-current focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px] motion-reduce:transition-none'
          href={props.blogHref}
        >
          ← {props.backLabel}
        </a>
      </div>

      <div hidden={props.articleHidden} data-pagefind-body>
        <open-reading-shell meta rail footer navigation={props.navigation} locale={props.locale}>
          <div slot='meta'>
            <p class='mb-4 flex flex-wrap items-baseline gap-2 font-mono text-(length:--text-xs) leading-[1.72] font-extrabold tracking-[0.1em] text-muted-foreground uppercase'>
              <a
                class='text-muted-foreground no-underline transition-[color,text-decoration-color] duration-150 ease-in-out hover:text-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px] motion-reduce:transition-none'
                href={props.blogHref}
              >
                {props.breadcrumbLabel}
              </a>
              <span>/</span>
              <span class='text-primary'>{props.crumbCurrent}</span>
            </p>
            <h1
              class='m-0 font-serif text-[clamp(2.4rem,5.5vw,4.4rem)] leading-[1.02] font-normal italic tracking-[-0.01em] wrap-break-word text-balance text-foreground'
              data-pagefind-meta='title'
            >
              {props.postTitle}
            </h1>
            <p class='mt-4 max-w-[640px] text-[clamp(var(--text-base),1.4vw,var(--text-xl))] leading-[1.65] text-muted-foreground empty:hidden'>
              {props.lede}
            </p>
            <p class='mt-4 flex flex-wrap gap-2 font-mono text-(length:--text-xs) leading-[1.72] tracking-[0.06em] text-muted-foreground uppercase'>
              <time>{props.date}</time>
              {props.tags.map((tag) => (
                <span key={tag.key}>· {tag.label}</span>
              ))}
            </p>
            <p
              class='mt-4 max-w-[640px] border-s-2 border-s-ring px-3 py-2 text-(length:--text-sm) leading-[1.65] text-muted-foreground empty:hidden'
              role='note'
            >
              {props.langNotice}
            </p>
          </div>
          <div slot='rail'>
            <open-page-rail items={props.railItems} locale={props.locale}></open-page-rail>
          </div>
          <div
            class='blog-content'
            lang={props.postLang}
            innerHTML={props.articleHtml}
            trustedHtml
          />
          <nav
            class='mt-10 grid gap-3 border-t border-border pt-6'
            aria-label={props.nextDispatchLabel}
          >
            <span class='font-mono text-(length:--text-xs) font-extrabold tracking-[0.16em] text-muted-foreground uppercase'>
              {props.nextDispatchLabel}
            </span>
            <a
              class='font-serif text-[clamp(1.7rem,3.2vw,2.6rem)] leading-[1.05] text-foreground no-underline transition-[color,text-decoration-color] duration-150 ease-in-out hover:text-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px] motion-reduce:transition-none'
              href={props.nextDispatchHref}
            >
              {props.nextDispatchText}
            </a>
          </nav>
        </open-reading-shell>
      </div>
    </div>
  );
}

export default definePage(PageBlogPost, {
  // #1307/#1327: dispatches are single-language originals — the head always
  // resolves from the post's own frontmatter (title/excerpt), whichever
  // locale the page is rendered under; the on-page language notice discloses
  // the mismatch. A post without an excerpt still gets a real, page-specific
  // description.
  head({ locale, params }) {
    const slug = params.slug ?? '';
    const post = getPostBySlug(slug);
    if (!post) {
      return siteHead({
        route: `/blog/${slug}`,
        locale,
        title: 'Post not found',
        description: 'The requested openElement dispatch does not exist.',
        error: true,
      });
    }
    const title = post.frontmatter.title;
    const excerpt = post.frontmatter.excerpt ?? '';
    return siteHead({
      route: `/blog/${slug}`,
      locale,
      title,
      description: excerpt !== '' ? excerpt : `${title} — openElement dispatch`,
    });
  },
  props({ locale, params }) {
    const resolved = contentLocale(locale ?? 'en');
    const slug = params.slug ?? '';
    const blogHref = localizePath('/blog', resolved);
    const post = getPostBySlug(slug);
    const shared = {
      slug,
      blogHref,
      notFoundMessage: resolved === 'en' ? 'Post not found' : '未找到文章',
      backLabel: resolved === 'en' ? 'Back to Blog' : '返回博客',
      breadcrumbLabel: resolved === 'en' ? 'Blog' : '博客',
      nextDispatchLabel: resolved === 'en' ? 'Next dispatch' : '下一篇',
    };

    if (!post) {
      return {
        ...shared,
        notFoundHidden: false,
        articleHidden: true,
        crumbCurrent: '',
        postTitle: '',
        lede: '',
        date: '',
        postLang: resolved,
        langNotice: '',
        tags: [],
        railItems: [],
        navigation: {},
        articleHtml: trustedHtml(''),
        nextDispatchHref: blogHref,
        nextDispatchText: resolved === 'en' ? 'Back to all dispatches →' : '返回全部文章 →',
        locale: resolved,
      };
    }

    const tags = post.frontmatter.tags ?? [];
    // #1307: dispatches are single-language originals (`lang` frontmatter
    // records the original language). When the rendered
    // locale does not match the post's language, say so instead of letting
    // the locale prefix imply a translation.
    const postLang = post.frontmatter.lang ?? 'en';
    const langNotice =
      postLang === resolved
        ? ''
        : resolved === 'en'
          ? 'This dispatch is published in Chinese (中文原文).'
          : '本文以英文原文发布（English original）。';
    const article = prepareArticle(post.html, resolved);
    // Same list the dispatch index renders: ADR posts excluded, newest first.
    const visiblePosts = visibleBlogPosts();
    const index = visiblePosts.findIndex((candidate) => candidate.slug === post.slug);
    const previous = index >= 0 ? visiblePosts[index + 1] : undefined;
    const next = index > 0 ? visiblePosts[index - 1] : undefined;

    return {
      ...shared,
      notFoundHidden: true,
      articleHidden: false,
      crumbCurrent: tags[0] ?? (resolved === 'en' ? 'Dispatch' : '随笔'),
      postTitle: post.frontmatter.title,
      lede: post.frontmatter.excerpt ?? '',
      date: post.frontmatter.date,
      postLang,
      langNotice,
      tags: tags.map((tag) => ({ key: tag, label: tag })),
      railItems: article.outline.map((item) => ({
        id: item.id,
        href: `#${item.id}`,
        label: item.label,
        depth: String(item.level ?? 2),
      })),
      navigation: {
        previous: previous
          ? { href: `${blogHref}/${previous.slug}`, label: previous.frontmatter.title }
          : undefined,
        next: next
          ? { href: `${blogHref}/${next.slug}`, label: next.frontmatter.title }
          : undefined,
      },
      articleHtml: trustedHtml(article.html),
      nextDispatchHref: next ? `${blogHref}/${next.slug}` : blogHref,
      nextDispatchText: next
        ? `${next.frontmatter.title} →`
        : resolved === 'en'
          ? 'Back to all dispatches →'
          : '返回全部文章 →',
    };
  },
});
