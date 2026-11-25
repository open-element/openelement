/**
 * Generate site sitemap.xml + robots.txt from the route catalog (#1327).
 * Runs in `pnpm run site:build` after the router build: the public index is
 * enumerated from the route catalog without scanning built output or request-time Documents,
 * and never from a hand-synced index.
 * Fails closed: an unenumerable dynamic route or a duplicate fails the build.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_DEFAULT_LOCALE, SITE_LOCALES } from '../site-config.ts';
import { scanSiteRoutes } from './lib/site-route-scan.ts';
import { enumeratePublicRoutes, renderRobotsTxt, renderSitemapXml } from './lib/site-sitemap.ts';
import { articleLastmodByRoute } from './lib/site-lastmod.ts';
import { access, rename, rm, writeFile } from 'node:fs/promises';
import process from 'node:process';
import {
  checkPublishOutput,
  publicTreePaths,
  writePublishOutput,
} from '../../packages/router/src/vite/internal/publish-manifest.ts';

export const SITE_DIST = 'www/dist';
const SITE_ROUTES = 'www/app/routes';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export async function generateSiteSitemap(dist = join(repoRoot, SITE_DIST)): Promise<string[]> {
  const routes = await scanSiteRoutes(join(repoRoot, SITE_ROUTES));
  const { routes: publicRoutes, failures } = enumeratePublicRoutes({
    routes,
    locales: SITE_LOCALES,
    defaultLocale: SITE_DEFAULT_LOCALE,
  });
  if (failures.length > 0) {
    console.error('site sitemap generation failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  // Real source dates, not the build clock: routes without a known content
  // date omit <lastmod> entirely, and the artifact stays byte-stable across
  // UTC days.
  const lastmod = await articleLastmodByRoute(publicRoutes);
  const sitemapPath = join(dist, 'sitemap.xml');
  const robotsPath = join(dist, 'robots.txt');
  await writeFile(
    sitemapPath,
    renderSitemapXml(publicRoutes, {
      lastmod,
      locales: SITE_LOCALES,
      defaultLocale: SITE_DEFAULT_LOCALE,
    }),
  );
  await writeFile(robotsPath, renderRobotsTxt());
  return [sitemapPath, robotsPath];
}

if (import.meta.main) {
  // Build-artifact emitter (writes www/dist only, rebuilt every site:build):
  // no committed output, so no drift check exists or is pretended.
  const written = await generateSiteSitemap();
  console.log(`site sitemap written (${written.join(', ')}).`);
  // The sitemap is the last producer in site:build, after Pagefind and
  // redirects. Seal the final site, including those outputs.
  const dist = join(repoRoot, SITE_DIST);
  const { files } = checkPublishOutput(dist);
  const search = publicTreePaths(join(dist, 'pagefind')).map((name) => `pagefind/${name}`);
  writePublishOutput(dist, [...files.keys(), ...search, '_redirects', 'robots.txt', 'sitemap.xml']);
  const { root } = checkPublishOutput(dist);
  if (process.env['CF_PAGES'] === '1') {
    // Pages' existing upload destination is www/dist. This site deploys
    // statically, so replace its build workspace with the verified upload.
    const serverDir = join(dist, 'server');
    const hasServer = await access(serverDir).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return false;
      },
    );
    if (hasServer) throw new Error('Cloudflare Pages requires a static-only site build.');
    await rm(dist, { recursive: true });
    await rename(root, dist);
  }
}
