/**
 * The single write path for site page <head> meaning (Beta.2.2, #1327).
 *
 * Every route module declares its head through the page descriptor (static
 * object or resolver); this helper owns the site-wide derivation rules so the
 * per-route declaration stays a copy-only statement:
 *
 *   - titles carry the brand suffix (`brandedTitle`);
 *   - canonical/og:url/hreflang derive from the route + render locale through
 *     the same localizePath math the in-content links use (#1031);
 *   - every non-error page lists both site locales plus an x-default;
 *   - error documents (404) keep og fields but omit canonical/hreflang —
 *     they are not indexable and stay out of the sitemap;
 *   - structured data (JSON-LD) is declared as page truth below and reaches
 *     <head> through the router's structured-data channel: the framework
 *     serializes each document with JSON.stringify into its own
 *     `<script type="application/ld+json">`, so no raw markup is written here.
 *
 * Resolved once per render by resolvePageDocument (@openelement/router/document)
 * before either serializer runs; there is no post-build head rewrite anymore.
 */
import type { PageHead } from '@openelement/router';
import { getPostBySlug } from '@openelement/generated/blog-data';
import { contentLocale } from './locale.ts';
import { localizePath, SITE_LOCALES } from './link.ts';

export const SITE_ORIGIN = 'https://openelement.org';

const BRAND = 'openElement';

/** The one organization node the site's structured data points at. */
function organizationNode(): Record<string, unknown> {
  return { '@type': 'Organization', name: BRAND, url: SITE_ORIGIN };
}

/** Branded document title; the brand suffix keeps the site name in every title. */
export function brandedTitle(title: string): string {
  return title.includes(BRAND) ? title : `${title} — ${BRAND}`;
}

export interface SiteHeadInput {
  /** Canonical default-locale route of the page, e.g. '/guide/getting-started'. */
  route: string;
  /** Render locale from the page-head resolver context. */
  locale: string | undefined;
  /** Page-specific title (locale-appropriate), without the brand suffix. */
  title: string;
  /** Page-specific, locale-appropriate meta/og description. */
  description: string;
  /** Error documents carry og fields, a robots noindex, and no canonical/hreflang. */
  error?: boolean;
}

/** Compose one page's PageHead from its route, locale and copy. */
export function siteHead(input: SiteHeadInput): PageHead {
  const locale = contentLocale(input.locale ?? 'en');
  const title = brandedTitle(input.title);
  const canonical = `${SITE_ORIGIN}${localizePath(input.route, locale)}`;
  const head: PageHead = {
    title,
    description: input.description,
    meta: [
      { property: 'og:title', content: title },
      { property: 'og:description', content: input.description },
      { property: 'og:url', content: canonical },
    ],
  };
  // Blog dispatches are articles (D-9): derive og:type and the article
  // fields from the same generated blog truth the route body projects, so the
  // head cannot drift from the post. Route meta serializes BEFORE the
  // site-wide vite.config.ts inject.headFragments (wrapInDocument emits
  // metaBlock ahead of headExtras), so on dispatch pages og:type=article
  // precedes the static og:type=website boilerplate — OG consumers honor the
  // first og:type, and non-article pages keep only the website tag.
  const blogMatch = /^\/blog\/([^/]+)$/.exec(input.route);
  if (blogMatch && !input.error) {
    const post = getPostBySlug(blogMatch[1]);
    if (post) {
      head.meta?.push(
        { property: 'og:type', content: 'article' },
        { property: 'article:published_time', content: post.frontmatter.date },
        { property: 'article:author', content: BRAND },
      );
      // BlogPosting: only the post's own truth — the raw headline (the
      // branded <title> stays the document title), its excerpt as rendered
      // copy, its frontmatter date and language. No image, logo, sameAs or
      // social profile is invented: the site has no such data to declare.
      head.structuredData = [
        {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: post.frontmatter.title,
          description: input.description,
          datePublished: post.frontmatter.date,
          inLanguage: post.frontmatter.lang ?? 'en',
          url: canonical,
          mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
          author: organizationNode(),
          publisher: organizationNode(),
          ...(post.frontmatter.tags && post.frontmatter.tags.length > 0
            ? { keywords: [...post.frontmatter.tags] }
            : {}),
        },
      ];
    }
  }
  // The front page declares the site itself: WebSite (name/url/description/
  // language, published by the organization) plus the Organization node.
  if (!input.error && input.route === '/') {
    head.structuredData = [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: BRAND,
        url: canonical,
        description: input.description,
        inLanguage: locale,
        publisher: organizationNode(),
      },
      {
        '@context': 'https://schema.org',
        ...organizationNode(),
      },
    ];
  }
  if (!input.error) {
    head.canonical = canonical;
    head.alternates = [
      ...SITE_LOCALES.map((candidate) => ({
        href: `${SITE_ORIGIN}${localizePath(input.route, candidate)}`,
        hreflang: candidate,
      })),
      {
        href: `${SITE_ORIGIN}${localizePath(input.route, SITE_LOCALES[0])}`,
        hreflang: 'x-default',
      },
    ];
  } else {
    // Error documents answer 404: keep them out of search results. The tag is
    // metadata, not a head fragment, so the router's <script>-only head
    // predicate stays untouched.
    head.meta?.push({ name: 'robots', content: 'noindex' });
  }
  return head;
}
