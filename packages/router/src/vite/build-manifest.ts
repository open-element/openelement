/**
 * @openelement/router - Build Manifest / Observability
 *
 * Scans build output directories after each phase and prints a structured
 * summary table. This gives developers visibility into:
 *   - Per-island chunk sizes (Phase 2)
 *   - Total JS/CSS bundle budgets (Phase 3)
 *   - HTML page counts and compression potential
 *   - headExtras injection size
 *
 * Output format: Fixed-width table via console.info (no external dependency).
 *
 * Called by:
 *   - cli/build-client.ts (after Phase 2: client chunks ready)
 *   - cli/build-ssg.ts    (after Phase 3: HTML + post-process complete)
 */

import { basename, join, resolve } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createLogger } from '@openelement/element';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { DEFAULT_OUT_DIR } from './internal/paths.ts';
import { walkFileEntries } from './internal/html-files.ts';

const log = createLogger('build-manifest');

/** File size info for a single artifact */
export interface ArtifactInfo {
  name: string;
  path: string;
  sizeBytes: number;
  sizeKB: string;
}

/** Full build manifest summary */
export interface BuildManifest {
  phase: 1 | 2 | 3;
  timestamp: string;
  islands: ArtifactInfo[];
  clientEntry: ArtifactInfo | null;
  htmlPages: ArtifactInfo[];
  totalJsBytes: number;
  totalHtmlBytes: number;
  headExtrasSize: number;
  /** Budget warnings (files > threshold) */
  warnings: string[];
}

interface BuildManifestBudget {
  islandKB?: number;
  totalJsKB?: number;
  pageKB?: number;
}

/**
 * Format bytes to human-readable string.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 10) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Recursively collect all matching files with their sizes.
 * #710: composed on the single shared walker (internal/html-files.ts).
 */
function collectFiles(
  dir: string,
  extension: string,
): ArtifactInfo[] {
  const results: ArtifactInfo[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of walkFileEntries(dir, extension)) {
    const relPath = normalizeSeparators(entry.relativePath);
    try {
      const stat = statSync(entry.absolutePath);
      results.push({
        name: basename(entry.absolutePath),
        path: relPath,
        sizeBytes: stat.size,
        sizeKB: formatSize(stat.size),
      });
    } catch (e) {
      log.warn(`Cannot stat ${relPath}: ${(e as Error).message}`);
    }
  }
  return results;
}

/**
 * Scan client build output (dist/client/) for island chunks.
 */
export function scanClientBuild(
  root: string,
  outDir: string = DEFAULT_OUT_DIR,
): { islands: ArtifactInfo[]; clientEntry: ArtifactInfo | null; totalJsBytes: number } {
  const clientDir = resolve(root, outDir, 'client');
  const islands: ArtifactInfo[] = [];
  let clientEntry: ArtifactInfo | null = null;
  let totalJsBytes = 0;

  // Scan islands/ subdirectory (single pass - avoid redundant directory scans)
  const islandsDir = join(clientDir, 'islands');
  if (existsSync(islandsDir)) {
    const files = readdirSync(islandsDir);
    for (const file of files) {
      if (!file.endsWith('.js')) continue;
      const fullPath = join(islandsDir, file);
      try {
        const fileStat = statSync(fullPath);
        if (file === 'client.js') {
          // Client entry (shared island upgrade runtime)
          clientEntry = {
            name: 'client.js',
            path: 'islands/client.js',
            sizeBytes: fileStat.size,
            sizeKB: formatSize(fileStat.size),
          };
        } else {
          // Suffix charset matches postprocess.ts ISLAND_CHUNK_SUFFIX_RE:
          // Rolldown/Vite content hashes are base64url and may contain `-`/`_`.
          const isIslandChunk = /^island-(.+?)-[A-Za-z0-9_-]+\.js$/.test(file);
          if (isIslandChunk) {
            islands.push({
              name: file,
              path: `islands/${file}`,
              sizeBytes: fileStat.size,
              sizeKB: formatSize(fileStat.size),
            });
          }
        }
        totalJsBytes += fileStat.size;
      } catch (e) {
        log.warn(`Cannot stat ${file}: ${(e as Error).message}`);
      }
    }
  }

  return { islands, clientEntry, totalJsBytes };
}

/**
 * Scan SSG output (dist/*.html) for page information.
 */
export function scanSSGOutput(
  root: string,
  outDir: string = DEFAULT_OUT_DIR,
): ArtifactInfo[] {
  const distDir = resolve(root, outDir);
  return collectFiles(distDir, '.html');
}

/**
 * Print a formatted build manifest table to console.
 *
 * This is called at the end of each build phase to provide observability
 * into what was produced and how large everything is.
 */
export function printBuildManifest(options: {
  root: string;
  outDir?: string;
  phase: 2 | 3;
  headExtras?: string;
  budget?: BuildManifestBudget;
}): BuildManifest {
  const { root, outDir = DEFAULT_OUT_DIR, phase, headExtras = '', budget = {} } = options;
  const timestamp = new Date().toISOString();

  // Gather data
  const clientData = scanClientBuild(root, outDir);
  const htmlPages = phase === 3 ? scanSSGOutput(root, outDir) : [];
  const headExtrasSize = new TextEncoder().encode(headExtras).length;

  // Budget thresholds
  const ISLAND_BUDGET_KB = budget.islandKB ?? 50; // Warn if single island > 50KB by default.
  const TOTAL_JS_BUDGET_KB = budget.totalJsKB ?? 200; // Warn if total JS > 200KB by default.
  const PAGE_BUDGET_KB = budget.pageKB ?? 200; // Advisory only: single uncompressed HTML page budget.

  const warnings: string[] = [];

  // Check island budgets
  for (const island of clientData.islands) {
    if (island.sizeBytes > ISLAND_BUDGET_KB * 1024) {
      warnings.push(
        `Warning: ${island.name} (${island.sizeKB}) exceeds ${ISLAND_BUDGET_KB} KB budget`,
      );
    }
  }

  // Check total JS budget
  if (clientData.totalJsBytes > TOTAL_JS_BUDGET_KB * 1024) {
    warnings.push(
      `Warning: Total JS (${
        formatSize(clientData.totalJsBytes)
      }) exceeds ${TOTAL_JS_BUDGET_KB} KB budget`,
    );
  }

  // Check page sizes
  for (const page of htmlPages) {
    if (page.sizeBytes > PAGE_BUDGET_KB * 1024) {
      warnings.push(
        `Warning: ${page.path} (${page.sizeKB}) exceeds advisory ${PAGE_BUDGET_KB} KB HTML budget - consider compression`,
      );
    }
  }

  const manifest: BuildManifest = {
    phase,
    timestamp,
    islands: clientData.islands,
    clientEntry: clientData.clientEntry,
    htmlPages,
    totalJsBytes: clientData.totalJsBytes,
    totalHtmlBytes: htmlPages.reduce((sum, p) => sum + p.sizeBytes, 0),
    headExtrasSize,
    warnings,
  };

  // Print table using ASCII-only output so build logs remain portable.
  console.info('');
  console.info(`== openElement Build Manifest - Phase ${phase} @ ${timestamp.slice(11, 19)} ==`);

  if (manifest.islands.length > 0 || manifest.clientEntry) {
    console.info('\n  Client Islands:');
    console.info('  File                         Size');
    console.info('  --------------------------   --------');

    for (const island of manifest.islands) {
      const displayName = island.name.length > 30 ? island.name.slice(0, 27) + '...' : island.name;
      console.info(`  ${displayName.padEnd(26)}   ${island.sizeKB.padEnd(8)}`);
    }

    if (manifest.clientEntry) {
      console.info(
        `  ${'client.js (entry)'.padEnd(26)}   ${manifest.clientEntry.sizeKB.padEnd(8)}`,
      );
    }

    console.info('  --------------------------   --------');
    console.info(`  ${'TOTAL JS'.padEnd(26)}   ${formatSize(manifest.totalJsBytes).padEnd(8)}`);
  } else {
    console.info('\n  Client Islands: none - zero client JS');
  }

  if (phase === 3 && manifest.htmlPages.length > 0) {
    console.info(
      `\n  HTML Pages (${manifest.htmlPages.length} files, ${
        formatSize(manifest.totalHtmlBytes)
      } total):`,
    );

    const maxShow = 15;
    const shown = manifest.htmlPages.slice(0, maxShow);
    for (const page of shown) {
      const displayName = page.path.length > 40 ? page.path.slice(0, 37) + '...' : page.path;
      console.info(`    - ${displayName} (${page.sizeKB})`);
    }
    if (manifest.htmlPages.length > maxShow) {
      console.info(`    ... +${manifest.htmlPages.length - maxShow} more pages`);
    }
  }

  if (manifest.headExtrasSize > 0) {
    console.info(
      `\n  headExtras: ${
        formatSize(manifest.headExtrasSize)
      } (${manifest.headExtrasSize} bytes injected)`,
    );
  }

  if (warnings.length > 0) {
    console.info('\n  Budget Warnings:');
    for (const w of warnings) {
      console.info(`     ${w}`);
    }
  } else {
    console.info('\n  All artifacts within budget limits');
  }

  console.info('');

  return manifest;
}
