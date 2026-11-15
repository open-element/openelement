/**
 * foreign-tag-scanner.ts — #979: foreign custom-element tag discovery.
 *
 * The SSR admission plan sees only island declarations on its own; a
 * third-party Web Component consumed in JSX (<sl-button>, <md-switch>, a
 * bare-native element) would never enter the scan. This module statically
 * scans page route and island module sources for custom-element tag usages
 * and reports the tags that are neither local islands, package-manifest
 * islands, nor openElement-authored elements (defineElement/
 * customElements.define within the scanned sources).
 *
 * Visibility only: the discovered tags are recorded in the admission plan as
 * explicit client-only entries. SSR rendering and hydration behavior are
 * unchanged — foreign tags remain an opaque passthrough.
 *
 * Compiler semantic analysis owns TSX/tag meaning; this adapter only reads
 * files and aggregates the returned module facts.
 */
import { join } from 'pathe';
import { describeError } from '../../../internal/error-codes.ts';
import { safeReadFile } from './route-scanner-fs.ts';
import { analyzeModuleSemantics } from '@openelement/compiler';
import { ROUTER_MODULE_VOCABULARY } from '@openelement/protocol/module-vocabulary';

/** Extract custom-element tags the compiler semantic core sees as definitions. */
export function collectDefinedTags(source: string): Set<string> {
  return new Set(
    analyzeModuleSemantics(source, 'foreign-tag-module.tsx', {
      vocabulary: ROUTER_MODULE_VOCABULARY,
    }).definedCustomElementTags,
  );
}

/** Extract compiler-proven custom-element JSX references. */
export function collectUsedTags(source: string): Set<string> {
  return new Set(
    analyzeModuleSemantics(source, 'foreign-tag-module.tsx', {
      vocabulary: ROUTER_MODULE_VOCABULARY,
    }).referencedCustomElementTags,
  );
}

/**
 * Discover foreign custom-element tags across the given module sources.
 *
 * A tag is foreign when it is used in JSX but is not in `knownTags` (local
 * islands, package-manifest declarations, route registration tags) and is not
 * defined by any of the scanned sources themselves.
 */
export function discoverForeignTags(sources: string[], knownTags: ReadonlySet<string>): string[] {
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
 * One module the scan could not read: the per-item degradation record
 * (Tier-2) — the reason travels with the result to the envelope channel
 * (#1612) instead of a debug-only drop. The scan never executes module code.
 */
export interface UnreadableForeignTagModule {
  path: string;
  reason: string;
}

/**
 * The scan result envelope: the discovered foreign tags plus every module
 * that could not be read, each with its reason. A module that vanished
 * between the file listing and its read (the race the file helpers tolerate)
 * is an `unreadable` entry, not a channel failure — one unreadable module
 * must not erase the rest of the scan.
 */
export interface ForeignTagScanResult {
  foreignTags: string[];
  unreadable: UnreadableForeignTagModule[];
}

/**
 * Read page route + island module sources from disk and discover the foreign
 * custom-element tags they consume.
 */
export async function scanForeignTags(
  options: ScanForeignTagsOptions,
): Promise<ForeignTagScanResult> {
  const sources: string[] = [];
  const unreadable: UnreadableForeignTagModule[] = [];
  const readInto = async (dir: string, files: string[]): Promise<void> => {
    for (const file of files) {
      const fullPath = join(dir, file);
      let source: string | undefined;
      try {
        source = await safeReadFile(fullPath);
      } catch (err) {
        // A single unreadable module is a per-item degradation (Tier-2): the
        // reason is carried on the result, never swallowed — and never
        // promoted to a channel crash that would erase the whole scan.
        unreadable.push({ path: fullPath, reason: describeError(err) });
        continue;
      }
      if (source === undefined) {
        // ENOENT between listing and read: race-tolerant, but reported.
        unreadable.push({
          path: fullPath,
          reason: 'the module does not exist (vanished after the file listing)',
        });
        continue;
      }
      sources.push(source);
    }
  };
  await readInto(options.routesDir, options.routeFiles);
  await readInto(options.islandsDir, options.islandFiles);
  return { foreignTags: discoverForeignTags(sources, options.knownTags), unreadable };
}
