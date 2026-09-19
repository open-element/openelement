/**
 * Per-route source dates for sitemap <lastmod>.
 *
 * The canonical source is `www/lib/content-dates.json` (the committed
 * manifest that `check-content-dates.ts` recomputes from Git history). The
 * route -> article mapping mirrors `articleRoutePath` used by the pages
 * themselves: the collection overview article lives at the collection root
 * and every other article at `<basePath>/<slug>`, with locale-prefixed
 * routes taking that locale's stamp. Routes without a known source date are
 * absent from the map so the renderer omits <lastmod> instead of guessing.
 */
import { fromFileUrl, join } from '@std/path';
import { SITE_DEFAULT_LOCALE, SITE_LOCALES } from '../../site-config.ts';

const repoRoot = fromFileUrl(new URL('../../../', import.meta.url));

interface ContentDatesManifest {
  articles: Record<string, { en: string; zh: string }>;
}

/** The article source behind a locale-stripped route, or null. */
function articleFor(route: string): string | null {
  if (route === '/architecture') return 'architecture/architecture';
  const guide = /^\/guide\/([a-z0-9-]+)$/.exec(route);
  if (guide) return `guide/${guide[1]}`;
  const architecture = /^\/architecture\/([a-z0-9-]+)$/.exec(route);
  if (architecture) return `architecture/${architecture[1]}`;
  return null;
}

export async function articleLastmodByRoute(
  routes: readonly string[],
  manifestFile = join(repoRoot, 'www/lib/content-dates.json'),
): Promise<Map<string, string>> {
  const manifest = JSON.parse(await Deno.readTextFile(manifestFile)) as ContentDatesManifest;
  const out = new Map<string, string>();
  for (const route of routes) {
    let path = route;
    let locale = SITE_DEFAULT_LOCALE;
    for (const candidate of SITE_LOCALES) {
      if (candidate === SITE_DEFAULT_LOCALE) continue;
      if (path === `/${candidate}`) {
        path = '/';
        locale = candidate;
        break;
      }
      if (path.startsWith(`/${candidate}/`)) {
        path = path.slice(candidate.length + 1);
        locale = candidate;
        break;
      }
    }
    const article = articleFor(path);
    if (!article) continue;
    const stamp = manifest.articles[article]?.[locale];
    if (stamp && stamp !== 'uncommitted') out.set(route, stamp);
  }
  return out;
}
