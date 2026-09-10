/** Dynamic blog route; all request data is projected into a compiled page. */
import { definePage } from '@openelement/app';
import { trustedHtml } from '@openelement/element';
import { getPostBySlug, posts } from '@openelement/generated/blog-data';
import { prepareArticle } from '@openelement/site-ui/article-body.ts';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { localizePath } from '@openelement/site-ui/link.ts';
import PageBlogPost from '../../components/page-blog-post.tsx';

export function getStaticPaths(): Array<Record<string, string>> {
  return posts.map((post) => ({ slug: post.slug }));
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
        notFoundClass: 'not-found',
        articleClass: 'is-hidden',
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
      };
    }

    const tags = post.frontmatter.tags ?? [];
    // #1307: dispatches are single-language originals (the www:check-truth
    // blog-language gate requires the `lang` frontmatter). When the rendered
    // locale does not match the post's language, say so instead of letting
    // the locale prefix imply a translation.
    const postLang = post.frontmatter.lang ?? 'en';
    const langNotice = postLang === resolved
      ? ''
      : resolved === 'en'
      ? 'This dispatch is published in Chinese (中文原文).'
      : '本文以英文原文发布（English original）。';
    const article = prepareArticle(post.html);
    const visiblePosts = posts
      .filter((candidate) => candidate.frontmatter.type !== 'adr')
      .sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));
    const index = visiblePosts.findIndex((candidate) => candidate.slug === post.slug);
    const previous = index >= 0 ? visiblePosts[index + 1] : undefined;
    const next = index > 0 ? visiblePosts[index - 1] : undefined;

    return {
      ...shared,
      notFoundClass: 'not-found is-hidden',
      articleClass: '',
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
