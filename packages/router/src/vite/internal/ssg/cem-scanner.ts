/** CEM manifest discovery and compatibility classification. */
import type { CompatibilityClassification } from '../../framework.ts';
import { createLogger } from '@openelement/element';
import { join } from 'pathe';
import { classifyCemManifest, parseCem } from './cem-compat.ts';
import { safeReadDir, safeReadFile } from './route-scanner-fs.ts';

const log = createLogger('cem-scan');

export interface CemScanResult {
  packageName: string;
  cemPath: string;
  json: string;
}

/**
 * One package whose CEM manifest could not be classified: the per-item
 * degradation record (Tier-2) — the scan proceeds without that package's
 * classifications, and the reason travels to the envelope channel (#1612)
 * instead of a debug-only drop.
 */
export interface SkippedCemManifest {
  packageName: string;
  reason: string;
}

/**
 * The detection result envelope. `skipped` carries every package whose
 * manifest was present but unclassifiable, each with its reason; a missing
 * CEM directory (or a tree with no manifests at all) is a legal empty result
 * — `classifications` and `skipped` both empty, nothing reported.
 */
export interface CemDetectionResult {
  classifications: CompatibilityClassification[];
  skipped: SkippedCemManifest[];
}

export async function scanCemManifests(nodeModulesDir: string): Promise<CemScanResult[]> {
  const results: CemScanResult[] = [];
  const entries = await safeReadDir(nodeModulesDir);
  if (!entries) return results;

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      const scopeDir = join(nodeModulesDir, entry);
      const scopedEntries = await safeReadDir(scopeDir);
      if (!scopedEntries) continue;
      for (const scopedEntry of scopedEntries) {
        if (scopedEntry.startsWith('.')) continue;
        const packageName = `${entry}/${scopedEntry}`;
        const cemPath = join(nodeModulesDir, entry, scopedEntry, 'custom-elements.json');
        const result = await tryReadCemFile(cemPath, packageName);
        if (result) results.push(result);
      }
    } else {
      const cemPath = join(nodeModulesDir, entry, 'custom-elements.json');
      const result = await tryReadCemFile(cemPath, entry);
      if (result) results.push(result);
    }
  }
  return results;
}

async function tryReadCemFile(cemPath: string, packageName: string): Promise<CemScanResult | null> {
  const json = await safeReadFile(cemPath);
  return json === undefined ? null : { packageName, cemPath, json };
}

/**
 * Detect and classify every package's CEM manifest under `nodeModulesDir`.
 *
 * A package whose custom-elements.json is PRESENT but unparseable is the
 * per-item degradation class: it lands in `skipped` with its parse reason
 * (reported by the consumer through the envelope channel, never a silent
 * debug drop). A missing manifest is not a skip — most packages ship none.
 * A failure of the scan channel itself (a directory listing I/O error) still
 * throws, so the buildStart boundary fails closed (Tier-1) instead of
 * classifying a half-read tree as complete.
 */
export async function detectAndClassifyCemPackages(
  nodeModulesDir: string,
): Promise<CemDetectionResult> {
  const cemResults = await scanCemManifests(nodeModulesDir);
  if (cemResults.length === 0) return { classifications: [], skipped: [] };
  const classifications: CompatibilityClassification[] = [];
  const skipped: SkippedCemManifest[] = [];

  for (const { packageName, json } of cemResults) {
    const parseResult = parseCem(json);
    if (!parseResult.success || !parseResult.manifest) {
      skipped.push({
        packageName,
        reason: parseResult.errors.map((error) => error.message).join('; '),
      });
      continue;
    }
    const classResult = classifyCemManifest({ ...parseResult.manifest, packageName });
    const { stats } = classResult;
    if (stats.totalComponents > 0) {
      log.info(
        `CEM: ${packageName} - ${stats.totalComponents} component(s): ` +
          `${stats.ssrCapableCount} ssr-capable, ${stats.clientOnlyCount} client-only` +
          (stats.rejectedCount > 0 ? `, ${stats.rejectedCount} rejected` : '') +
          (stats.experimentalDomCount > 0 ? `, ${stats.experimentalDomCount} experimental` : ''),
      );
    }
    classifications.push(...classResult.classifications);
  }
  return { classifications, skipped };
}
