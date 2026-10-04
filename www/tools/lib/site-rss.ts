/**
 * Blog feed for www (#1441).
 *
 * Format: RSS 2.0 at /blog/rss.xml. Two of the three reference sites the site
 * measures itself against publish RSS 2.0 at exactly this shape —
 * svelte.dev/blog/rss.xml and astro.build/rss.xml — while lit.dev serves Atom
 * at /blog/atom.xml; RSS 2.0 is also the format every reader, feed-to-email
 * bridge and static-site template consumes without configuration. The artifact
 * path is part of the public contract (the head's rel=alternate href), so the
 * format follows the path rather than the other way round.
 *
 * Items are the published (non-draft) blog posts in the collection's own order
 * (newest first), the same list the /blog routes and the sitemap enumerate —
 * loaded from source, never scanned out of built output and never hand-synced.
 * Every field comes from the post the route projects: title, excerpt, date.
 * lastBuildDate is deliberately omitted: the two reference feeds omit it too,
 * and a build-date field would make the artifact differ on every build.
 *
 * Pure functions only; IO lives in ../emit-site-rss.ts.
 */

import { SITE_ORIGIN } from '../../app/site-ui/head.ts';
import type { BlogPost } from '../../lib/content.ts';
import { isCalendarDate } from './calendar-date.ts';
import { escapeXml } from './xml-escape.ts';

/** Public feed path, relative to the site root (dist artifact and head href). */
export const SITE_FEED_PATH = '/blog/rss.xml';

/** Feed title; the head's rel=alternate link carries the same string. */
export const SITE_FEED_TITLE = 'openElement Blog';

/** Channel copy: the blog index's published one-line description. */
const SITE_FEED_DESCRIPTION =
  'The openElement public audit trail: releases, architecture decisions and standards notes, ' +
  'published in their original language.';

/**
 * Collection dates are `YYYY-MM-DD`; RSS pubDate is RFC 822 in GMT. Calendar
 * validation delegates to isCalendarDate — the same UTC round-trip the
 * content-dates manifest gate runs, so a stamp the gate accepts is exactly a
 * stamp the feed renders. The failure gate (feedFailures) and the serializer
 * share this one function.
 */
function rssPubDate(date: string): string | undefined {
  if (!isCalendarDate(date)) return undefined;
  const [year, month, day] = date.split('-').map(Number);
  // setUTCFullYear (not the Date constructor) matches the validator: years
  // below 100 stay literal instead of mapping into the 1900s.
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed.toUTCString();
}

/** Absolute URL for a site path (the sitemap's loc math, one host ahead). */
function siteUrl(path: string, hostname: string): string {
  return `${hostname.replace(/\/$/, '')}${path}`;
}

/** Absolute post permalink; the same URL the route's canonical tag emits. */
export function blogPostUrl(slug: string, hostname: string = SITE_ORIGIN): string {
  return siteUrl(`/blog/${slug}`, hostname);
}

/**
 * Fail-closed checks for the feed's source posts: an item that cannot carry a
 * permalink or an RFC 822 date would make the feed unparseable or drop a post
 * silently, so the build stops instead.
 */
export function feedFailures(posts: readonly BlogPost[]): string[] {
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const post of posts) {
    if (post.slug.length === 0) {
      failures.push('blog post without a slug cannot be permalinked from the feed');
    } else if (seen.has(post.slug)) {
      failures.push(`duplicate feed guid for blog post '${post.slug}'`);
    }
    seen.add(post.slug);
    if (rssPubDate(post.frontmatter.date) === undefined) {
      failures.push(
        `blog post '${post.slug}' has no publishable date (got '${post.frontmatter.date}')`,
      );
    }
  }
  return failures;
}

/** Render the RSS 2.0 feed from published blog posts (newest first). */
export function renderBlogFeedXml(
  posts: readonly BlogPost[],
  options: { hostname?: string } = {},
): string {
  const hostname = options.hostname ?? SITE_ORIGIN;
  const items = posts
    .map((post) => {
      const url = blogPostUrl(post.slug, hostname);
      const pubDate = rssPubDate(post.frontmatter.date);
      if (pubDate === undefined) {
        // feedFailures() is the fail-closed gate in front of this renderer; an
        // item without a pubDate would silently lose its date instead.
        throw new Error(
          `blog post '${post.slug}' has no publishable date (got '${post.frontmatter.date}')`,
        );
      }
      return (
        `    <item>\n` +
        `      <title>${escapeXml(post.frontmatter.title)}</title>\n` +
        `      <link>${escapeXml(url)}</link>\n` +
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>\n` +
        `      <description>${escapeXml(post.frontmatter.excerpt ?? '')}</description>\n` +
        `      <pubDate>${escapeXml(pubDate)}</pubDate>\n` +
        `    </item>`
      );
    })
    .join('\n');
  const channel =
    `  <channel>\n` +
    `    <title>${escapeXml(SITE_FEED_TITLE)}</title>\n` +
    `    <link>${escapeXml(siteUrl('/blog', hostname))}</link>\n` +
    `    <description>${escapeXml(SITE_FEED_DESCRIPTION)}</description>\n` +
    (items.length > 0 ? `${items}\n` : '') +
    `  </channel>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n${channel}\n</rss>`;
}
