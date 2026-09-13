/**
 * Generate site sitemap.xml + robots.txt from the route catalog (Beta.2.2,
 * #1327). Runs in `deno task site:build` after the router build: the public
 * index is enumerated from the route catalog and the drift-gated content
 * graph — never by scanning built output or request-time Documents.
 * Fails closed: an unenumerable dynamic route or a duplicate fails the build.
 */
import { join } from '@std/path';
import { scanSiteRoutes } from './lib/site-route-scan.ts';
import type { ContentGraph } from './lib/content-graph.ts';
import {
  enumeratePublicRoutes,
  renderRobotsTxt,
  renderSitemapXml,
  SITE_SITEMAP_EXCLUDE,
} from './lib/site-sitemap.ts';

export const SITE_DIST = 'apps/site/dist';
const SITE_ROUTES = 'apps/site/app/routes';
const CONTENT_GRAPH = 'apps/site/app/data/_generated-content-graph.json';
const SITE_LOCALES = ['en', 'zh'] as const;

export async function generateSiteSitemap(dist = SITE_DIST): Promise<string[]> {
  const graph = JSON.parse(await Deno.readTextFile(CONTENT_GRAPH)) as ContentGraph;
  const blogPostRoutes = graph.entries
    .filter((entry) => entry.kind === 'blog-post' && entry.route !== undefined)
    .map((entry) => entry.route as string);
  const routes = await scanSiteRoutes(SITE_ROUTES);
  const { routes: publicRoutes, failures } = enumeratePublicRoutes({
    routes,
    blogPostRoutes,
    locales: SITE_LOCALES,
    exclude: SITE_SITEMAP_EXCLUDE,
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
  const written = await generateSiteSitemap();
  console.log(`site sitemap written (${written.join(', ')}).`);
}
