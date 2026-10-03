/**
 * @openelement/router - Alias normalization helpers.
 *
 * Utilities for converting user-provided alias mappings into Vite's Alias[]
 * shape with absolute, root-relative replacements.
 */

import { basename, dirname, join, resolve } from 'pathe';
import { type Alias } from 'vite';
import { OPENELEMENT_EXPORT_FILES } from './generated-export-files.ts';

function normalizeAliasReplacement(root: string, replacement: string): string {
  // A bare package specifier carries no path separator (e.g. `preact` in
  // `{ react: 'preact' }`): pass it through untouched so Vite resolves it as
  // a module import instead of a root-relative file path (#1067).
  if (!replacement.includes('/') && !replacement.includes('\\')) return replacement;
  return replacement.startsWith('/') ||
    /^[A-Za-z]:/.test(replacement) ||
    replacement.startsWith('file:') ||
    replacement.startsWith('\0')
    ? replacement
    : resolve(root, replacement);
}

function aliasSpecificity(find: unknown): number {
  return typeof find === 'string' ? find.length : 0;
}

/**
 * Sort alias entries by specificity (longer string `find` first) so more
 * specific aliases match before generic ones. Shared by normalizeViteAliases
 * and the client build's serialized-alias pass (#709).
 */
export function sortAliasEntries<T extends Alias>(aliases: T[]): T[] {
  return [...aliases].sort((a, b) => {
    return aliasSpecificity(b.find) - aliasSpecificity(a.find);
  });
}

/** The absolute-path forms an alias replacement must take to be a module id. */
function isAbsoluteModulePath(id: string): boolean {
  return id.startsWith('/') || id.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(id);
}

/**
 * The module path one alias entry rewrites a specifier to — the same matching
 * and rewrite semantics the Vite build applies to `resolve.alias`
 * (@rollup/plugin-alias: string finds match exactly or at a `/` segment
 * boundary, RegExp finds test, and the rewrite is a first-occurrence replace).
 * Returns null when the entry does not claim the specifier, or when the
 * rewrite is not an absolute filesystem path: a bare-specifier or virtual
 * replacement cannot serve as a compile-time module identity, and the caller
 * must keep the declared specifier instead of guessing a path.
 */
export function resolveAliasSourcePath(alias: Alias, specifier: string): string | null {
  if (alias.find instanceof RegExp) {
    if (!alias.find.test(specifier)) return null;
    const rewritten = specifier.replace(alias.find, alias.replacement);
    return isAbsoluteModulePath(rewritten) ? rewritten : null;
  }
  const find = alias.find;
  if (specifier !== find && !specifier.startsWith(`${find}/`)) return null;
  const rewritten = specifier.replace(find, alias.replacement);
  return isAbsoluteModulePath(rewritten) ? rewritten : null;
}

/**
 * Resolve a bare specifier through a Vite alias table, first match wins in
 * table order (the caller passes the same sorted entries the build ships as
 * `resolve.alias`). Returns null when no entry claims the specifier with an
 * absolute-path rewrite.
 */
export function resolveThroughAliases(
  aliases: ReadonlyArray<Alias>,
  specifier: string,
): string | null {
  for (const alias of aliases) {
    const rewritten = resolveAliasSourcePath(alias, specifier);
    if (rewritten !== null) return rewritten;
  }
  return null;
}

interface OpenElementSourceSubpaths {
  rootFile: string;
  files: Record<string, string>;
}

/**
 * Derived from OPENELEMENT_EXPORT_FILES (generated from each package's
 * deno.json "exports") so this table cannot drift from the real export maps
 * again (#733: the hand-written table still listed app's deleted hono entry
 * and element's removed open-element-render/open-element-hydration subpaths).
 *
 * Keys are the full package names ('@openelement/element'); `files` maps each
 * public subpath to its source file relative to the package's src/ directory,
 * resolved against the aliased src/ directory at expansion time.
 */
const OPENELEMENT_SOURCE_SUBPATHS: Record<string, OpenElementSourceSubpaths> = Object.fromEntries(
  Object.entries(OPENELEMENT_EXPORT_FILES).flatMap(([pkg, exports]) => {
    const rootEntry = exports['.'];
    if (!rootEntry) return [];
    const files: Record<string, string> = {};
    for (const [subpath, file] of Object.entries(exports)) {
      if (subpath === '.') continue;
      files[subpath] = file.replace(/^src\//, '');
    }
    return [[`@openelement/${pkg}`, { rootFile: basename(rootEntry), files }]];
  }),
);

function expandOpenElementSourceAliases(aliases: Alias[]): Alias[] {
  const out = [...aliases];
  const existing = new Set(
    out.flatMap((alias) => (typeof alias.find === 'string' ? [alias.find] : [])),
  );

  for (const alias of aliases) {
    if (typeof alias.find !== 'string' || typeof alias.replacement !== 'string') continue;
    const subpaths = OPENELEMENT_SOURCE_SUBPATHS[alias.find];
    if (!subpaths) continue;
    if (!alias.replacement.replace(/\\/g, '/').endsWith(`/src/${subpaths.rootFile}`)) continue;

    const sourceDir = dirname(alias.replacement);
    for (const [subpath, fileName] of Object.entries(subpaths.files)) {
      const find = `${alias.find}/${subpath}`;
      if (existing.has(find)) continue;
      out.push({ find, replacement: join(sourceDir, fileName) });
      existing.add(find);
    }
  }

  return out;
}

/**
 * Normalize a user-provided alias map into Vite Alias entries.
 *
 * Accepts either a record of find -> replacement strings or an existing Alias
 * array. Relative replacements are resolved against `root`. Entries are sorted
 * by specificity so longer/more specific aliases match first.
 */
export function normalizeViteAliases(
  aliases: Record<string, string> | Alias[] | null | undefined,
  root: string,
): Alias[] | undefined {
  if (!aliases) return undefined;
  let normalized: Alias[];
  if (Array.isArray(aliases)) {
    normalized = aliases.map((alias) =>
      typeof alias.replacement === 'string'
        ? { ...alias, replacement: normalizeAliasReplacement(root, alias.replacement) }
        : alias,
    );
  } else {
    normalized = Object.entries(aliases).map(([find, replacement]) => ({
      find,
      replacement: normalizeAliasReplacement(root, replacement),
    }));
  }
  return sortAliasEntries(expandOpenElementSourceAliases(normalized));
}
