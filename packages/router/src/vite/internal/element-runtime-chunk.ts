/**
 * Resolve the Element runtime from the client build's module graph (#1544).
 * The anchored package excludes the document-services closure. The bundler
 * groups the remaining modules by the dynamic entries that need them.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'pathe';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { buildError, ClientBuildErrorCode } from '../../internal/error-codes.ts';
import type { ClientBuildChunk } from '../client-asset-manifest.ts';

/** The emitted shared chunk's name (chunkFileNames appends the hash). */
export const ELEMENT_RUNTIME_CHUNK_NAME = 'element-runtime';

/**
 * The package's public entry the identity pass resolves to anchor its root.
 */
export const ELEMENT_RUNTIME_ENTRY_SPECIFIER = '@openelement/element';

/** The resolved grouping identity for the element runtime. */
export interface ElementRuntimeIdentity {
  /** Absolute, separator-normalized @openelement/element package root. */
  packageRoot: string;
  /** Resolved static graph of the narrow document-services entry. */
  documentServices?: ReadonlySet<string>;
}

/** Resolve the document-services closure using the bundler's own module graph. */
export function documentServiceModuleIds(
  root: string,
  getModuleInfo: (id: string) => { importedIds: readonly string[] } | null,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const ids = [root];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(...(getModuleInfo(id)?.importedIds ?? []));
  }
  return new Set([...seen].map(normalizeModuleId));
}

function normalizeModuleId(id: string): string {
  return normalizeSeparators(id.split('?', 1)[0]);
}

/** Claim shared dependencies before the broader island-runtime group captures them. */
export function isDocumentServiceModule(
  id: string,
  identity: ElementRuntimeIdentity | null,
): boolean {
  return identity?.documentServices?.has(normalizeModuleId(id)) === true;
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
          `so the runtime groups cannot be verified`,
      );
    }
    dir = parent;
  }
}

/**
 * The group name when the module sits under the resolved package root
 * (query suffixes
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
  const id = normalizeModuleId(moduleId);
  if (!id.startsWith(`${identity.packageRoot}/`)) return undefined;
  if (identity.documentServices?.has(id)) return undefined;
  return ELEMENT_RUNTIME_CHUNK_NAME;
}

/** Identify runtime chunks without assuming chunk names or a fixed count. */
export function collectElementRuntimeChunks(
  chunks: readonly ClientBuildChunk[],
  identity: ElementRuntimeIdentity | null,
  required = true,
): ReadonlySet<string> {
  if (!identity) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The client build produced no identity for ${ELEMENT_RUNTIME_ENTRY_SPECIFIER}`,
    );
  }
  const owners = new Map<string, string>();
  for (const chunk of chunks) {
    for (const id of Object.keys(chunk.modules ?? {})) {
      if (elementRuntimeChunkName(id, identity) === undefined) continue;
      const moduleId = normalizeSeparators(id);
      const owner = owners.get(moduleId);
      if (owner !== undefined && owner !== chunk.fileName) {
        throw buildError(
          ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
          `Element runtime module ${moduleId} was emitted in both ${owner} and ${chunk.fileName}`,
        );
      }
      owners.set(moduleId, chunk.fileName);
    }
  }
  if (required && owners.size === 0) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The generated island graph has no runtime module under ${identity.packageRoot}`,
    );
  }
  return new Set(owners.values());
}

/** Project statically reached runtime dependencies to emitted asset URLs. */
export function elementRuntimePreloads(
  chunks: readonly ClientBuildChunk[],
  runtimeFiles: ReadonlySet<string>,
  clientBase: string,
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, readonly string[]>();
  if (runtimeFiles.size === 0) return result;
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const url = (file: string): string => `${clientBase}client/${file}`;
  for (const chunk of chunks) {
    const seen = new Set([chunk.fileName]);
    const pending = [...(chunk.imports ?? [])];
    const preloads: string[] = [];
    for (const file of pending) {
      if (seen.has(file)) continue;
      seen.add(file);
      if (runtimeFiles.has(file)) preloads.push(url(file));
      pending.push(...(byFile.get(file)?.imports ?? []));
    }
    if (preloads.length > 0) result.set(url(chunk.fileName), preloads);
  }
  return result;
}

/** B2: no document entry may statically reach island runtime modules. */
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
  const queue = entries.map((chunk) => chunk.fileName);
  // Breadth-first parent links, so a failure can name the whole hop sequence
  // that carried the edge instead of only its last hop.
  const parent = new Map<string, string | null>(entries.map((chunk) => [chunk.fileName, null]));
  const pathTo = (file: string): string[] => {
    const path: string[] = [];
    for (let at: string | null = file; at !== null; at = parent.get(at) ?? null) path.unshift(at);
    return path;
  };
  for (const file of queue) {
    if (runtimeFiles.has(file)) {
      throw buildError(
        ClientBuildErrorCode.ENTRY_STATIC_GRAPH_REACHES_RUNTIME,
        `The emitted client entry statically reaches the shared element runtime: ` +
          `${pathTo(file).join(' -> ')}. ` +
          `A page whose island manifest is empty would download the runtime anyway (B2), so ` +
          `the build fails instead of shipping the pre-B2 floor`,
      );
    }
    for (const imported of byFile.get(file)?.imports ?? []) {
      if (!byFile.has(imported) || parent.has(imported)) continue;
      parent.set(imported, file);
      queue.push(imported);
    }
  }
}
