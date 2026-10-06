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
 * Fail-closed (#1471 semantics): the native renderer's generated entry
 * statically imports the runtime (entry-client-codegen's importsBlock), so
 * a native build whose emitted graph groups zero runtime modules is a
 * structural failure — it would silently ship per-island runtime copies —
 * and fails with a coded error. The lit entry is element-free by design
 * (#1339), so lit skips that guard — but the group is not lit-inert: the
 * runtime specifier resolves under lit too, and element modules reach a lit
 * graph transitively (router client runtime), so the shared chunk is really
 * produced there; an empty group under lit is merely legal, not expected.
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
 * #1471's fail-closed posture applied to the shared runtime chunk: the
 * native generated entry statically imports the element runtime, so the
 * emitted graph must home the runtime modules in exactly one chunk and that
 * chunk must be the shared one the group names (the `element-runtime`
 * identity, hash-appended by chunkFileNames). Zero grouped modules means the
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
      `The native client entry statically imports ${ELEMENT_RUNTIME_ENTRY_SPECIFIER}, but the ` +
        `build's identity pass produced no element runtime identity — the shared ` +
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
      `The native client entry statically imports ${ELEMENT_RUNTIME_ENTRY_SPECIFIER}, but the ` +
        `emitted client build groups no module under the resolved package root ` +
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
