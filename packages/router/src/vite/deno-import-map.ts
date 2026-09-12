/**
 * @openelement/router - Deno import-map resolution for Vite builds
 *
 * A project's import map is part of its build contract: a bare specifier that
 * Deno resolves at dev time (`deno task dev`, `deno test`, the editor) must
 * resolve identically inside the Vite builds, otherwise development and the
 * build disagree about what an app imports.
 *
 * `workspace-alias.ts` covers the workspace packages themselves. This module
 * covers everything else the project maps in the nearest `deno.json` that
 * encloses the app root — site-local aliases such as `@openelement/generated/*`
 * in www, or a consumer's own `@acme/components` entry.
 *
 * Both build phases consume it: the client bundle (`build-client.ts`, Phase 2)
 * and the SSR/SSG bundle (`build-ssg.ts`, Phase 3). They previously diverged —
 * only the client phase resolved import maps, so an app whose routes import a
 * mapped specifier built its client bundle successfully and then failed static
 * generation with `Rolldown failed to resolve import`.
 *
 * Uses sync Node APIs so the resolution can run inside Vite's synchronous
 * plugin hooks.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { createLogger } from '@openelement/element';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { parseJsonc } from './internal/jsonc.ts';

const log = createLogger('deno-import-map');

export interface ImportMapResolution {
  /** Raw import-map target (may be a relative path, `file://`, `npm:`, `jsr:`). */
  target: string;
  /** Directory of the deno.json that owned the mapping. */
  denoJsonDir: string;
}

/** Workspace root derived from this module's location (packages/router/src/vite/).
 * Only valid in the local monorepo layout. In npm/JSR consumers, returns null. */
const WORKSPACE_ROOT: string | null = (() => {
  if (!import.meta.url.startsWith('file:')) return null;
  try {
    const root = normalizeSeparators(fileURLToPath(new URL('../../../..', import.meta.url)));
    if (!existsSync(join(root, 'packages', 'element', 'deno.json'))) return null;
    return root;
  } catch (e) {
    log.warn('Unable to resolve workspace root, falling back to null', e);
    return null;
  }
})();

/** Check a single directory for a deno.json with the given import. */
function tryDenoJsonDir(id: string, dir: string): ImportMapResolution | null {
  const denoJsonPath = join(dir, 'deno.json');
  if (!existsSync(denoJsonPath)) return null;
  const raw = readFileSync(denoJsonPath, 'utf-8');
  // #708: shared JSONC parser (single implementation with workspace-alias.ts).
  // Handles mid-line // comments, /* */ blocks, string literals, and trailing commas.
  const denoJson = parseJsonc(raw);
  if (!denoJson) {
    log.warn('Invalid deno.json JSON, skipping');
    return null; // Invalid JSON — skip this deno.json
  }
  const imports = denoJson.imports as Record<string, string> | undefined;
  if (!imports) return null;
  // Exact match
  if (imports[id]) return { target: imports[id], denoJsonDir: dir };
  // Prefix/subpath matching (trailing slash)
  for (const [key, value] of Object.entries(imports)) {
    if (key.endsWith('/') && id.startsWith(key)) {
      return { target: value + id.slice(key.length), denoJsonDir: dir };
    }
  }
  return null;
}

/**
 * Look up a bare specifier in a deno.json import map.
 * Walks up directory tree to find workspace-level deno.json as fallback.
 * Returns { target, denoJsonDir } so relative paths can be resolved correctly.
 */
export function lookupInDenoJson(id: string, root: string): ImportMapResolution | null {
  const denoJsonDirs = new Set<string>();
  let dir = resolve(root);

  // Walk up from consumer root
  while (!denoJsonDirs.has(dir)) {
    denoJsonDirs.add(dir);
    const found = tryDenoJsonDir(id, dir);
    if (found) return found;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  // Also try workspace root (module-relative, for monorepo dev / testing)
  if (WORKSPACE_ROOT && !denoJsonDirs.has(WORKSPACE_ROOT)) {
    const found = tryDenoJsonDir(id, WORKSPACE_ROOT);
    if (found) return found;
  }

  return null;
}

/**
 * Convert a Deno import map target to a resolvable Vite path.
 * - file:// URLs → absolute filesystem path
 * - Relative paths (./) → resolved relative to denoJsonDir
 * - npm:, jsr: → null (handled by node_modules)
 */
export function convertImportMapTarget(target: string, denoJsonDir: string): string | null {
  if (target.startsWith('file://')) {
    try {
      return normalizeSeparators(fileURLToPath(target));
    } catch (e) {
      log.warn('Unable to convert file:// import-map target, skipping', e);
      return null;
    }
  }
  // Relative path — resolve relative to the deno.json directory
  if (target.startsWith('./') || target.startsWith('../')) {
    return normalizeSeparators(resolve(denoJsonDir, target));
  }
  // npm:, jsr: — let Vite/Rolldown handle these normally
  return null;
}

/**
 * Vite plugin resolving bare specifiers through the project's deno.json import
 * map. `enforce: 'pre'` keeps it ahead of Vite's own bare-specifier handling;
 * npm:/jsr: targets return null so node_modules resolution is unaffected.
 */
export function createDenoImportMapResolvePlugin(root: string): Plugin {
  return {
    name: 'open:deno-import-map-resolve',
    enforce: 'pre',
    async resolveId(id, importer) {
      // Only handle bare specifiers (no relative imports, no absolute paths)
      if (id.startsWith('.') || id.startsWith('/') || id.startsWith('file:')) {
        return null;
      }

      // Try deno.json import map — walks up from root to find
      // workspace-level deno.json as fallback for monorepo dev.
      const result = lookupInDenoJson(id, root);
      if (!result) return null;

      // Only handle file:// and relative targets (workspace-local dev mappings).
      // npm:, jsr: → return null, let node_modules handle them.
      const resolved = convertImportMapTarget(result.target, result.denoJsonDir);
      if (!resolved) return null;

      return await this.resolve(resolved, importer, { skipSelf: true });
    },
  };
}
