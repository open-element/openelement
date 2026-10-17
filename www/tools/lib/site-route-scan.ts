/**
 * Site-owned route discovery for the site sitemap (1.0.0-alpha.1): enumerate
 * www/app/routes files into { path, type } catalog entries. This replaces
 * the retired adapter-vite internal route scanner — the sitemap must never
 * import a deleted adapter or a Router internal path. Conventions: index.tsx
 * maps to its directory, [param].tsx maps to :param, every route file is a
 * page; dynamic enumeration stays fail-closed in enumeratePublicRoutes.
 */
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { fileToRoutePath } from '../../lib/route-path.ts';
import type { SiteRouteCatalogEntry } from './site-sitemap.ts';

/**
 * Scan-local projection over the shared fileToRoutePath rule (CL-36: no
 * second spelling of the index-vanish/extension/static-segment rule here).
 * Dynamic `[param]` segments project to `:param` placeholders the sitemap
 * enumeration resolves explicitly; a file the shared rule cannot map is a
 * fail-closed error, never a silently skipped route.
 */
function scanRoutePath(relativePath: string): string {
  const mapped = fileToRoutePath(relativePath, { dynamic: (name) => `:${name}` });
  if (mapped === undefined)
    throw new Error(`site route scan cannot map route file: ${relativePath}`);
  return mapped;
}

/** Scan a routes directory into sitemap catalog entries (sorted by path). */
export async function scanSiteRoutes(routesDir: string): Promise<SiteRouteCatalogEntry[]> {
  const entries: SiteRouteCatalogEntry[] = [];
  async function walk(dir: string, relative: string): Promise<void> {
    for (const dirEntry of await readdir(dir, { withFileTypes: true })) {
      const relativePath = relative === '' ? dirEntry.name : `${relative}/${dirEntry.name}`;
      if (dirEntry.isDirectory()) {
        await walk(join(dir, dirEntry.name), relativePath);
      } else if (!dirEntry.isSymbolicLink() && /\.tsx?$/.test(dirEntry.name)) {
        // Symlinks are skipped on purpose: a linked route file would resolve
        // outside the scanned tree.
        entries.push({ path: scanRoutePath(relativePath), type: 'page' });
      }
    }
  }
  await walk(routesDir, '');
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}
