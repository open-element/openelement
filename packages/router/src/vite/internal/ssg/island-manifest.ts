/**
 * island-manifest.ts - Island Upgrade Manifest
 *
 * Generates per-page island manifest JSON files during SSG post-processing.
 * Each manifest lists the islands found on a page with their chunk URLs and strategies.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import type { ComponentLayer } from '../../framework.ts';
import { formatJson, normalizeSeparators } from '@openelement/element/build-utils';
import { isValidTagName } from '@openelement/element/authoring';
import { stableHash } from './ssg-helpers.ts';
import { walkHtmlFileEntries } from '../html-files.ts';
import type { IslandDeliveryStrategy } from './delivery.ts';
import { visitRenderedTags } from './rendered-html.ts';

export { readTagName, skipThroughClosingTag } from './rendered-html.ts';

/** Stable artifact timestamp; manifests must be byte-identical across builds. */
export const DETERMINISTIC_MANIFEST_TIMESTAMP = '1970-01-01T00:00:00.000Z';

/** Island manifest entry for a single custom element */
export interface IslandManifestEntry {
  /** Custom element tag name (e.g. 'open-theme-toggle') */
  tagName: string;
  /** Client chunk URL relative to site root */
  chunkUrl: string;
  /** Upgrade strategy */
  strategy: IslandDeliveryStrategy;
  /** Component layer */
  layer: ComponentLayer;
}

/** Per-page island manifest */
export interface PageIslandManifest {
  /** Page route (e.g. '/guide/getting-started') */
  route: string;
  /** Islands found on this page */
  islands: IslandManifestEntry[];
  /** Build timestamp (ISO 8601) */
  builtAt: string;
}

/** Strategy map type: tagName -> strategy */
export type IslandStrategyMap = Record<string, IslandDeliveryStrategy>;

/** Layer map type: tagName -> layer */
export type IslandLayerMap = Record<string, ComponentLayer>;

/** Extract actual custom-element opening tags from the rendered markup. */
export function extractCustomElementTags(html: string): string[] {
  const tags = new Set<string>();
  visitRenderedTags(html, ({ name }) => {
    if (isValidTagName(name)) tags.add(name);
  });
  return [...tags];
}

/**
 * Output-relative HTML path → site route: 'index.html' → '/',
 * 'about/index.html' → '/about', 'about.html' → '/about'.
 * The single route derivation for every consumer that keys output files by
 * route (island manifests, per-page speculation rules).
 */
export function routeFromRelativePath(relativePath: string): string {
  const rel = normalizeSeparators(relativePath).replace(/\.html$/, '');
  return rel === 'index' ? '/' : `/${rel.replace(/\/index$/, '')}`;
}

/**
 * Route → the deduped, sorted island chunk URLs that route's page loads.
 * The projection every per-page consumer of the manifests reads; chunk
 * facts are never re-derived by scanning output files.
 */
export function pageChunkMap(manifests: readonly PageIslandManifest[]): Map<string, string[]> {
  return new Map(
    manifests.map((manifest) => [
      manifest.route,
      [
        ...new Set(
          manifest.islands
            .filter((island) => island.strategy !== 'none')
            .map((island) => island.chunkUrl),
        ),
      ].sort(),
    ]),
  );
}

/**
 * Whether a page carries at least one island whose module the client can
 * activate. This is the projection the element-runtime preload lane reads
 * (B2/#1544): an island-bearing page keeps the shared runtime's warm start
 * through one `<link rel="modulepreload">`, and a page with no island — or
 * only `hydrate: 'none'` islands, which never enter the client bundle —
 * gets no preload, so the runtime stays out of its fetch graph. Derived from
 * the manifest entry the build already recorded; never re-derived by
 * scanning output files.
 */
export function pageHasClientIslands(manifest: PageIslandManifest): boolean {
  return manifest.islands.some((island) => island.strategy !== 'none');
}

/**
 * Generate island manifests for all HTML files in the output directory.
 */
export function generateIslandManifests(
  htmlDir: string,
  islandChunkMap: Record<string, string>,
  strategyMap: IslandStrategyMap = {},
  layerMap: IslandLayerMap = {},
): PageIslandManifest[] {
  const manifests: PageIslandManifest[] = [];

  if (!existsSync(htmlDir)) return manifests;

  // #710: single shared walker — deterministic order, dotfiles skipped.
  for (const entry of walkHtmlFileEntries(htmlDir)) {
    const html = readFileSync(entry.absolutePath, 'utf8');
    const tags = extractCustomElementTags(html).sort();

    const islands: IslandManifestEntry[] = tags
      .filter((tag) => tag in islandChunkMap)
      .map((tag) => ({
        tagName: tag,
        chunkUrl: islandChunkMap[tag],
        strategy: strategyMap[tag] || 'idle',
        layer: layerMap[tag] || 'dsd-static',
      }));

    manifests.push({
      route: routeFromRelativePath(entry.relativePath),
      islands,
      builtAt: DETERMINISTIC_MANIFEST_TIMESTAMP,
    });
  }

  return manifests;
}

/**
 * Write island manifest files to disk.
 * Each page gets its own JSON file at {outDir}/island-manifests/{route-hash}.json
 */
export async function writeIslandManifests(
  outputDir: string,
  manifests: PageIslandManifest[],
): Promise<string[]> {
  const written: string[] = [];
  const manifestDir = join(outputDir, 'island-manifests');
  mkdirSync(manifestDir, { recursive: true });

  for (const manifest of manifests) {
    const hash = await stableHash(manifest.route);
    const filename = `page-${hash}.json`;
    writeFileSync(join(manifestDir, filename), formatJson(manifest), 'utf8');
    written.push(`island-manifests/${filename}`);
  }
  return written;
}
