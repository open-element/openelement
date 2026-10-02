/**
 * build-postprocess.ts - Adapter-agnostic SSG build post-processing.
 *
 * Orchestrates island chunk/strategy/layer map construction and SSR artifact
 * cleanup. This module has zero Vite dependency and only reads/writes files.
 *
 * Client scripts are not post-processed here: the document renderer embeds
 * the final script tags at render time from the client asset manifest
 * (#1471). The remaining island chunk resolution is
 * identity-driven too — the per-page island manifests read their chunk URLs
 * from the manifest's delivery-tag-keyed record, never from output file
 * names — and fail-closed: an admitted island missing its record fails the
 * build (OE_CLIENT_ASSET_ISLAND_UNMAPPED) before any page manifest is
 * written.
 */

import { readdir, rm } from 'node:fs/promises';
import process from 'node:process';
import { join } from '../../../internal/host-path.ts';
import type { ComponentLayer, HydrationStrategy } from '../protocol/framework.ts';
import type { ClientAssetManifest } from '../protocol/client-assets.ts';
import type { IslandDecl } from '../protocol/ssg.ts';
import { createLogger } from '@openelement/element';
import { buildError, ClientAssetErrorCode } from '../../../internal/error-codes.ts';
import { generateIslandManifests, writeIslandManifests } from './island-manifest.ts';
import { expandIslandDeliveryDecl, resolveIslandHydrate } from './island-scanner.ts';
import {
  type IslandDeliveryMeta,
  type IslandDeliveryStrategy,
  resolveIslandDeliveryTags,
} from './delivery.ts';
import { DEFAULT_OUT_DIR } from './../paths.ts';

const log = createLogger('build-postprocess');

/** Narrow view of OpenElementBuildContext used by the SSG post-processor. */
export interface BuildContextView {
  phase3: {
    root: string;
    outDir: string;
    base: string;
    upgradeStrategy: HydrationStrategy;
  };
  phase1: {
    islandTagNames: string[];
    islandFiles?: string[];
    packageIslandDecls: IslandDecl[];
    compilerBehaviorDecls?: IslandDecl[];
    islandMeta: Record<string, Partial<IslandDecl>>;
  };
  /** The Phase 2 client build's asset manifest (null when no client bundle shipped). */
  clientAssetManifest?: ClientAssetManifest | null;
}

type DeliveryIslandMeta = Partial<IslandDecl> &
  IslandDeliveryMeta & {
    hydrate?: IslandDeliveryStrategy;
  };

function expandLocalIslandMeta(
  tagName: string,
  rawMeta: Partial<IslandDecl>,
): Array<[string, DeliveryIslandMeta]> {
  const meta = rawMeta as DeliveryIslandMeta;
  const tags = resolveIslandDeliveryTags(tagName, meta.tags, meta.tagNames, tagName);
  return tags.map((deliveredTag) => [deliveredTag, { ...meta, tagName: deliveredTag }]);
}

/**
 * Resolve the per-island client chunk URLs from the Phase 2 client asset
 * manifest: delivery tag -> asset URL, identity-keyed.
 * No output file name is ever parsed — a chunk rename or rehash leaves every
 * island identity intact because the manifest was joined on module ids.
 * Fail-closed: with islands admitted (a non-empty tag list), an island the
 * manifest does not record fails the build (`OE_CLIENT_ASSET_ISLAND_UNMAPPED`)
 * instead of warning and shipping a partial manifest — the page would carry an
 * island whose client script never loads. An empty tag list maps to an empty
 * chunk map without consulting the manifest (an island-free build owes no
 * records).
 */
export function islandChunkMapFromAssetManifest(
  manifest: ClientAssetManifest | null | undefined,
  islandTagNames: readonly string[],
): Record<string, string> {
  const chunkMap: Record<string, string> = {};
  for (const tagName of islandTagNames) {
    const asset = manifest?.islands[tagName];
    if (!asset) {
      throw buildError(
        ClientAssetErrorCode.ISLAND_UNMAPPED,
        `Admitted island "${tagName}" has no client asset record in the client asset manifest` +
          `${manifest ? '' : ' (no client asset manifest shipped)'}` +
          ` — the per-page island manifests would silently omit it; ` +
          `the Phase 2 client build must record every admitted island's asset`,
      );
    }
    chunkMap[tagName] = asset.file;
  }
  return chunkMap;
}

/**
 * Generate the per-page island manifests from the client asset manifest.
 * Must only run after Phase 2 (client island build) has completed. The
 * client script tags themselves were already embedded at render time
 * (#1471) — this pass records the identity-driven chunk/strategy/layer
 * manifests only. Fail-closed: the chunk map is resolved — and any missing
 * island asset thrown — before a single page manifest is generated or
 * written, so the pass either writes the complete manifest set or none of
 * it, never a partial record that silently omits an admitted island.
 */
export async function postProcessClientIslandBuild(ctx: BuildContextView): Promise<void> {
  const root = ctx.phase3.root || process.cwd();
  const outDir = ctx.phase3.outDir || DEFAULT_OUT_DIR;
  const outputDir = join(root, outDir);

  // Local islands: only the metadata Phase 2 selected. buildClient narrows
  // ctx.phase1.islandTagNames to the reachable client set but leaves
  // islandMeta carrying every scanned island — validating (or delivering
  // tags from) an unselected entry would re-admit what the client build
  // already excluded, and its tags would fail the fail-closed chunk map
  // below although nothing ships for them. islandMeta is a lookup keyed by
  // the selected tags, never an iteration source.
  const islandMeta = ctx.phase1.islandMeta || {};
  const localMetas: Array<[string, DeliveryIslandMeta]> = [];
  for (const tagName of ctx.phase1.islandTagNames || []) {
    const rawMeta = islandMeta[tagName];
    if (rawMeta) {
      localMetas.push(...expandLocalIslandMeta(tagName, rawMeta));
    } else {
      localMetas.push([tagName, { tagName }]);
    }
  }
  const declaredMetas = [
    ...(ctx.phase1.compilerBehaviorDecls || []),
    ...(ctx.phase1.packageIslandDecls || []),
  ];
  const packageMetas = declaredMetas.flatMap((island) =>
    expandIslandDeliveryDecl(island).map(
      (expanded) =>
        [expanded.tagName, expanded as DeliveryIslandMeta] as [string, DeliveryIslandMeta],
    ),
  );
  const islandMetas: Array<[string, DeliveryIslandMeta]> = [...localMetas, ...packageMetas];
  const islandTagNames = [...new Set(islandMetas.map(([tag]) => tag))].sort();

  const chunkMap = islandChunkMapFromAssetManifest(ctx.clientAssetManifest, islandTagNames);

  const strategyMap = Object.fromEntries(
    islandMetas.map(([tag, meta]) => [
      tag,
      resolveIslandHydrate(
        meta.hydrate as IslandDeliveryStrategy | undefined,
        ctx.phase3.upgradeStrategy,
      ),
    ]),
  ) as Record<string, IslandDeliveryStrategy>;

  const layerMap = Object.fromEntries(
    islandMetas.map(([tag, meta]) => [
      tag,
      meta.hydrate === 'only' || meta.ssr === false ? 'pure-island' : 'dsd-interactive',
    ]),
  ) as Record<string, ComponentLayer>;

  const pageManifests = generateIslandManifests(outputDir, chunkMap, strategyMap, layerMap);
  await writeIslandManifests(outputDir, pageManifests);
}

/**
 * Clean Phase 1 SSR artifacts from the public dist directory.
 * The SSR virtual entry bundle and its source map are build-time only
 * and must not be deployed to static hosting.
 */
export async function cleanSsrArtifacts(ctx: BuildContextView): Promise<void> {
  const root = ctx.phase3.root || process.cwd();
  const outDir = ctx.phase3.outDir || DEFAULT_OUT_DIR;

  try {
    const assetsDir = join(root, outDir, 'assets');
    const entries = await readdir(assetsDir).catch(() => [] as string[]);
    const toDelete = entries.filter(
      (f) =>
        f.startsWith('_virtual_open-hono-entry') ||
        (f.startsWith('src-') && f.endsWith('.js') && !f.includes('client')),
    );
    for (const f of toDelete) {
      const p = join(assetsDir, f);
      await rm(p).catch(() => {});
      log.info(`Cleaned SSR artifact: ${f}`);
    }
    if (toDelete.length > 0) {
      log.info(`Removed ${toDelete.length} unreferenced SSR artifact(s) from dist/assets/`);
    }
  } catch {
    // Non-critical - assets dir may not exist in some configs
  }
}
