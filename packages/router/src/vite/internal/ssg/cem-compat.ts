import type {
  CompatibilityClassification,
  CompatibilityTier,
  HydrationStrategy,
} from '../protocol/framework.ts';
import { formatError, isValidTagName } from '@openelement/element';

export interface OpenElementExtensions {
  ssr?: boolean;
  dsd?: boolean;
  layer?: string;
  hydrate?: HydrationStrategy;
  module?: string;
  export?: string;
}

interface CemBase {
  kind?: string;
  name?: string;
  [key: string]: unknown;
}
interface CemCustomElement extends CemBase {
  kind: 'custom-element';
  tagName?: string;
  superClass?: { name?: string };
  openElement?: OpenElementExtensions;
}
interface CemModule {
  kind?: string;
  path: string;
  declarations?: CemBase[];
  exports?: { declaration?: unknown }[];
}
interface CustomElementsManifest {
  schemaVersion?: string;
  packageName?: string;
  version?: string;
  modules: CemModule[];
  [key: string]: unknown;
}
interface CemParseError {
  code: string;
  message: string;
  path?: string;
}
interface CemParseWarning {
  code: string;
  message: string;
  path?: string;
}
interface CemParseResult {
  success: boolean;
  manifest?: CustomElementsManifest;
  errors: CemParseError[];
  warnings: CemParseWarning[];
}
interface CemClassificationResult {
  classifications: CompatibilityClassification[];
  rejectedTags: string[];
  ssrCapableTags: string[];
  clientOnlyTags: string[];
  experimentalDomTags: string[];
  stats: {
    totalComponents: number;
    ssrCapableCount: number;
    clientOnlyCount: number;
    rejectedCount: number;
    experimentalDomCount: number;
  };
}

function isCemCustomElement(declaration: CemBase): declaration is CemCustomElement {
  return declaration.kind === 'custom-element';
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function toCemBaseArray(value: unknown): CemBase[] | undefined {
  return Array.isArray(value) ? value.filter(isRecord) : undefined;
}
function toCemExports(value: unknown): { declaration?: unknown }[] | undefined {
  return Array.isArray(value)
    ? value.filter(isRecord).map((entry) => ({ declaration: entry.declaration }))
    : undefined;
}
function toCemModule(value: unknown): CemModule | undefined {
  if (!isRecord(value)) return undefined;
  return {
    kind: typeof value.kind === 'string' ? value.kind : undefined,
    path: typeof value.path === 'string' ? value.path : '',
    declarations: toCemBaseArray(value.declarations),
    exports: toCemExports(value.exports),
  };
}

export function parseCem(json: string): CemParseResult {
  const errors: CemParseError[] = [];
  const warnings: CemParseWarning[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    errors.push({ code: 'CEM_PARSE_ERROR', message: `Invalid JSON: ${formatError(error)}` });
    return { success: false, errors, warnings };
  }
  if (!isRecord(parsed)) {
    errors.push({ code: 'CEM_INVALID_ROOT', message: 'Manifest root must be an object' });
    return { success: false, errors, warnings };
  }
  const root = parsed;
  if (!root.schemaVersion) {
    warnings.push({
      code: 'CEM_NO_SCHEMA_VERSION',
      message: 'Missing schemaVersion field, assuming legacy format',
    });
  }
  if (!Array.isArray(root.modules)) {
    errors.push({ code: 'CEM_NO_MODULES', message: 'Manifest must have a modules array' });
    return { success: false, errors, warnings };
  }
  const manifest: CustomElementsManifest = {
    ...root,
    schemaVersion: typeof root.schemaVersion === 'string' ? root.schemaVersion : undefined,
    packageName: typeof root.packageName === 'string' ? root.packageName : undefined,
    version: typeof root.version === 'string' ? root.version : undefined,
    modules: root.modules.map((module) => toCemModule(module) ?? { path: '' }),
  };
  const seenTagNames = new Set<string>();
  for (let i = 0; i < manifest.modules.length; i++) {
    const cemModule = manifest.modules[i];
    const modulePath = `modules[${i}]`;
    if (!cemModule.kind) {
      warnings.push({
        code: 'CEM_MODULE_NO_KIND',
        message: `Module at index ${i} has no kind field`,
        path: modulePath,
      });
    }
    if (!cemModule.path) {
      errors.push({
        code: 'CEM_MODULE_NO_PATH',
        message: `Module at index ${i} has no path field`,
        path: modulePath,
      });
    }
    for (const [j, declaration] of (cemModule.declarations ?? []).entries()) {
      if (!isCemCustomElement(declaration)) continue;
      const declarationPath = `${modulePath}.declarations[${j}]`;
      const tagName = declaration.tagName;
      if (!tagName) {
        errors.push({
          code: 'CEM_CE_NO_TAG_NAME',
          message: `Custom element at ${declarationPath} has no tagName`,
          path: declarationPath,
        });
      } else if (!isValidTagName(tagName)) {
        errors.push({
          code: 'CEM_CE_INVALID_TAG_NAME',
          message: `Invalid tag name: ${tagName} (must contain a hyphen and match HTML spec)`,
          path: declarationPath,
        });
      } else if (seenTagNames.has(tagName)) {
        errors.push({
          code: 'CEM_CE_DUPLICATE_TAG',
          message: `Duplicate tag name: ${tagName}`,
          path: declarationPath,
        });
      } else {
        seenTagNames.add(tagName);
      }
    }
    for (const [j, exported] of (cemModule.exports ?? []).entries()) {
      if (!exported.declaration) {
        errors.push({
          code: 'CEM_EXPORT_NO_DECLARATION',
          message: `Export at ${modulePath}.exports[${j}] has no declaration reference`,
          path: `${modulePath}.exports[${j}]`,
        });
      }
    }
  }
  return {
    success: errors.length === 0,
    manifest: errors.length === 0 ? manifest : undefined,
    errors,
    warnings,
  };
}

export function classifyCemManifest(manifest: CustomElementsManifest): CemClassificationResult {
  const classifications: CompatibilityClassification[] = [];
  const seenTags = new Map<string, CompatibilityClassification>();
  for (const module of manifest.modules) {
    for (const declaration of module.declarations ?? []) {
      if (!isCemCustomElement(declaration) || !declaration.tagName) continue;
      if (seenTags.has(declaration.tagName)) {
        classifications.push({
          tagName: declaration.tagName,
          tier: 'rejected',
          reason: `Duplicate tag name: ${declaration.tagName}`,
          source: 'package',
          modulePath: module.path,
          ssr: false,
          dsd: false,
          hydrate: 'idle',
        });
        continue;
      }
      const classification = classifyCemDeclaration(manifest, module, declaration);
      classifications.push(classification);
      seenTags.set(declaration.tagName, classification);
    }
  }
  const rejectedTags: string[] = [];
  const ssrCapableTags: string[] = [];
  const clientOnlyTags: string[] = [];
  const experimentalDomTags: string[] = [];
  const buckets: Record<string, string[]> = {
    rejected: rejectedTags,
    'ssr-capable': ssrCapableTags,
    'client-only': clientOnlyTags,
    'experimental-dom': experimentalDomTags,
  };
  for (const classification of classifications) {
    buckets[classification.tier]?.push(classification.tagName);
  }
  return {
    classifications,
    rejectedTags,
    ssrCapableTags,
    clientOnlyTags,
    experimentalDomTags,
    stats: {
      totalComponents: classifications.length,
      ssrCapableCount: ssrCapableTags.length,
      clientOnlyCount: clientOnlyTags.length,
      rejectedCount: rejectedTags.length,
      experimentalDomCount: experimentalDomTags.length,
    },
  };
}

function classifyCemDeclaration(
  manifest: CustomElementsManifest,
  module: CemModule,
  declaration: CemCustomElement,
): CompatibilityClassification {
  const openElement = declaration.openElement;
  const ssr = openElement?.ssr ?? false;
  const dsd = openElement?.dsd ?? false;
  const hydrate = openElement?.hydrate ?? 'idle';
  let tier: CompatibilityTier = 'client-only';
  let reason = manifest.packageName
    ? `CEM-only package ${manifest.packageName} (no openElement SSR declaration)`
    : 'CEM-only package (no openElement SSR declaration)';
  if (openElement?.ssr === true) {
    if (openElement.layer) {
      tier = 'ssr-capable';
      reason = `ssr: true with layer: ${openElement.layer}`;
    } else {
      reason = 'ssr: true but no adapter/layer declared';
    }
  } else if (openElement?.ssr === false) {
    reason = 'ssr: false (explicit client-only)';
  }
  return {
    tagName: declaration.tagName!,
    tier,
    reason,
    source: 'package',
    modulePath: module.path,
    ssr,
    dsd,
    hydrate,
  };
}
