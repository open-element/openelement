/**
 * www blog collection.
 *
 * Blog posts were formerly a second adapter-provided collection (the blog half
 * of the retired `content` plugin). They are the same pipeline as the guide /
 * architecture collections with a different frontmatter schema and slug
 * convention, plus one ordering rule: newest first.
 *
 * The specifier `@openelement/generated/blog-data` used to be a Vite virtual
 * module built at dev/build time, with a checked-in `.d.ts` stub supplying
 * types for `deno check`. Virtual modules are gone, so the module is now a real
 * generated file — `www/app/data/_generated-blog-data.ts` — written by
 * `deno task generate:www-content-data` alongside the article collections.
 */

import type { BlogPost, BlogPostFrontmatter } from './content.ts';
import type { CollectionEntry, CollectionOptions } from './content.ts';

/** Blog frontmatter: everything optional except title/date, which default. */
export const blogCollectionSchema: CollectionOptions['schema'] = {
  fields: {
    title: 'string',
    date: 'string',
    draft: 'boolean',
    tags: 'string[]',
    excerpt: 'string',
    type: 'string',
    lang: 'string',
  },
  transform(frontmatter, context) {
    // Dispatch filenames carry a `YYYY-MM-DD-` prefix; the date is both the
    // slug suffix to strip and the fallback publication date.
    const datePrefix = context.fileName.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1];
    const slug = context.slug.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    return {
      slug,
      frontmatter: {
        title: frontmatter.title ?? slug,
        date: frontmatter.date ?? datePrefix ?? new Date().toISOString().split('T')[0],
        draft: frontmatter.draft ?? false,
        tags: frontmatter.tags ?? [],
        ...(frontmatter.excerpt === undefined ? {} : { excerpt: frontmatter.excerpt }),
        ...(frontmatter.type === undefined ? {} : { type: frontmatter.type }),
        ...(frontmatter.lang === undefined ? {} : { lang: frontmatter.lang }),
      },
    };
  },
};

export const blogCollection: CollectionOptions = {
  contentDir: 'content/blog',
  basePath: '/blog',
  schema: blogCollectionSchema,
};

/** Narrow a loaded collection entry onto the blog post record routes consume. */
export function toBlogPost(entry: CollectionEntry): BlogPost {
  const frontmatter = entry.frontmatter;
  const blogFrontmatter: BlogPostFrontmatter = {
    title: String(frontmatter.title),
    date: String(frontmatter.date),
    draft: Boolean(frontmatter.draft),
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
    ...(typeof frontmatter.excerpt === 'string' ? { excerpt: frontmatter.excerpt } : {}),
    ...(typeof frontmatter.type === 'string' ? { type: frontmatter.type } : {}),
    ...(typeof frontmatter.lang === 'string' ? { lang: frontmatter.lang } : {}),
  };
  return {
    slug: entry.slug,
    frontmatter: blogFrontmatter,
    content: entry.content,
    html: entry.html,
  };
}

/**
 * Posts the site publishes: drafts dropped, newest filename first. The reverse
 * of the loader's ascending filename order is a stable "newest first" only for
 * date-prefixed names, which is the convention this collection enforces.
 */
export function prepareBlogPosts(entries: CollectionEntry[]): BlogPost[] {
  return entries.filter((entry) => !entry.frontmatter.draft).reverse().map(toBlogPost);
}
