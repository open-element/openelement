/**
 * @openelement/router - the one package-island specifier → module-path
 * resolution.
 *
 * Island identity is joined through the same resolution mechanism the
 * build used, and that mechanism has exactly one source. Both consumers
 * import this module over the same inputs (app root + the same sorted
 * alias table the build ships as `resolve.alias`):
 *
 *   - the client build (`cli/build-client.ts`) resolves each admitted
 *     package island's declared specifier to the real module path its chunk
 *     grouping and its compile-time identity join on;
 *   - the client asset manifest (`vite/client-asset-manifest.ts`) resolves
 *     the same specifiers against the emitted graph before falling back to
 *     the bare-specifier identity rule.
 *
 * The chain mirrors the build resolver's order: the deno.json import map
 * first (its plugin runs `enforce: 'pre'`, ahead of the alias plugin), then
 * the Vite alias table. A specifier with no file target keeps `null`/the
 * declared specifier — never a guessed path.
 *
 * The node-host fallback for npm-installed specifiers resolves through
 * `import.meta.resolve` — the IMPORT condition set, the family the client
 * graph bundles through — not `createRequire().resolve()`, whose require
 * conditions answer a different exports target for dual-condition packages
 * (the ESM entry the build bundles vs. the CJS entry the manifest would
 * then name). The resolved path is a hint, not a verdict: the asset
 * manifest consumes it only when the emitted module graph actually
 * contains it, so a fallback answer that disagrees with the build output
 * cannot be shipped — the join fails closed instead.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Alias } from 'vite';
import { join, resolve } from 'pathe';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { convertImportMapTarget, lookupInDenoJson } from './deno-import-map.ts';
import { resolveThroughAliases } from './alias-utils.ts';

/**
 * The real module path a package-side island's declared specifier resolves
 * to, through the same resolution chain the build's resolver uses (#1471):
 * the deno.json import map (enforce:'pre' runs ahead of the alias plugin),
 * then the Vite alias table the build ships as `resolve.alias` — workspace
 * packages have no import-map entry and resolve purely through those
 * aliases. A specifier with no file target (npm/jsr packages) returns null
 * and keeps the declared specifier as the island's module identity — joined
 * by the exact-match rule in client-asset-manifest.ts, never a substring
 * first-hit.
 */
export function resolvePackageIslandSourcePath(
  root: string,
  modulePath: string,
  aliases: ReadonlyArray<Alias>,
): string | null {
  if (modulePath.startsWith('/') || modulePath.startsWith('.')) {
    return resolve(root, modulePath);
  }
  const mapped = lookupInDenoJson(modulePath, root);
  if (mapped) {
    const converted = convertImportMapTarget(mapped.target, mapped.denoJsonDir);
    if (converted) return converted;
  }
  return resolveThroughAliases(aliases, modulePath);
}

/**
 * The node-host fallback for specifiers the import map and the alias table
 * do not claim: resolve through node_modules with the import condition set
 * (`import.meta.resolve`), the same condition family the client build's
 * bundler resolves with. Node resolution honors the package exports map and
 * resolves symlinks, so the result is the same realpath rolldown emits as
 * the module id. Unresolvable specifiers return undefined and stay on the
 * declared-specifier identity (fail-closed, never guessed).
 */
function resolveNodeModulesImportPath(root: string, specifier: string): string | undefined {
  try {
    const resolved = import.meta.resolve(
      specifier,
      pathToFileURL(join(root || process.cwd(), 'package.json')).href,
    );
    if (!resolved.startsWith('file:')) return undefined;
    return normalizeSeparators(fileURLToPath(resolved));
  } catch {
    return undefined;
  }
}

/**
 * The client asset manifest's identity resolution for one island's declared
 * module specifier: the same chain {@linkcode resolvePackageIslandSourcePath}
 * runs for the build side — over the same sorted alias array — and, only
 * when that chain has no file target, the import-condition node_modules
 * fallback above. Relative and absolute identities (local islands) resolve
 * on the build side already and never enter node resolution. The caller
 * must pass the same alias entries the build ships as `resolve.alias` —
 * same array, same order — so the two resolutions cannot disagree by
 * construction (P6: one source, no parallel mechanism).
 */
export function resolveIslandIdentityPath(
  root: string,
  identity: string,
  aliases: ReadonlyArray<Alias>,
): string | undefined {
  if (identity.startsWith('.') || identity.startsWith('/') || identity.includes('\0')) {
    return undefined;
  }
  const viaBuildChain = resolvePackageIslandSourcePath(root, identity, aliases);
  if (viaBuildChain) return viaBuildChain;
  return resolveNodeModulesImportPath(root, identity);
}
