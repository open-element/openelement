/**
 * B2 gap (a) — the eager home of Vite's build-injected runtime helpers.
 *
 * THE PROBLEM. Vite's build injects a preload helper as a real module whenever
 * a module contains its own dynamic `import()`: the helper preloads the async
 * chunk's dependencies and de-duplicates that work through one module-level
 * `seen` map, so the bundler must home it in exactly ONE chunk that every
 * caller imports. Which chunk that is, is a reachability heuristic. When any
 * ISLAND module carries a nested dynamic import of its own (www's
 * `open-search` does), the helper lands inside that island chunk — and the
 * generated client entry, which preloads its own island imports, then acquires
 * a STATIC edge to that island chunk purely to reach the helper. The island
 * chunk statically imports the shared `element-runtime-<hash>.js` (#1544), so
 * the runtime comes back transitively and a page whose island manifest is
 * empty downloads it anyway. Measured on the real `www` build before this
 * module existed: `entry.imports` was `["_island-open-search-…"]`, whose own
 * `imports` carried `_element-runtime-…` — B2's lazy entry surface was intact
 * and the reachable graph still contained the runtime.
 *
 * THE RULE. Vite declares the identity of its injected helpers as module ids
 * and matches them itself by exact id (Vite's asset-URL plugin excludes
 * `\0vite/preload-helper.js` with `exactRegex`), so the identity is
 * addressable by contract, never by chunk-name or content guessing. Every
 * injected helper id is grouped into ONE dedicated, eagerly-reachable
 * `vite-helper` chunk:
 *
 *   - the entry imports the helper chunk directly, so its static graph is
 *     `{client.js, vite-helper-<hash>.js}` and no island chunk;
 *   - every island chunk imports that same helper chunk, so the helper stays
 *     a single instance (the `seen` map is only correct while it is one) and
 *     the island chunks keep sharing one `element-runtime` chunk;
 *   - the helper chunk imports nothing, so it cannot re-enter the runtime.
 *
 * This is the same rule #1544 already applies to the element runtime — shared
 * infrastructure that many chunks need must not be homed inside one
 * lazily-loaded island chunk — applied to the same class of module. It is a
 * bundler contract, not a coincidence: `manualChunks` (native) and
 * `codeSplitting.groups` (lit) are the documented per-module to per-chunk
 * assignment surfaces, and the match key is Vite's own declared id. Nothing
 * here depends on a group name colliding with an entry chunk's name, which is
 * the variant this module deliberately does NOT use.
 *
 * WHY IT FAILS CLOSED. The grouping above is only as durable as Vite's id. If
 * a future Vite renames it, the group stops matching and the pre-B2 graph
 * silently returns. Two guards close that hole, both in the client build:
 * {@linkcode ./vite-helper-chunk.ts | requireViteHelperChunk} fails when the
 * helper modules are present but not homed in the one `vite-helper` chunk, and
 * `requireEntryStaticGraphFreeOfRuntime` (`element-runtime-chunk.ts`) fails
 * when the emitted entry statically reaches the runtime at all. The second is
 * the property itself and holds regardless of what the helper is called.
 */

import { buildError, ClientBuildErrorCode } from '../../internal/error-codes.ts';
import type { ClientBuildChunk } from '../client-asset-manifest.ts';

/**
 * Vite's own module id for the injected preload helper — the string Vite
 * declares as `preloadHelperId` and matches with `exactRegex` when it excludes
 * the helper from its asset-URL rewrite. Exact equality on this id is the
 * match contract; a prefix or substring test would claim unrelated virtual
 * modules.
 */
export const VITE_PRELOAD_HELPER_ID = '\0vite/preload-helper.js';

/** The dedicated eager chunk's name (`chunkFileNames` appends the hash). */
export const VITE_HELPER_CHUNK_NAME = 'vite-helper';

/**
 * The chunk-grouping decision for one module id: the shared eager helper
 * chunk's name when the id IS one of Vite's injected helper modules, undefined
 * otherwise. Exact identity — the id Vite itself declares — never a pattern.
 */
export function viteHelperChunkName(moduleId: string): string | undefined {
  return moduleId === VITE_PRELOAD_HELPER_ID ? VITE_HELPER_CHUNK_NAME : undefined;
}

/**
 * The emitted helper chunk's file among a client output file list — the
 * grouping name plus the hash `chunkFileNames` appends, the same address
 * contract {@linkcode ./element-runtime-chunk.ts | findElementRuntimeChunkFile}
 * reads for the runtime. Exactly one file may carry the identity; a second one
 * is a split the callers below reject rather than take a first hit.
 */
export function findViteHelperChunkFile(files: readonly string[]): string | undefined {
  return files.find((file) => {
    const base = file.slice(file.lastIndexOf('/') + 1);
    return base.startsWith(`${VITE_HELPER_CHUNK_NAME}-`) && base.endsWith('.js');
  });
}

/**
 * The fail-closed half of the grouping rule: when the emitted graph carries
 * Vite's injected helper modules at all, they must be grouped into exactly one
 * chunk and that chunk must be the `vite-helper` chunk. Zero matches is legal
 * and means the graph needed no helper (no dynamic import anywhere) — the
 * grouping rule had nothing to claim. One match in any other chunk is the
 * layout that hands the entry a static island edge (and the runtime with it).
 * More than one match means the helper's single `seen` instance was split
 * across chunks, so its de-duplication silently stops working — a different
 * defect with the same cause, and equally unshippable.
 */
export function requireViteHelperChunk(chunks: readonly ClientBuildChunk[]): void {
  const carrying = chunks.filter((chunk) =>
    [chunk.facadeModuleId ?? '', ...Object.keys(chunk.modules ?? {})].some(
      (rawId) => rawId !== '' && viteHelperChunkName(rawId) !== undefined,
    ),
  );
  if (carrying.length === 0) return;
  if (carrying.length > 1) {
    throw buildError(
      ClientBuildErrorCode.VITE_HELPER_CHUNK_MISSING,
      `The emitted client build groups ${VITE_PRELOAD_HELPER_ID} across ${carrying.length} chunks ` +
        `(${carrying.map((chunk) => chunk.fileName).join(', ')}) — the helper's single shared ` +
        `seen map is split, so its preload de-duplication silently stops working and the entry ` +
        `can no longer be proven free of an island chunk`,
    );
  }
  const helper = carrying[0];
  const base = helper.fileName.slice(helper.fileName.lastIndexOf('/') + 1);
  if (base.startsWith(`${VITE_HELPER_CHUNK_NAME}-`)) return;
  throw buildError(
    ClientBuildErrorCode.VITE_HELPER_CHUNK_MISSING,
    `The emitted client build homes Vite's injected ${VITE_PRELOAD_HELPER_ID} inside ` +
      `${helper.fileName} instead of the shared ${VITE_HELPER_CHUNK_NAME} chunk — the client ` +
      `entry imports the helper, so this gives the entry a static edge to whatever chunk that ` +
      `is (an island chunk carries the element runtime with it, B2 gap (a))`,
  );
}
