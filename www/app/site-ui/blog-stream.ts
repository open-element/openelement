/**
 * The visible blog stream shared by the blog routes.
 *
 * Dispatches only (ADR posts are decision records, not public dispatches),
 * newest date first. One home for the ordering the blog index and the
 * post-page prev/next navigation must agree on — the index's featured band
 * and every post's neighbours come from this one list.
 */
import { posts } from '#generated/blog-data';

/** Published dispatches (ADRs excluded), newest first. */
export function visibleBlogPosts() {
  return posts
    .filter((post) => post.frontmatter.type !== 'adr')
    .sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));
}
