/**
 * island-manifest.ts - Island Upgrade Manifest
 *
 * Generates per-page island manifest JSON files during SSG post-processing.
 * Each manifest lists the islands found on a page with their chunk URLs and strategies.
 */

import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { ComponentLayer } from '../protocol/framework.ts';
import { formatJson, normalizeSeparators } from '@openelement/element/build-utils';
import { isValidTagName } from '@openelement/element';
import { stableHash } from './ssg-helpers.ts';
import { walkHtmlFileEntries } from '../html-files.ts';
import type { IslandDeliveryStrategy } from './delivery.ts';

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

function readTagName(html: string, start: number): { name: string; end: number } | undefined {
  let end = start;
  while (end < html.length && /[A-Za-z0-9:._-]/.test(html[end])) end++;
  if (end === start) return undefined;
  return { name: html.slice(start, end).toLowerCase(), end };
}

function skipThroughClosingTag(html: string, from: number, tagName: string): number {
  const lower = html.toLowerCase();
  const close = lower.indexOf(`</${tagName}`, from);
  if (close === -1) return html.length;
  const closeEnd = lower.indexOf('>', close);
  return closeEnd === -1 ? html.length : closeEnd + 1;
}

/**
 * Extract custom element tag names from HTML content.
 * Matches actual tag-open tokens for custom elements, which must contain a hyphen.
 * Tags inside comments, script blocks, style blocks, and declarations are ignored.
 */
export function extractCustomElementTags(html: string): string[] {
  const tags = new Set<string>();
  let index = 0;

  while (index < html.length) {
    const tagStart = html.indexOf('<', index);
    if (tagStart === -1) break;

    const next = html[tagStart + 1];
    if (next === undefined) break;

    if (next === '!') {
      if (html.startsWith('<!--', tagStart)) {
        const commentEnd = html.indexOf('-->', tagStart + 4);
        index = commentEnd === -1 ? html.length : commentEnd + 3;
      } else {
        const declarationEnd = html.indexOf('>', tagStart + 2);
        index = declarationEnd === -1 ? html.length : declarationEnd + 1;
      }
      continue;
    }

    if (next === '/' || next === '?' || /\s/.test(next)) {
      index = tagStart + 2;
      continue;
    }

    const tag = readTagName(html, tagStart + 1);
    if (!tag) {
      index = tagStart + 1;
      continue;
    }

    if (tag.name === 'script' || tag.name === 'style') {
      index = skipThroughClosingTag(html, tag.end, tag.name);
      continue;
    }

    if (isValidTagName(tag.name)) {
      tags.add(tag.name);
    }

    const tagEnd = html.indexOf('>', tag.end);
    index = tagEnd === -1 ? html.length : tagEnd + 1;
  }

  return [...tags];
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
    const html = readFileSync(entry.absolutePath, 'utf-8');
    const tags = extractCustomElementTags(html).sort();

    const islands: IslandManifestEntry[] = tags
      .filter((tag) => tag in islandChunkMap)
      .map((tag) => ({
        tagName: tag,
        chunkUrl: islandChunkMap[tag],
        strategy: strategyMap[tag] || 'idle',
        layer: layerMap[tag] || 'dsd-static',
      }));

    // Route from the output-relative path: 'index.html' -> '/',
    // 'about/index.html' -> '/about', 'about.html' -> '/about'.
    const rel = normalizeSeparators(entry.relativePath).replace(/\.html$/, '');
    const route = rel === 'index' ? '/' : `/${rel.replace(/\/index$/, '')}`;

    manifests.push({
      route,
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
): Promise<void> {
  const manifestDir = join(outputDir, 'island-manifests');
  mkdirSync(manifestDir, { recursive: true });

  for (const manifest of manifests) {
    const hash = await stableHash(manifest.route);
    const filename = `page-${hash}.json`;
    writeFileSync(join(manifestDir, filename), formatJson(manifest), 'utf-8');
  }
}
