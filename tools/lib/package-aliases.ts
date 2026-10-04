/**
 * Workspace package alias mapping for tooling and test harnesses.
 *
 * Deliberately dependency-light (node:fs + node:path/node:url only): this
 * module is imported by
 * the qualify-harness workspace-alias resolution, where the heavier
 * tools/lib/package-graph.ts graph machinery (typescript-ast, packed element
 * imports) is not part of the harness dependency universe.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Returns a Map of specifier → file URL for all local package entries
 * derived from each package's package.json exports. Used by smoke tests to
 * resolve @openelement/* imports to local source.
 *
 * Entries are ordered by key length descending so that Vite alias resolution
 * matches the most specific specifier first.
 */
export function allPackageAliases(repoRoot: string): Map<string, string> {
  const entries: Array<[string, string]> = [];

  for (const entry of readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const pkgDir = join(repoRoot, 'packages', entry.name);
    // A member without a package.json manifest is not a package (never
    // silently skipped).
    let manifest: { name?: string; exports?: unknown };
    try {
      manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    } catch (error) {
      throw new Error(
        `package-aliases: ${join(pkgDir, 'package.json')} is missing or unparseable`,
        { cause: error },
      );
    }
    const { name: packageName, exports: exportsField } = manifest;
    if (!packageName) continue;

    if (typeof exportsField === 'string') {
      entries.push([packageName, pathToFileURL(join(pkgDir, exportsField)).href]);
    } else if (exportsField && typeof exportsField === 'object') {
      for (const [subpath, target] of Object.entries(exportsField as Record<string, string>)) {
        const specifier = subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`;
        entries.push([specifier, pathToFileURL(join(pkgDir, target)).href]);
      }
    }
  }

  entries.sort((a, b) => b[0].length - a[0].length);
  return new Map(entries);
}
