/**
 * foreign-tag-scanner.ts — #979 (0.43.0-alpha.2): foreign custom-element tag
 * discovery.
 *
 * The SSR admission plan historically only saw island declarations, so a
 * third-party Web Component consumed in JSX (<sl-button>, <md-switch>, a
 * bare-native element) never entered the scan at all. This module statically
 * scans page route and island module sources for custom-element tag usages
 * and reports the tags that are neither local islands, package-manifest
 * islands, nor openElement-authored elements (defineElement/defineIsland/
 * customElements.define within the scanned sources).
 *
 * Visibility only: the discovered tags are recorded in the admission plan as
 * explicit client-only entries. SSR rendering and hydration behavior are
 * unchanged — foreign tags remain an opaque passthrough.
 *
 * Compiler semantic analysis owns TSX/tag meaning; this adapter only reads
 * files and aggregates the returned module facts.
 */
import { createLogger } from '@openelement/element';
import { join } from 'node:path';
import { safeReadFile } from './route-scanner-fs.ts';
import { analyzeModuleSemantics } from '@openelement/element/compiler';

const log = createLogger('foreign-tag-scan');

/** Extract custom-element tags the compiler semantic core sees as definitions. */
export function collectDefinedTags(source: string): Set<string> {
  return new Set(analyzeModuleSemantics(source, 'foreign-tag-module.tsx').definedCustomElementTags);
}

/** Extract compiler-proven custom-element JSX references. */
export function collectUsedTags(source: string): Set<string> {
  return new Set(
    analyzeModuleSemantics(source, 'foreign-tag-module.tsx').referencedCustomElementTags,
  );
}

/**
 * Discover foreign custom-element tags across the given module sources.
 *
 * A tag is foreign when it is used in JSX but is not in `knownTags` (local
 * islands, package-manifest declarations, route registration tags) and is not
 * defined by any of the scanned sources themselves.
 */
export function discoverForeignTags(
  sources: string[],
  knownTags: ReadonlySet<string>,
): string[] {
  const used = new Set<string>();
  const defined = new Set<string>();
  for (const source of sources) {
    for (const tag of collectUsedTags(source)) used.add(tag);
    for (const tag of collectDefinedTags(source)) defined.add(tag);
  }
  const foreign = [...used].filter((tag) => !knownTags.has(tag) && !defined.has(tag));
  return foreign.sort();
}

export interface ScanForeignTagsOptions {
  /** Absolute routes directory; routeFiles are relative to it. */
  routesDir: string;
  /** Absolute islands directory; islandFiles are relative to it. */
  islandsDir: string;
  /** Page route file paths (relative to routesDir). */
  routeFiles: string[];
  /** Island file paths (relative to islandsDir). */
  islandFiles: string[];
  /** Tags the scan must never report: islands, package declarations, route tags. */
  knownTags: ReadonlySet<string>;
}

/**
 * Read page route + island module sources from disk and discover the foreign
 * custom-element tags they consume. Unreadable modules are skipped (same
 * posture as scanIslandMeta); the scan never executes module code.
 */
export async function scanForeignTags(options: ScanForeignTagsOptions): Promise<string[]> {
  const sources: string[] = [];
  const readInto = async (dir: string, files: string[]): Promise<void> => {
    for (const file of files) {
      const fullPath = join(dir, file);
      const source = await safeReadFile(fullPath);
      if (source === undefined) {
        log.debug(`Unable to read module for foreign-tag scan: ${fullPath}`);
        continue;
      }
      sources.push(source);
    }
  };
  await readInto(options.routesDir, options.routeFiles);
  await readInto(options.islandsDir, options.islandFiles);
  return discoverForeignTags(sources, options.knownTags);
}
