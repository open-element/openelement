/**
 * Site-owned route discovery for the site sitemap (1.0.0-alpha.1): enumerate
 * www/app/routes files into { path, type } catalog entries. This replaces
 * the retired adapter-vite internal route scanner — the sitemap must never
 * import a deleted adapter or a Router internal path. Conventions: index.tsx
 * maps to its directory, [param].tsx maps to :param, every route file is a
 * page; dynamic enumeration stays fail-closed in enumeratePublicRoutes.
 */
import { join } from '@std/path';
import type { SiteRouteCatalogEntry } from './site-sitemap.ts';

function fileToRoutePath(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.tsx?$/, '');
  const segments = withoutExtension.split('/');
  const mapped: string[] = [];
  for (const segment of segments) {
    if (segment === 'index') continue;
    const dynamic = /^\[([A-Za-z0-9_]+)\]$/.exec(segment);
    mapped.push(dynamic ? `:${dynamic[1]}` : segment);
  }
  return `/${mapped.join('/')}`;
}

/** Scan a routes directory into sitemap catalog entries (sorted by path). */
export async function scanSiteRoutes(routesDir: string): Promise<SiteRouteCatalogEntry[]> {
  const entries: SiteRouteCatalogEntry[] = [];
  async function walk(dir: string, relative: string): Promise<void> {
    for await (const dirEntry of Deno.readDir(dir)) {
      const relativePath = relative === '' ? dirEntry.name : `${relative}/${dirEntry.name}`;
      if (dirEntry.isDirectory) {
        await walk(join(dir, dirEntry.name), relativePath);
      } else if (!dirEntry.isSymlink && /\.tsx?$/.test(dirEntry.name)) {
        // Symlinks are skipped on purpose: a linked route file would resolve
        // outside the scanned tree.
        entries.push({ path: fileToRoutePath(relativePath), type: 'page' });
      }
    }
  }
  await walk(routesDir, '');
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}
