/**
 * Workspace package alias mapping for tooling and test harnesses.
 *
 * Deliberately dependency-light (only @std/path): this module is imported by
 * test fixtures that resolve under their own scoped deno.json, where the
 * heavier tools/lib/package-graph.ts graph machinery (typescript-ast, packed
 * element imports) is not part of the fixture's dependency universe.
 */

import { join, toFileUrl } from '@std/path';

/**
 * Returns a Map of specifier → file URL for all local package entries
 * derived from each package's deno.json exports. Used by smoke tests to
 * resolve @openelement/* imports to local source.
 *
 * Entries are ordered by key length descending so that Vite alias resolution
 * matches the most specific specifier first.
 */
export function allPackageAliases(repoRoot: string): Map<string, string> {
  const entries: Array<[string, string]> = [];

  for (const entry of Deno.readDirSync(join(repoRoot, 'packages'))) {
    if (!entry.isDirectory) continue;
    const pkgDir = join(repoRoot, 'packages', entry.name);
    let denoJson: { name?: string; exports?: unknown };
    try {
      denoJson = JSON.parse(Deno.readTextFileSync(join(pkgDir, 'deno.json')));
    } catch {
      continue;
    }
    const { name: packageName, exports: exportsField } = denoJson;
    if (!packageName) continue;

    if (typeof exportsField === 'string') {
      entries.push([packageName, toFileUrl(join(pkgDir, exportsField)).href]);
    } else if (exportsField && typeof exportsField === 'object') {
      for (
        const [subpath, target] of Object.entries(
          exportsField as Record<string, string>,
        )
      ) {
        const specifier = subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`;
        entries.push([specifier, toFileUrl(join(pkgDir, target)).href]);
      }
    }
  }

  entries.sort((a, b) => b[0].length - a[0].length);
  return new Map(entries);
}
