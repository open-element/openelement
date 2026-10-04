/**
 * Runtime-module path resolution for direct bundler input (#868).
 *
 * The browser runtimes are real modules bundled through virtual specifiers.
 * Workspace dev resolves the TypeScript source; the packed payload ships no
 * raw TypeScript, so an installed tarball resolves the staged JavaScript
 * counterpart instead. `relativeSource` is interpreted relative to this
 * module's own directory (src/vite/internal/).
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Resolve a router runtime module path: TypeScript source, else staged .js. */
export function runtimeModulePath(relativeSource: string): string {
  const sourcePath = fileURLToPath(new URL(relativeSource, import.meta.url));
  if (existsSync(sourcePath)) return sourcePath;
  return sourcePath.replace(/\.(?:[cm]?ts|tsx)$/, '.js');
}
