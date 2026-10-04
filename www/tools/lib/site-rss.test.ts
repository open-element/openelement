/** Blog feed render unit tests (#1441). */
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { fileURLToPath } from 'node:url';
import { blogCollection, blogCollectionSchema, prepareBlogPosts } from '../../lib/blog.ts';
import {
  type CollectionEntry,
  loadCollectionData,
  validateCollectionFrontmatter,
} from '../../lib/content.ts';
import { blogPostUrl, feedFailures, renderBlogFeedXml, SITE_FEED_PATH } from './site-rss.ts';

/** Build a collection entry exactly as the loader does (filename date prefix and all). */
function entry(fileName: string, raw: Record<string, unknown>): CollectionEntry {
  const fileSlug = fileName.replace(/\.md$/, '');
  const result = validateCollectionFrontmatter(blogCollectionSchema, raw, {
    collection: 'blog',
    fileName,
    filePath: `blog/${fileName}`,
    slug: fileSlug,
  });
  return {
    slug: result.slug ?? fileSlug,
    frontmatter: result.frontmatter,
    content: '',
    html: '',
  };
}

const POSTS = prepareBlogPosts([
  entry('2026-08-01-older-dispatch.md', {
    title: 'Older dispatch',
    date: '2026-08-01',
    excerpt: 'The earlier one.',
  }),
  entry('2026-09-13-unpublished-draft.md', {
    title: 'Unpublished draft',
    date: '2026-09-13',
    draft: true,
  }),
  entry('2026-09-14-newer-dispatch.md', {
    title: 'Newer & <unsafe> dispatch',
    date: '2026-09-14',
    excerpt: 'Nanoseconds & <tags> are escaped.',
  }),
]);

/** Item blocks in document order, assertions on a feed that must stay well-formed. */
function items(xml: string): string[] {
  return xml.match(/^\s*<item>[\s\S]*?^\s*<\/item>$/gm) ?? [];
}

test('renderBlogFeedXml: one item per published post, drafts excluded, newest first', () => {
  const xml = renderBlogFeedXml(POSTS);
  expect(POSTS.length, 'prepareBlogPosts drops the draft').toEqual(2);
  expect(items(xml).length).toEqual(POSTS.length);
  expect(!xml.includes('unpublished-draft'), 'draft post never reaches the feed').toBeTruthy();
  expect([...xml.matchAll(/<title>([^<]*)<\/title>/g)].map((match) => match[1])).toEqual([
    'openElement Blog',
    'Newer &amp; &lt;unsafe&gt; dispatch',
    'Older dispatch',
  ]);
});

test('renderBlogFeedXml: absolute permalinks, guid and RFC 822 dates', () => {
  const xml = renderBlogFeedXml(POSTS);
  expect(items(xml)[0]).toEqual(
    '    <item>\n' +
      '      <title>Newer &amp; &lt;unsafe&gt; dispatch</title>\n' +
      '      <link>https://openelement.org/blog/newer-dispatch</link>\n' +
      '      <guid isPermaLink="true">https://openelement.org/blog/newer-dispatch</guid>\n' +
      '      <description>Nanoseconds &amp; &lt;tags&gt; are escaped.</description>\n' +
      '      <pubDate>Mon, 14 Sep 2026 00:00:00 GMT</pubDate>\n' +
      '    </item>',
  );
  expect(xml.includes(`<link>${blogPostUrl('older-dispatch')}</link>`)).toBeTruthy();
  expect(!xml.includes('<link>/blog/'), 'links are absolute, never site-relative').toBeTruthy();
});

test('renderBlogFeedXml: well-formed RSS 2.0 document, deterministic output', () => {
  const xml = renderBlogFeedXml(POSTS, { hostname: 'https://example.test/' });
  expect(
    xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n'),
  ).toBeTruthy();
  expect(xml.endsWith('</rss>')).toBeTruthy();
  expect(xml.match(/<rss\b/g)?.length).toEqual(1);
  expect(xml.match(/<channel>/g)?.length).toEqual(1);
  expect(xml.match(/<channel>[\s\S]*<\/channel>/g)?.length).toEqual(1);
  // Every element the feed opens is closed, and no raw text marker leaks
  // unescaped into a text node (the escaped forms are the only ones allowed).
  expect((xml.match(/<item>/g) ?? []).length).toEqual((xml.match(/<\/item>/g) ?? []).length);
  expect(!/&(?!(amp|lt|gt|quot|apos);)/.test(xml), 'every & is an entity').toBeTruthy();
  expect(
    xml.includes('<link>https://example.test/blog</link>'),
    'trailing host slash is normalized',
  ).toBeTruthy();
  expect(renderBlogFeedXml(POSTS, { hostname: 'https://example.test/' })).toEqual(xml);
  expect(renderBlogFeedXml([]).includes('<item>'), 'an empty collection renders no items').toEqual(
    false,
  );
  expect(
    renderBlogFeedXml([
      {
        slug: 'no-excerpt',
        frontmatter: { title: 'No excerpt', date: '2026-01-02' },
        content: '',
        html: '',
      },
    ]).includes('<description></description>'),
    'a post without an excerpt renders an empty, valid description element',
  ).toBeTruthy();
});

test('feedFailures: unpublishable dates, duplicate and empty slugs fail closed', () => {
  expect(feedFailures(POSTS)).toEqual([]);
  const broken = prepareBlogPosts([
    entry('not-a-dated-filename.md', { title: 'No date', date: 'someday' }),
    entry('2026-09-14-dup.md', { title: 'First', date: '2026-09-14' }),
  ]);
  // A date that matches YYYY-MM-DD but is not a real day must fail too: the
  // regex-shaped check alone would emit an Invalid Date pubDate.
  expect(
    feedFailures([
      {
        slug: 'impossible-date',
        frontmatter: { title: 'Impossible', date: '2026-13-45' },
        content: '',
        html: '',
      },
    ]).some((failure) => failure.includes("no publishable date (got '2026-13-45')")),
  ).toBeTruthy();
  const failures = feedFailures([
    ...broken,
    {
      slug: 'not-a-dated-filename',
      frontmatter: { title: 'Second', date: '2026-09-14' },
      content: '',
      html: '',
    },
    { slug: '', frontmatter: { title: 'Unreachable', date: '2026-09-14' }, content: '', html: '' },
  ]);
  expect(
    failures.some((failure) => failure.includes("no publishable date (got 'someday')")),
  ).toBeTruthy();
  expect(
    failures.some((failure) =>
      failure.includes("duplicate feed guid for blog post 'not-a-dated-filename'"),
    ),
  ).toBeTruthy();
  expect(failures.some((failure) => failure.includes('without a slug'))).toBeTruthy();
  // The renderer refuses the same post rather than emitting a dateless item.
  assertThrowsIncludes(
    () => renderBlogFeedXml(broken),
    Error,
    "no publishable date (got 'someday')",
  );
});

test('site feed: the real blog collection renders one item per published post', async () => {
  const contentDir = fileURLToPath(new URL('../../content/blog', import.meta.url));
  const posts = prepareBlogPosts(
    await loadCollectionData('blog', { ...blogCollection, contentDir }),
  );
  const xml = renderBlogFeedXml(posts);
  expect(items(xml).length).toEqual(posts.length);
  expect(posts.length > 0, 'the site ships at least one published dispatch').toBeTruthy();
  for (const post of posts) {
    expect(
      xml.includes(`<guid isPermaLink="true">${blogPostUrl(post.slug)}</guid>`),
      `${post.slug} is permalinked absolutely`,
    ).toBeTruthy();
  }
  expect(SITE_FEED_PATH).toEqual('/blog/rss.xml');
});

test('feedFailures: calendar dates round-trip and impossible days fail closed', () => {
  const failureFor = (date: string): string[] =>
    feedFailures([
      { slug: 'dated-post', frontmatter: { title: 'Dated', date }, content: '', html: '' },
    ]);

  for (const date of [
    '2026-02-29',
    '2025-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-45',
    'someday',
  ]) {
    expect(
      failureFor(date).some((failure) => failure.includes(`no publishable date (got '${date}')`)),
      `calendar-impossible date must fail closed: ${date}`,
    ).toBeTruthy();
  }
  for (const date of ['2028-02-29', '2000-02-29', '2026-04-30', '2026-09-14']) {
    expect(failureFor(date), `real calendar date must be accepted: ${date}`).toEqual([]);
  }
});
