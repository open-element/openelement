/**
 * Generate the site blog feed (www/dist/blog/rss.xml, #1441).
 * Runs in `deno task site:build` right after the sitemap: the items are the
 * same source-loaded blog collection the /blog routes and the sitemap
 * enumerate — drafts dropped, newest first — never scanned out of built
 * output and never hand-synced.
 * Fails closed: a post that cannot carry a permalink or an RFC 822 date stops
 * the build instead of dropping out of the feed.
 */
import { fromFileUrl, join } from '@std/path';
import { loadCollectionData } from '../../www/lib/content.ts';
import { blogCollection, prepareBlogPosts } from '../../www/lib/blog.ts';
import { feedFailures, renderBlogFeedXml, SITE_FEED_PATH } from '../lib/site-rss.ts';

export const SITE_DIST = 'www/dist';

const siteRoot = fromFileUrl(new URL('../../www/', import.meta.url));

export async function generateSiteRss(dist = SITE_DIST): Promise<string> {
  const blogOptions = { ...blogCollection, contentDir: join(siteRoot, blogCollection.contentDir) };
  const posts = prepareBlogPosts(await loadCollectionData('blog', blogOptions));
  const failures = feedFailures(posts);
  if (failures.length > 0) {
    console.error('site rss generation failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  const feedPath = join(dist, SITE_FEED_PATH);
  await Deno.writeTextFile(feedPath, renderBlogFeedXml(posts));
  return feedPath;
}

if (import.meta.main) {
  // Build-artifact emitter (writes www/dist only, rebuilt every site:build):
  // no committed output, so no drift check exists or is pretended.
  const written = await generateSiteRss();
  console.log(`site rss written (${written}).`);
}
