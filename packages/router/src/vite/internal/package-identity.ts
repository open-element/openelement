/**
 * Package identity by the nearest `package.json`, walking up — the ONE rule
 * both admission consumers share: the scan-time derivation attributes a
 * package-owned element module to its owner package, and the style-asset walk
 * reports an imported package by the same identity. A PACKAGE-IDENTITY test,
 * never a path test: a dependency installed under `node_modules/` inside the
 * project root (the ordinary install layout, the pnpm store layout) and a
 * workspace link resolve to the dependency's own name alike.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname as posixDirname, join } from 'pathe';

/** The name of the nearest enclosing package.json, walking up from `file`. */
export function owningPackageName(file: string): string | undefined {
  return packageNameAt(posixDirname(file));
}

/**
 * The nearest enclosing package root whose package.json NAMES `packageName`,
 * walking up from `file` — the directory the derivation anchors a manifest
 * load at, so the walked module's own install tree (workspace link, pnpm
 * store, plain tarball dir) answers without any name-based resolution.
 */
export function owningPackageRoot(file: string, packageName: string): string | undefined {
  let current = posixDirname(file);
  for (let depth = 0; depth < 12; depth++) {
    const manifest = join(current, 'package.json');
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
        if (parsed.name === packageName) return current;
      } catch {
        // An unreadable package.json is not a package root; keep walking.
      }
    }
    const parent = posixDirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/** The package name of the nearest package.json at or above `dir`. */
export function packageNameAt(dir: string): string | undefined {
  let current = dir;
  for (let depth = 0; depth < 12; depth++) {
    const manifest = join(current, 'package.json');
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
        if (typeof parsed.name === 'string' && parsed.name !== '') return parsed.name;
      } catch {
        // An unreadable package.json is not a package root; keep walking.
      }
    }
    const parent = posixDirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}
