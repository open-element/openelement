/**
 * Client asset manifest builder (#1471, ADR-0160 rule d).
 *
 * Joins the compile-time island identity (the ClientIslandDeliveryEntry list
 * the client entry was generated from) with the Phase 2 client build's
 * outputs: the Vite build manifest (dist/client/.vite/manifest.json) and the
 * Rollup output chunks' module metadata. Island identity is never derived
 * from output chunk file names — a chunk is matched by the module ids it
 * contains, so islands that share a chunk keep their identity.
 */

import { join, relative, resolve } from '../internal/host-path.ts';
import { normalizeSeparators } from '@openelement/element/build-utils';
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
  /** Absolute source path (local islands); null when only a module path is declared. */
  sourceFile: string | null;
}

/** Read dist/client/.vite/manifest.json; null when the build shipped none. */
export async function readViteClientManifest(
  manifestPath: string,
): Promise<Record<string, ViteClientManifestEntry> | null> {
  try {
    return JSON.parse(await Deno.readTextFile(manifestPath)) as Record<
      string,
      ViteClientManifestEntry
    >;
  } catch {
    return null;
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

function resolveIslandChunkFile(
  root: string,
  island: ClientAssetIslandInput,
  fileByModuleId: Map<string, string>,
  fileByManifestKey: Map<string, string>,
): string | null {
  if (island.sourceFile) {
    const direct = fileByModuleId.get(normalizeSeparators(island.sourceFile));
    if (direct) return direct;
    // The Vite build manifest keys chunk facades by their root-relative
    // source path — the same compile-time identity, hash-agnostic.
    return fileByManifestKey.get(normalizeSeparators(relative(root, island.sourceFile))) ?? null;
  }
  // Package islands declare a path fragment of their real module id — the
  // same identity join the client build's chunk grouping uses.
  for (const [id, file] of fileByModuleId) {
    if (id.includes(island.entry.modulePath)) return file;
  }
  return null;
}

/**
 * Build the client asset manifest from the client build's outputs.
 * Pure function: compile-time island identity in, structured manifest out.
 */
export function buildClientAssetManifest(options: {
  root: string;
  base: string;
  islands: ClientAssetIslandInput[];
  viteManifest: Record<string, ViteClientManifestEntry>;
  chunks: ClientBuildChunk[];
}): ClientAssetManifest {
  const { root, base, islands, viteManifest, chunks } = options;
  const assetUrl = (file: string) => `${base}client/${file}`;

  const entryFile = findClientEntryFile(viteManifest);

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
    const file = resolveIslandChunkFile(root, island, fileByModuleId, fileByManifestKey) ??
      // An island without a chunk of its own rides the client entry chunk —
      // the same fallback the post-build chunk map applies.
      entryFile;
    if (!file) continue;
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
    if (entryFile !== null && file === entryFile) continue;
    const url = assetUrl(file);
    if (islandFiles.has(url)) continue;
    shared.add(url);
  }

  return {
    entry: entryFile ? assetUrl(entryFile) : '',
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
}): Promise<ClientAssetManifest | null> {
  const viteManifest = await readViteClientManifest(join(options.manifestPath));
  if (!viteManifest) return null;
  return buildClientAssetManifest({
    root: options.root,
    base: options.base,
    islands: options.islands,
    viteManifest,
    chunks: collectClientBuildChunks(options.buildResult),
  });
}
