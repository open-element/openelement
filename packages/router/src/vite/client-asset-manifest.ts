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
 *
 * Identity resolution has one source: the client build itself. The build's
 * identity plugin resolves each admitted island's declared specifier through
 * its own resolver (the same plugin container, alias table and node_modules
 * layout the generated client entry's imports go through) and hands the
 * resulting declared-specifier → module-id map to this builder; the join
 * consumes exactly that map and confirms every id against the emitted module
 * graph. A resolved id the graph does not carry fails the build — it is never
 * traded for another module that merely matches the declared specifier.
 */

import { readFile } from 'node:fs/promises';
import { join, relative } from 'pathe';
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
   * Absolute source path (local islands); null when the island's declared
   * module specifier is its identity (package and compiler behavior islands —
   * the join resolves it through the build's identity map).
   */
  sourceFile: string | null;
}

/** Read dist/client/.vite/manifest.json. Missing and corrupted files fail. */
export async function readViteClientManifest(
  manifestPath: string,
): Promise<Record<string, ViteClientManifestEntry>> {
  let text: string;
  try {
    text = await readFile(manifestPath, 'utf8');
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

/**
 * The emitted client entry file recorded in the Vite build manifest, or null.
 * Entry cardinality is fail-closed: exactly one manifest record may claim the
 * client entry. Two claiming records are an ambiguous manifest — which file
 * wins must never depend on the order the manifest's keys iterate in
 * (`Object.entries` follows JSON insertion order, which the writer is free to
 * change), so several matches fail instead of taking a first hit.
 */
export function findClientEntryFile(
  viteManifest: Record<string, ViteClientManifestEntry>,
  manifestPath?: string,
): string | null {
  const candidates: Array<[src: string, file: string]> = [];
  for (const [src, entry] of Object.entries(viteManifest)) {
    if (isClientEntrySourceKey(src) && entry.file) candidates.push([src, entry.file]);
  }
  if (candidates.length > 1) {
    const where = manifestPath ? ` (manifest: ${manifestPath})` : '';
    throw buildError(
      ClientAssetErrorCode.ENTRY_AMBIGUOUS,
      `Client asset manifest is ambiguous${where}: ${candidates.length} records claim the ` +
        `client entry (${candidates.map(([src, file]) => `${src} -> ${file}`).join(', ')}) — ` +
        `exactly one "virtual:open-client-entry" record must carry the emitted entry file`,
    );
  }
  return candidates[0]?.[1] ?? null;
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
 * in the emitted graph. When the build's identity pass resolved the declared
 * specifier, its module id is the verdict and must appear in the emitted
 * graph — an id the graph does not carry fails the build instead of being
 * traded for another module that merely matches the declared specifier
 * (a silently different module would ship code the island never declared).
 * Without a build-side resolution (direct callers), the exact identity rule
 * applies: zero matches and several matches both fail, a silent first-hit
 * would ship another package's file under this island's identity.
 */
export function resolveIslandModuleId(
  fileByModuleId: Map<string, string>,
  identity: string,
  islandLabel: string,
  resolvedId?: string,
): string {
  if (resolvedId !== undefined) {
    const id = normalizeModuleId(resolvedId);
    if (fileByModuleId.has(id)) return id;
    throw buildError(
      ClientAssetErrorCode.ISLAND_UNMAPPED,
      `Admitted island "${islandLabel}" declares module identity "${identity}" which the client ` +
        `build resolved to ${resolvedId}, but the emitted client graph carries no such module — ` +
        `the Phase 2 build shipped no chunk containing the module the island resolves to`,
    );
  }
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
  resolvedId?: string,
): string | null {
  if (island.sourceFile) {
    const direct = fileByModuleId.get(normalizeSeparators(island.sourceFile));
    if (direct) return direct;
    // The Vite build manifest keys chunk facades by their root-relative
    // source path — the same compile-time identity, hash-agnostic.
    return fileByManifestKey.get(normalizeSeparators(relative(root, island.sourceFile))) ?? null;
  }
  // Package islands declare a module specifier as identity. The build's
  // identity pass resolved it to the actual module id (confirmed against the
  // emitted graph, fail closed when absent); without that resolution the
  // exact identity rule applies. Either way the identity must name exactly
  // one emitted module.
  const id = resolveIslandModuleId(
    fileByModuleId,
    island.entry.modulePath,
    `${island.entry.tagName} (${island.entry.modulePath})`,
    resolvedId,
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
  /**
   * The client build's identity map — declared island specifier to the actual
   * module id the build's own resolver answered, one entry per admitted
   * island. The join consumes it verbatim and confirms every id against the
   * emitted module graph (fail closed when absent). Omitted only by direct
   * callers without a build-side resolution pass; those joins stay on the
   * exact identity rule.
   */
  resolvedIslandModuleIds?: ReadonlyMap<string, string>;
  /**
   * The style assets the client build emitted — the `.css` file
   * names the style-asset plugin recorded, dist/client-relative. Mapped to
   * base-prefixed, sorted `styles` preload URLs; deduplicated (the emission
   * records are already unique per style request, but the join owns the
   * final URL set).
   */
  styleFileNames?: readonly string[];
}): ClientAssetManifest {
  const { root, base, islands, viteManifest, chunks, manifestPath } = options;
  const resolvedIds = options.resolvedIslandModuleIds;
  const assetUrl = (file: string) => `${base}client/${file}`;

  const entryFile = findClientEntryFile(viteManifest, manifestPath);
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
  // Delivery-tag ownership is one-to-one: one island entry may deliver many
  // tags (one capability module registering several elements), but one tag is
  // claimed by exactly one island entry. A second claimant fails even when it
  // would resolve to the same asset and strategy — "same answer" is not
  // ownership, and a silent overwrite would make the winner depend on the
  // order the island list iterates in.
  const tagOwners = new Map<string, string>();
  for (const island of islands) {
    const file =
      resolveIslandChunkFile(
        root,
        island,
        fileByModuleId,
        fileByManifestKey,
        manifestPath,
        resolvedIds?.get(island.entry.modulePath),
      ) ??
      // An island without a chunk of its own rides the client entry chunk —
      // the same fallback the post-build chunk map applies.
      entryFile;
    const asset: ClientIslandAsset = {
      file: assetUrl(file),
      strategy: island.entry.strategy,
    };
    if (island.entry.strategy === 'load') asset.preload = true;
    const islandLabel = `${island.entry.tagName} (${island.entry.modulePath})`;
    for (const tag of resolveIslandDeliveryTags(
      island.entry.tagName,
      island.entry.tags,
      island.entry.tagNames,
      island.entry.tagName,
    )) {
      const owner = tagOwners.get(tag);
      if (owner !== undefined) {
        throw buildError(
          ClientAssetErrorCode.ISLAND_TAG_DUPLICATE,
          `Delivery tag "${tag}" is claimed by two island entries: ${owner} and ${islandLabel} ` +
            `— each delivery tag is owned by exactly one island, whatever asset or strategy ` +
            `either would resolve to`,
        );
      }
      tagOwners.set(tag, islandLabel);
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
    styles: [...new Set(options.styleFileNames ?? [])].sort().map(assetUrl),
  };
}

/** Convenience wrapper: the manifest path + build result a client build holds. */
export async function createClientAssetManifest(options: {
  root: string;
  base: string;
  islands: ClientAssetIslandInput[];
  manifestPath: string;
  buildResult: unknown;
  /** The client build's identity map — see {@linkcode buildClientAssetManifest}. */
  resolvedIslandModuleIds?: ReadonlyMap<string, string>;
  /** The style asset file names — see {@linkcode buildClientAssetManifest}. */
  styleFileNames?: readonly string[];
}): Promise<ClientAssetManifest> {
  const viteManifest = await readViteClientManifest(join(options.manifestPath));
  return buildClientAssetManifest({
    root: options.root,
    base: options.base,
    islands: options.islands,
    viteManifest,
    chunks: collectClientBuildChunks(options.buildResult),
    manifestPath: options.manifestPath,
    resolvedIslandModuleIds: options.resolvedIslandModuleIds,
    styleFileNames: options.styleFileNames,
  });
}
