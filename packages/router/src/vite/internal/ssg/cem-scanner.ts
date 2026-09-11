/** CEM manifest discovery and compatibility classification. */
import type { CompatibilityClassification } from '../protocol/framework.ts';
import { createLogger } from '@openelement/element';
import { join } from 'node:path';
import { classifyCemManifest, parseCem } from './cem-compat.ts';
import { safeReadDir, safeReadFile } from './route-scanner-fs.ts';

const log = createLogger('cem-scan');

export interface CemScanResult {
  packageName: string;
  cemPath: string;
  json: string;
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

export async function detectAndClassifyCemPackages(
  nodeModulesDir: string,
): Promise<CompatibilityClassification[]> {
  const cemResults = await scanCemManifests(nodeModulesDir);
  if (cemResults.length === 0) return [];
  const allClassifications: CompatibilityClassification[] = [];

  for (const { packageName, json } of cemResults) {
    const parseResult = parseCem(json);
    if (!parseResult.success || !parseResult.manifest) {
      log.debug(
        `Skipping invalid CEM manifest from "${packageName}": ` +
          parseResult.errors.map((error) => error.message).join('; '),
      );
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
    allClassifications.push(...classResult.classifications);
  }
  return allClassifications;
}
