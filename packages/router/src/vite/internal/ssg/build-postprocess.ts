/**
 * build-postprocess.ts - Adapter-agnostic SSG build post-processing.
 *
 * Orchestrates client-script injection, island chunk/strategy/layer map
 * construction, and SSR artifact cleanup. This module has zero Vite
 * dependency and only reads/writes files.
 */

import { join } from 'node:path';
import { cwd } from 'node:process';
import { readdir, unlink } from 'node:fs/promises';
import type { ComponentLayer, HydrationStrategy } from '../protocol/framework.ts';
import type { IslandDecl } from '../protocol/ssg.ts';
import { createLogger } from '@openelement/element';
import { buildIslandChunkMap, injectClientScript } from './postprocess.ts';
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
}

type DeliveryIslandMeta = Partial<IslandDecl> & IslandDeliveryMeta & {
  hydrate?: IslandDeliveryStrategy;
  filePath?: string;
};

function expandLocalIslandMeta(
  tagName: string,
  rawMeta: Partial<IslandDecl>,
): Array<[string, DeliveryIslandMeta]> {
  const meta = rawMeta as DeliveryIslandMeta;
  const tags = resolveIslandDeliveryTags(
    tagName,
    meta.tags,
    meta.tagNames,
    tagName,
  );
  return tags.map((deliveredTag) => [
    deliveredTag,
    { ...meta, tagName: deliveredTag },
  ]);
}

/**
 * Inject the island client script and generate per-page island manifests.
 * Must only run after Phase 2 (client island build) has completed.
 */
export async function postProcessClientIslandBuild(
  ctx: BuildContextView,
  scriptSrc: string,
): Promise<void> {
  const root = ctx.phase3.root || cwd();
  const outDir = ctx.phase3.outDir || DEFAULT_OUT_DIR;
  const base = ctx.phase3.base || '/';
  const outputDir = join(root, outDir);

  injectClientScript(outputDir, scriptSrc);

  // Local and package islands share the same strategy/layer derivation; the
  // only difference is where the tag->meta pairs come from.
  const localMetas = Object.entries(ctx.phase1.islandMeta || {}).flatMap(([tag, meta]) =>
    expandLocalIslandMeta(tag, meta)
  );
  const localMetaTags = new Set(Object.keys(ctx.phase1.islandMeta || {}));
  for (const tagName of ctx.phase1.islandTagNames || []) {
    if (!localMetaTags.has(tagName)) localMetas.push([tagName, { tagName }]);
  }
  const declaredMetas = [
    ...(ctx.phase1.compilerBehaviorDecls || []),
    ...(ctx.phase1.packageIslandDecls || []),
  ];
  const packageMetas = declaredMetas.flatMap((island) =>
    expandIslandDeliveryDecl(island).map((expanded) =>
      [expanded.tagName, expanded as DeliveryIslandMeta] as [string, DeliveryIslandMeta]
    )
  );
  const islandMetas: Array<[string, DeliveryIslandMeta]> = [...localMetas, ...packageMetas];
  const islandTagNames = [...new Set(islandMetas.map(([tag]) => tag))].sort();

  const chunkAliases: Record<string, readonly string[]> = {};
  const addAliases = (tagName: string, aliases: string[]): void => {
    chunkAliases[tagName] = [...new Set([...(chunkAliases[tagName] || []), ...aliases])];
  };
  for (const [primaryTag, meta] of Object.entries(ctx.phase1.islandMeta || {})) {
    const filePath = meta && typeof (meta as { filePath?: unknown }).filePath === 'string'
      ? (meta as { filePath: string }).filePath
      : undefined;
    const basename = filePath?.replaceAll('\\', '/').split('/').pop()?.replace(/\.[^.]+$/, '');
    const deliveredTags = resolveIslandDeliveryTags(
      primaryTag,
      (meta as DeliveryIslandMeta | undefined)?.tags,
      (meta as DeliveryIslandMeta | undefined)?.tagNames,
      primaryTag,
    );
    for (const tagName of deliveredTags) {
      addAliases(tagName, [primaryTag, ...(basename ? [basename] : [])]);
    }
  }
  for (const island of declaredMetas) {
    const delivery = island as IslandDecl & {
      tags?: readonly string[];
      tagNames?: readonly string[];
    };
    const deliveredTags = resolveIslandDeliveryTags(
      island.tagName,
      delivery.tags,
      delivery.tagNames,
      island.tagName,
    );
    for (const tagName of deliveredTags) addAliases(tagName, [island.tagName]);
  }

  const chunkMap = await buildIslandChunkMap(
    root,
    outDir,
    islandTagNames,
    base,
    chunkAliases,
  );

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
  const root = ctx.phase3.root || cwd();
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
      await unlink(p).catch(() => {});
      log.info(`Cleaned SSR artifact: ${f}`);
    }
    if (toDelete.length > 0) {
      log.info(`Removed ${toDelete.length} unreferenced SSR artifact(s) from dist/assets/`);
    }
  } catch {
    // Non-critical - assets dir may not exist in some configs
  }
}
