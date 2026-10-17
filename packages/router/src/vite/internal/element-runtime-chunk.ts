/**
 * #1544 — one shared element-runtime chunk per client build.
 *
 * Every island module imports the @openelement/element runtime. Without an
 * explicit group the bundler homes that runtime inside whichever island
 * chunk its import reached first, so the runtime floor rides (and moves
 * with) an unrelated island's chunk — and graph shifts can strand per-entry
 * copies. This module owns the grouping identity: the element package root
 * is derived from a module id the client build's own resolver answered (the
 * same identity pass the island manifest joins on), and the group matches
 * exactly the module ids under that root — segment-boundary containment,
 * never a substring hit.
 *
 * Fail-closed (#1471 semantics): every native island chunk statically imports
 * the runtime, and the native generated entry imports it too (lazily, since
 * B2 — a dynamic `import()` edge, never a static one, so a page whose island
 * manifest is empty never requests it). A native build whose emitted graph
 * groups zero runtime modules is therefore a structural failure — it would
 * silently ship per-island runtime copies — and fails with a coded error.
 * The lit entry is element-free by design
 * (#1339), so lit skips that guard — but the group is not lit-inert: the
 * runtime specifier resolves under lit too, and element modules reach a lit
 * graph transitively (router client runtime), so the shared chunk is really
 * produced there; an empty group under lit is merely legal, not expected.
 *
 * {@linkcode findElementRuntimeChunkFile} is the same identity used by the
 * head projection that modulepreloads the chunk on island-bearing pages.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'pathe';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { buildError, ClientBuildErrorCode } from '../../internal/error-codes.ts';
import type { ClientBuildChunk } from '../client-asset-manifest.ts';

/** The emitted shared chunk's name (chunkFileNames appends the hash). */
export const ELEMENT_RUNTIME_CHUNK_NAME = 'element-runtime';

/**
 * The runtime entry the native generated client entry imports — and the
 * package name the identity walk anchors on; they are the same string by
 * the package's own export map.
 */
export const ELEMENT_RUNTIME_ENTRY_SPECIFIER = '@openelement/element';

/** The resolved grouping identity for the element runtime. */
export interface ElementRuntimeIdentity {
  /** Absolute, separator-normalized @openelement/element package root. */
  packageRoot: string;
}

/**
 * Derive the element package root from a module id the client build's
 * resolver answered for {@linkcode ELEMENT_RUNTIME_ENTRY_SPECIFIER}. The
 * walk reads package.json upward until the named package anchors the root —
 * the same realpath for workspace-linked builds (the in-repo element
 * package) and installed ones (`node_modules/@openelement/element`) — and
 * fails closed
 * when no ancestor names the package: a layout the walk cannot anchor would
 * make every later match a guess.
 */
export function resolveElementRuntimeIdentity(resolvedEntryId: string): ElementRuntimeIdentity {
  let dir = dirname(normalizeSeparators(resolvedEntryId.split('?', 1)[0]));
  for (;;) {
    const manifestPath = join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      let name: unknown;
      try {
        name = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }).name;
      } catch {
        // A malformed manifest is not the anchor; keep walking.
      }
      if (name === ELEMENT_RUNTIME_ENTRY_SPECIFIER) return { packageRoot: dir };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw buildError(
        ClientBuildErrorCode.ELEMENT_RUNTIME_IDENTITY_UNRESOLVED,
        `The client build resolved ${ELEMENT_RUNTIME_ENTRY_SPECIFIER} to ${resolvedEntryId}, ` +
          `but no ancestor directory carries a package.json naming ` +
          `"${ELEMENT_RUNTIME_ENTRY_SPECIFIER}" — the element package root cannot be anchored, ` +
          `so the shared runtime chunk would group by guessing`,
      );
    }
    dir = parent;
  }
}

/**
 * The chunk-grouping decision for one module id: the shared runtime chunk's
 * name when the id sits under the resolved package root (query suffixes
 * stripped, separators normalized, prefix boundary exact so a sibling like
 * `element-next/` never matches), undefined otherwise. A null identity —
 * the specifier the identity pass never resolved — matches nothing by
 * construction.
 */
export function elementRuntimeChunkName(
  moduleId: string,
  identity: ElementRuntimeIdentity | null,
): string | undefined {
  if (!identity) return undefined;
  const id = normalizeSeparators(moduleId.split('?', 1)[0]);
  if (!id.startsWith(`${identity.packageRoot}/`)) return undefined;
  return ELEMENT_RUNTIME_CHUNK_NAME;
}

/**
 * The emitted shared chunk's file among a client output file list — build
 * output names (`islands/element-runtime-<hash>.js`) or base-prefixed asset
 * URLs (`/client/islands/element-runtime-<hash>.js`). The grouping name plus
 * the hash `chunkFileNames` appends IS the chunk's identity (#1544): the
 * head projection that modulepreloads the runtime reads its address from the
 * build's own output, never from a hand-maintained list.
 *
 * Exactly one file may carry the identity — a second one is the split layout
 * {@linkcode requireElementRuntimeChunk} rejects, never a first-hit. Zero
 * matches returns undefined: callers that require the chunk fail closed
 * themselves (a lit graph legally carries none).
 */
export function findElementRuntimeChunkFile(files: readonly string[]): string | undefined {
  const matches = files.filter((file) => {
    const base = file.slice(file.lastIndexOf('/') + 1);
    return base.startsWith(`${ELEMENT_RUNTIME_CHUNK_NAME}-`) && base.endsWith('.js');
  });
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The emitted client output carries ${matches.length} ${ELEMENT_RUNTIME_CHUNK_NAME} chunks ` +
        `(${matches.join(', ')}) — #1544 requires exactly one shared runtime chunk, and the ` +
        `per-page modulepreload projection cannot choose between them`,
    );
  }
  return matches[0];
}

/**
 * #1471's fail-closed posture applied to the shared runtime chunk: every
 * native island chunk statically imports the element runtime (and the
 * generated entry imports it lazily), so the emitted graph must home the
 * runtime modules in exactly one chunk and that chunk must be the shared one
 * the group names (the `element-runtime` identity, hash-appended by
 * chunkFileNames). Zero grouped modules means the
 * group never fired (package-root drift, resolver regression); more than one
 * carrying chunk means the runtime split; a single carrying chunk that is
 * not the `element-runtime` chunk means the runtime homed inside an island.
 * All three layouts ship per-island runtime copies or move the runtime floor
 * with an unrelated island, so each fails instead of shipping. A null
 * identity at this point is the same internal ordering bug
 * {@linkcode ClientBuildErrorCode.PACKAGE_IDENTITY_UNRESOLVED} covers: the
 * identity pass did not run before the verdict.
 */
export function requireElementRuntimeChunk(
  chunks: readonly ClientBuildChunk[],
  identity: ElementRuntimeIdentity | null,
): void {
  if (!identity) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The native client graph requires ${ELEMENT_RUNTIME_ENTRY_SPECIFIER}, but the build's ` +
        `identity pass produced no element runtime identity — the shared ` +
        `element-runtime chunk cannot be verified and the build fails instead of guessing`,
    );
  }
  const carrying = chunks.filter((chunk) =>
    [chunk.facadeModuleId ?? '', ...Object.keys(chunk.modules ?? {})].some(
      (rawId) => rawId !== '' && elementRuntimeChunkName(rawId, identity) !== undefined,
    ),
  );
  if (carrying.length === 0) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The native client graph requires ${ELEMENT_RUNTIME_ENTRY_SPECIFIER}, but the emitted ` +
        `client build groups no module under the resolved package root ` +
        `${identity.packageRoot} — the shared element-runtime chunk never fired, so the build ` +
        `would ship the runtime inline per island instead`,
    );
  }
  if (carrying.length > 1) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The emitted client build groups ${ELEMENT_RUNTIME_ENTRY_SPECIFIER} modules across ` +
        `${carrying.length} chunks (${carrying.map((chunk) => chunk.fileName).join(', ')}) — ` +
        `the element runtime must home in exactly one shared chunk, or per-island copies ship ` +
        `and the runtime floor moves with an unrelated island`,
    );
  }
  const shared = carrying[0];
  const base = shared.fileName.slice(shared.fileName.lastIndexOf('/') + 1);
  if (!base.startsWith(`${ELEMENT_RUNTIME_CHUNK_NAME}-`)) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The emitted client build groups the ${ELEMENT_RUNTIME_ENTRY_SPECIFIER} modules inside ` +
        `${shared.fileName}, which is not the shared ${ELEMENT_RUNTIME_CHUNK_NAME} chunk — the ` +
        `runtime floor rides an unrelated island chunk and moves with it instead`,
    );
  }
}

/**
 * B2's own property, asserted on the emitted graph: the client entry must not
 * STATICALLY reach the shared element-runtime chunk.
 *
 * The entry is the one client chunk every page loads, island manifest empty or
 * not, so a static edge from it to the runtime makes the runtime an
 * unconditional download for pages that declared no island — the exact bytes
 * B2 removes. `requireElementRuntimeChunk` above proves the runtime is homed
 * correctly; it says nothing about who can reach it, and a correctly homed
 * runtime is still dragged in when the entry acquires a static edge to any
 * chunk that imports it.
 *
 * Static only, by construction: the walk follows `OutputChunk.imports` and
 * never `dynamicImports`, so the entry's own lazy `import()` of the selected
 * `element-services-*` surface — and every island chunk behind it — is
 * invisible here, which is the point. A closure that reaches the runtime
 * statically is a page floor, and fails.
 *
 * Fail-closed on the guard's own inputs: a build whose entry chunk cannot be
 * identified fails rather than passing vacuously, because "no entry found" and
 * "entry proven clean" are not the same fact. Zero-island apps legitimately
 * carry no runtime at all; the walk then finds no runtime file to compare
 * against and passes, which is the honest answer — there is nothing to reach.
 */
export function requireEntryStaticGraphFreeOfRuntime(
  chunks: readonly ClientBuildChunk[],
  identity: ElementRuntimeIdentity | null,
): void {
  const entries = chunks.filter((chunk) => chunk.isEntry === true);
  if (entries.length === 0) {
    throw buildError(
      ClientBuildErrorCode.ENTRY_STATIC_GRAPH_REACHES_RUNTIME,
      `The emitted client build reports no entry chunk (isEntry), so B2's entry-graph guard ` +
        `cannot prove the runtime is unreachable from the page floor — the guard fails instead ` +
        `of passing vacuously`,
    );
  }
  const runtimeFiles = new Set(
    chunks
      .filter((chunk) =>
        [chunk.facadeModuleId ?? '', ...Object.keys(chunk.modules ?? {})].some(
          (rawId) => rawId !== '' && elementRuntimeChunkName(rawId, identity) !== undefined,
        ),
      )
      .map((chunk) => chunk.fileName),
  );
  if (runtimeFiles.size === 0) return;
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const seen = new Set<string>();
  const queue = entries.map((chunk) => chunk.fileName);
  // Breadth-first parent links, so a failure can name the whole hop sequence
  // that carried the edge instead of only its last hop.
  const parent = new Map<string, string | null>(entries.map((chunk) => [chunk.fileName, null]));
  const pathTo = (file: string): string[] => {
    const path: string[] = [];
    for (let at: string | null = file; at !== null; at = parent.get(at) ?? null) path.unshift(at);
    return path;
  };
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    // The entry chunk itself cannot carry the runtime as a *reached* chunk
    // (that is the same-file case the literal `imports` list never contains),
    // so the comparison starts at the imports.
    for (const imported of byFile.get(file)?.imports ?? []) {
      if (!byFile.has(imported) || seen.has(imported)) continue;
      if (runtimeFiles.has(imported)) {
        throw buildError(
          ClientBuildErrorCode.ENTRY_STATIC_GRAPH_REACHES_RUNTIME,
          `The emitted client entry statically reaches the shared element runtime: ` +
            `${[...pathTo(file), imported].join(' -> ')}. ` +
            `A page whose island manifest is empty would download the runtime anyway (B2), so ` +
            `the build fails instead of shipping the pre-B2 floor`,
        );
      }
      parent.set(imported, file);
      queue.push(imported);
    }
  }
}
