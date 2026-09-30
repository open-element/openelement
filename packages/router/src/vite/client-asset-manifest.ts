/**
 * Client asset manifest builder (#1471).
 *
 * Joins the compile-time island identity (the ClientIslandDeliveryEntry list
 * the client entry was generated from) with the Phase 2 client build's
 * outputs: the Vite build manifest (dist/client/.vite/manifest.json) and the
 * Rollup output chunks' module metadata. Island identity is never derived
 * from output chunk file names — a chunk is matched by the module ids it
 * contains, so islands that share a chunk keep their identity.
 *
 * The join fails closed: a missing or corrupted build manifest, a missing
 * client entry, and an admitted island that cannot be attributed to exactly
 * one emitted module are Phase 2 build failures (OE_CLIENT_ASSET_* codes) —
 * a silently dropped or mis-attributed island identity would ship pages
 * whose client scripts never load.
 */

import { join, relative } from '../internal/host-path.ts';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { buildError, ClientAssetErrorCode } from '../internal/error-codes.ts';
import type { ClientAssetManifest, ClientIslandAsset } from './internal/protocol/client-assets.ts';
import {
  type ClientIslandDeliveryEntry,
  resolveIslandDeliveryTags,
} from './internal/ssg/delivery.ts';

/** One dist/client/.vite/manifest.json entry (the fields the builder reads). */
export interface ViteClientManifestEntry {
  file?: string;
  name?: string;
  isEntry?: boolean;
}

/** The Rollup output-chunk fields the builder reads (module metadata). */
export interface ClientBuildChunk {
  fileName: string;
  facadeModuleId?: string | null;
  modules?: Record<string, unknown>;
}

/** One compile-time island identity handed to the builder. */
export interface ClientAssetIslandInput {
  /** The client entry generated for this island (identity + strategy). */
  entry: ClientIslandDeliveryEntry;
  /**
   * Absolute source path (local islands and import-map-resolved package
   * islands); null when only the declared module specifier is available.
   */
  sourceFile: string | null;
}

/** Read dist/client/.vite/manifest.json. Missing and corrupted files fail. */
export async function readViteClientManifest(
  manifestPath: string,
): Promise<Record<string, ViteClientManifestEntry>> {
  let text: string;
  try {
    text = await Deno.readTextFile(manifestPath);
  } catch (cause) {
    throw buildError(
      ClientAssetErrorCode.MANIFEST_READ,
      `Client asset manifest is missing: ${manifestPath} cannot be read — ` +
        `the Phase 2 client build must ship ${manifestPath} (reason: ${(cause as Error).message})`,
      { cause: cause as Error },
    );
  }
  try {
    return JSON.parse(text) as Record<string, ViteClientManifestEntry>;
  } catch (cause) {
    throw buildError(
      ClientAssetErrorCode.MANIFEST_MALFORMED,
      `Client asset manifest is corrupted: ${manifestPath} is not valid JSON ` +
        `(reason: ${(cause as Error).message})`,
      { cause: cause as Error },
    );
  }
}

/**
 * Extract the Rollup output chunks from a vite build() result. Watch-mode
 * results carry no output array and contribute nothing (the client build is
 * production-only).
 */
export function collectClientBuildChunks(buildResult: unknown): ClientBuildChunk[] {
  const builds = Array.isArray(buildResult) ? buildResult : [buildResult];
  const chunks: ClientBuildChunk[] = [];
  for (const build of builds) {
    const output = (build as { output?: unknown } | null)?.output;
    if (!Array.isArray(output)) continue;
    for (const item of output) {
      const chunk = item as {
        type?: string;
        fileName?: string;
        facadeModuleId?: string | null;
        modules?: Record<string, unknown>;
      };
      if (chunk?.type !== 'chunk' || typeof chunk.fileName !== 'string') continue;
      chunks.push({
        fileName: chunk.fileName,
        facadeModuleId: chunk.facadeModuleId,
        modules: chunk.modules,
      });
    }
  }
  return chunks;
}

/** The virtual client entry's manifest key, shared with the entry lookup. */
function isClientEntrySourceKey(src: string): boolean {
  return src.includes('open-client-entry') || src.includes('virtual:open-client');
}

/** The emitted client entry file recorded in the Vite build manifest, or null. */
export function findClientEntryFile(
  viteManifest: Record<string, ViteClientManifestEntry>,
): string | null {
  for (const [src, entry] of Object.entries(viteManifest)) {
    if (isClientEntrySourceKey(src) && entry.file) return entry.file;
  }
  return null;
}

/** Strip query suffixes and normalize separators so module ids compare exactly. */
function normalizeModuleId(id: string): string {
  return normalizeSeparators(id.split('?', 1)[0]);
}

const MODULE_EXTENSION = /\.[cm]?[jt]sx?$/;

/**
 * The package-island module identity rule, shared by the client asset
 * manifest resolver and the client build's chunk grouping: the identity
 * string equals the real module id, or is its exact trailing path —
 * segment-boundary aligned, insensitive to the module extension (declared
 * package specifiers are extensionless; emitted ids carry one). A bare
 * substring hit is not identity: `open-callout.js` would otherwise match
 * every package that ships a file of that name.
 */
export function moduleIdentityMatches(moduleId: string, identity: string): boolean {
  const id = normalizeModuleId(moduleId).replace(MODULE_EXTENSION, '');
  const wanted = normalizeModuleId(identity).replace(MODULE_EXTENSION, '');
  return id === wanted || id.endsWith(`/${wanted}`);
}

/**
 * Resolve one package island's module identity to the unique real module id
 * in the emitted graph. Zero matches and several matches both fail: a
 * silent first-hit would ship another package's file under this island's
 * identity, and a silent fallback would deliver a different module than the
 * declared specifier names.
 */
export function resolveIslandModuleId(
  fileByModuleId: Map<string, string>,
  identity: string,
  islandLabel: string,
): string {
  const matches: string[] = [];
  for (const id of fileByModuleId.keys()) {
    if (moduleIdentityMatches(id, identity)) matches.push(id);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw buildError(
      ClientAssetErrorCode.ISLAND_UNMAPPED,
      `Admitted island "${islandLabel}" declares module identity "${identity}" but no emitted ` +
        `client module matches it — the Phase 2 client build shipped no chunk carrying this module`,
    );
  }
  throw buildError(
    ClientAssetErrorCode.ISLAND_IDENTITY_AMBIGUOUS,
    `Admitted island "${islandLabel}" declares module identity "${identity}" which matches ` +
      `${matches.length} emitted client modules: ${matches.join(', ')} — ` +
      `declare the full package specifier so the island identity is unique`,
  );
}

/**
 * The client chunk grouping decision for one module id, using the same
 * identity rule as the asset manifest resolver. Returns the island chunk
 * name, undefined when the module belongs to no package island, and fails
 * closed when distinct island identities claim the same module. Islands
 * that share one identity (one capability module delivering several tags)
 * intentionally share the chunk.
 */
export function packageIslandChunkName(
  moduleId: string,
  islands: ReadonlyArray<{ tagName: string; identity: string }>,
): string | undefined {
  const identities = new Map<string, string>();
  for (const island of islands) {
    if (moduleIdentityMatches(moduleId, island.identity)) {
      if (!identities.has(island.identity)) identities.set(island.identity, island.tagName);
    }
  }
  if (identities.size === 0) return undefined;
  if (identities.size > 1) {
    throw buildError(
      ClientAssetErrorCode.ISLAND_IDENTITY_AMBIGUOUS,
      `Module ${moduleId} is claimed by ${identities.size} distinct package island identities ` +
        `(${[...identities.keys()].join(', ')}) — the client chunk grouping cannot attribute it; ` +
        `declare the full package specifier so each island identity is unique`,
    );
  }
  const [tagName] = [...identities.values()];
  return `island-${tagName}`;
}

function resolveIslandChunkFile(
  root: string,
  island: ClientAssetIslandInput,
  fileByModuleId: Map<string, string>,
  fileByManifestKey: Map<string, string>,
  manifestPath: string,
): string | null {
  if (island.sourceFile) {
    const direct = fileByModuleId.get(normalizeSeparators(island.sourceFile));
    if (direct) return direct;
    // The Vite build manifest keys chunk facades by their root-relative
    // source path — the same compile-time identity, hash-agnostic.
    return fileByManifestKey.get(normalizeSeparators(relative(root, island.sourceFile))) ?? null;
  }
  // Package islands declare a module specifier as identity — the same
  // identity the client build's chunk grouping used. It must resolve to
  // exactly one emitted module; zero and several matches both fail.
  const id = resolveIslandModuleId(
    fileByModuleId,
    island.entry.modulePath,
    `${island.entry.tagName} (${island.entry.modulePath})`,
  );
  const file = fileByModuleId.get(id);
  if (!file) {
    throw buildError(
      ClientAssetErrorCode.ISLAND_UNMAPPED,
      `Admitted island "${island.entry.tagName}" resolved to module ${id} which carries no ` +
        `emitted file in the client build (manifest: ${manifestPath})`,
    );
  }
  return file;
}

/**
 * Build the client asset manifest from the client build's outputs.
 * Fails closed: compile-time island identity in, structured manifest out,
 * with no silent identity drops — every admitted island must resolve.
 */
export function buildClientAssetManifest(options: {
  root: string;
  base: string;
  islands: ClientAssetIslandInput[];
  viteManifest: Record<string, ViteClientManifestEntry>;
  chunks: ClientBuildChunk[];
  /** The manifest's path, named in every failure this builder raises. */
  manifestPath: string;
}): ClientAssetManifest {
  const { root, base, islands, viteManifest, chunks, manifestPath } = options;
  const assetUrl = (file: string) => `${base}client/${file}`;

  const entryFile = findClientEntryFile(viteManifest);
  if (!entryFile) {
    throw buildError(
      ClientAssetErrorCode.ENTRY_MISSING,
      `Client asset manifest is incomplete: ${manifestPath} records no client entry — ` +
        `the "virtual:open-client-entry" record must carry the emitted entry file`,
    );
  }

  // Rollup module metadata: module id -> containing chunk file. A module
  // that shares a chunk with other islands keeps its identity here.
  const fileByModuleId = new Map<string, string>();
  for (const chunk of chunks) {
    const ids = new Set<string>(Object.keys(chunk.modules ?? {}));
    if (chunk.facadeModuleId) ids.add(chunk.facadeModuleId);
    for (const rawId of ids) {
      const id = normalizeModuleId(rawId);
      if (!fileByModuleId.has(id)) fileByModuleId.set(id, chunk.fileName);
    }
  }

  // Vite build manifest: source key -> emitted file (facade + asset view).
  const fileByManifestKey = new Map<string, string>();
  for (const [src, entry] of Object.entries(viteManifest)) {
    if (entry.file) fileByManifestKey.set(normalizeSeparators(src), entry.file);
  }

  const islandAssets: Record<string, ClientIslandAsset> = {};
  const islandFiles = new Set<string>();
  for (const island of islands) {
    const file = resolveIslandChunkFile(
      root,
      island,
      fileByModuleId,
      fileByManifestKey,
      manifestPath,
    ) ??
      // An island without a chunk of its own rides the client entry chunk —
      // the same fallback the post-build chunk map applies.
      entryFile;
    const asset: ClientIslandAsset = {
      file: assetUrl(file),
      strategy: island.entry.strategy,
    };
    if (island.entry.strategy === 'load') asset.preload = true;
    for (
      const tag of resolveIslandDeliveryTags(
        island.entry.tagName,
        island.entry.tags,
        island.entry.tagNames,
        island.entry.tagName,
      )
    ) {
      islandAssets[tag] = asset;
    }
    islandFiles.add(asset.file);
  }

  const shared = new Set<string>();
  for (const file of fileByManifestKey.values()) {
    if (!file.endsWith('.js')) continue;
    if (file === entryFile) continue;
    const url = assetUrl(file);
    if (islandFiles.has(url)) continue;
    shared.add(url);
  }

  return {
    entry: assetUrl(entryFile),
    islands: islandAssets,
    shared: [...shared].sort(),
  };
}

/** Convenience wrapper: the manifest path + build result a client build holds. */
export async function createClientAssetManifest(options: {
  root: string;
  base: string;
  islands: ClientAssetIslandInput[];
  manifestPath: string;
  buildResult: unknown;
}): Promise<ClientAssetManifest> {
  const viteManifest = await readViteClientManifest(join(options.manifestPath));
  return buildClientAssetManifest({
    root: options.root,
    base: options.base,
    islands: options.islands,
    viteManifest,
    chunks: collectClientBuildChunks(options.buildResult),
    manifestPath: options.manifestPath,
  });
}
