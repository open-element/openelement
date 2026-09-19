/**
 * Generate site sitemap.xml + robots.txt from the route catalog (#1327).
 * Runs in `deno task site:build` after the router build: the public index is
 * enumerated from the route catalog plus the blog collection loaded straight
 * from source — never by scanning built output or request-time Documents,
 * and never from a hand-synced index.
 * Fails closed: an unenumerable dynamic route or a duplicate fails the build.
 */
import { fromFileUrl, join } from '@std/path';
import { SITE_LOCALES } from '../site-config.ts';
import { loadCollectionData } from '../lib/content.ts';
import { blogCollection, prepareBlogPosts } from '../lib/blog.ts';
import { scanSiteRoutes } from './lib/site-route-scan.ts';
import { enumeratePublicRoutes, renderRobotsTxt, renderSitemapXml } from './lib/site-sitemap.ts';

export const SITE_DIST = 'www/dist';
const SITE_ROUTES = 'www/app/routes';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const siteRoot = join(repoRoot, 'www', '');

export async function generateSiteSitemap(
  dist = join(repoRoot, SITE_DIST),
): Promise<string[]> {
  const blogOptions = { ...blogCollection, contentDir: join(siteRoot, blogCollection.contentDir) };
  const blogPostRoutes = prepareBlogPosts(await loadCollectionData('blog', blogOptions)).map(
    (post) => `/blog/${post.slug}`,
  );
  const routes = await scanSiteRoutes(join(repoRoot, SITE_ROUTES));
  const { routes: publicRoutes, failures } = enumeratePublicRoutes({
    routes,
    blogPostRoutes,
    locales: SITE_LOCALES,
  });
  if (failures.length > 0) {
    console.error('site sitemap generation failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  const today = new Date().toISOString().split('T')[0];
  const sitemapPath = join(dist, 'sitemap.xml');
  const robotsPath = join(dist, 'robots.txt');
  await Deno.writeTextFile(sitemapPath, renderSitemapXml(publicRoutes, { today }));
  await Deno.writeTextFile(robotsPath, renderRobotsTxt());
  return [sitemapPath, robotsPath];
}

if (import.meta.main) {
  // Build-artifact emitter (writes www/dist only, rebuilt every site:build):
  // no committed output, so no drift check exists or is pretended.
  const written = await generateSiteSitemap();
  console.log(`site sitemap written (${written.join(', ')}).`);
}
