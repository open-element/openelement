/** Island and package-manifest discovery without executing local island modules. */
import ts from 'typescript';
import type { HydrationStrategy, OpenElementPackageManifest } from '../protocol/framework.ts';
import type { IslandDecl } from '../protocol/ssg.ts';
import { formatError, isValidTagName, OpenElementError } from '@openelement/element';
import { createLogger } from '@openelement/element';
import { normalizeSeparators, pathToTagName } from '@openelement/element/build-utils';
import { join } from '../../../internal/host-path.ts';
import { safeReadDir, safeReadFile, safeStat } from './route-scanner-fs.ts';
import {
  ISLAND_DELIVERY_STRATEGIES,
  type IslandDeliveryMeta,
  type IslandDeliveryStrategy,
  resolveIslandDeliveryTags,
  validateIslandDeliveryExportNames,
  validateIslandDeliveryTags,
  validateIslandMediaQuery,
} from './delivery.ts';

const log = createLogger('island-scan');

/** Local island metadata indexed by tag name. */
export interface LocalIslandMeta {
  tagName: string;
  filePath: string;
  ssr?: boolean;
  dsd?: boolean;
  hydrate?: IslandDeliveryStrategy;
  /** Required when hydrate is media; kept as build metadata, not runtime. */
  media?: string;
  /** Optional one-to-many custom-element capability names. */
  tags?: string[];
  /** Alias accepted by generated artifact producers. */
  tagNames?: string[];
  /** Named constructor exports keyed by delivered tag. */
  exportNames?: Record<string, string>;
  reason?: string;
}

/** Island metadata stored in the build context. */
export type StoredIslandMeta = LocalIslandMeta & Partial<IslandDecl>;

/**
 * Single source of truth for island render directives (alpha.17 B1).
 *
 * Previously the `hydrate === 'only' ? false : meta?.ssr` coercion and the
 * `hydrate || upgradeStrategy || 'idle'` fallback were copied across
 * plugin.ts, entry-descriptor.ts, island-scanner.ts and build-client.ts,
 * and the copies had diverged (package islands in plugin.ts skipped the
 * upgrade-strategy fallback).
 */

/** Coerce ssr/dsd for client:only islands: hydrate 'only' forces both off. */
export function resolveIslandSsrDsd(meta: {
  ssr?: boolean;
  dsd?: boolean;
  hydrate?: HydrationStrategy | IslandDeliveryStrategy;
  media?: string;
}): { ssr?: boolean; dsd?: boolean } {
  const clientOnly = meta.hydrate === 'only';
  return {
    ssr: clientOnly ? false : meta.ssr,
    dsd: clientOnly ? false : meta.dsd,
  };
}

/** Effective island upgrade strategy: island metadata -> configured upgrade strategy -> 'idle'. */
export function resolveIslandHydrate(
  hydrate: IslandDeliveryStrategy | undefined,
  upgradeStrategy?: HydrationStrategy,
): IslandDeliveryStrategy;
export function resolveIslandHydrate(
  hydrate: HydrationStrategy | IslandDeliveryStrategy | undefined,
  upgradeStrategy?: HydrationStrategy,
): IslandDeliveryStrategy {
  return hydrate || upgradeStrategy || 'idle';
}

/**
 * Expand a one-to-many capability declaration for the server-side admission
 * graph. The compiler/runtime artifact remains the single module authority;
 * this expansion only gives each delivered native tag its own admission and
 * registration identity.
 */
export function expandIslandDeliveryDecl(island: IslandDecl): IslandDecl[] {
  const delivery = island as IslandDecl & {
    tags?: readonly string[];
    tagNames?: readonly string[];
    exportNames?: Readonly<Record<string, string>>;
  };
  const hasDeliveryTags = delivery.tags !== undefined || delivery.tagNames !== undefined;
  const tags = hasDeliveryTags
    ? resolveIslandDeliveryTags(
      island.tagName,
      delivery.tags,
      delivery.tagNames,
      island.tagName,
    )
    : [island.tagName];
  const exportNames = validateIslandDeliveryExportNames(
    delivery.exportNames,
    tags,
    island.tagName,
  );
  const {
    tags: _tags,
    tagNames: _tagNames,
    exportNames: _exportNames,
    ...base
  } = delivery;
  return tags.map((tagName) => ({
    ...base,
    tagName,
    ...(exportNames?.[tagName] === undefined ? {} : { exportName: exportNames[tagName] }),
  })) as IslandDecl[];
}

/** Package island declaration with delivery aliases resolved. */
export type DeliveryIslandDecl = IslandDecl & IslandDeliveryMeta;

/**
 * Build package island declarations from scanned package manifests.
 *
 * Shared implementation for plugin.ts (build-time scan) and
 * entry-descriptor.ts (descriptor build) so both paths apply the same
 * source:'package' tagging and hydrate/ssr/dsd resolution.
 */
export function buildPackageIslandDecls(
  packageManifests: OpenElementPackageManifest[],
  upgradeStrategy?: HydrationStrategy,
): IslandDecl[] {
  const decls: DeliveryIslandDecl[] = packageManifests.flatMap((pkg) =>
    pkg.declarations
      .filter((d) => d.openElement?.module)
      .map((d) => {
        const openElement = d.openElement;
        const modulePath = openElement?.module;
        if (!modulePath) {
          throw new Error(
            `Package manifest declaration "${d.tagName}" is missing openElement.module`,
          );
        }
        const declarationDelivery = d as typeof d & {
          tags?: readonly string[];
          tagNames?: readonly string[];
          exportNames?: Readonly<Record<string, string>>;
        };
        const delivery = openElement as typeof openElement & {
          hydrate?: IslandDeliveryStrategy;
          media?: unknown;
          tags?: readonly string[];
          tagNames?: readonly string[];
          exportNames?: Readonly<Record<string, string>>;
        };
        const tags = resolveIslandDeliveryTags(
          d.tagName,
          declarationDelivery.tags ?? delivery.tags,
          declarationDelivery.tagNames ?? delivery.tagNames,
          d.tagName,
        );
        validateIslandDeliveryTags(tags, d.tagName);
        const exportNames = validateIslandDeliveryExportNames(
          declarationDelivery.exportNames ?? delivery.exportNames,
          tags,
          d.tagName,
        );
        const hydrate = resolveIslandHydrate(
          delivery.hydrate as IslandDeliveryStrategy | undefined,
          upgradeStrategy,
        );
        const media = delivery.media === undefined
          ? undefined
          : validateIslandMediaQuery(delivery.media, d.tagName);
        if (hydrate === 'media' && media === undefined) {
          throw new Error(`Package island "${d.tagName}" uses media delivery without media`);
        }
        if (hydrate !== 'media' && media !== undefined) {
          throw new Error(`Package island "${d.tagName}" declares media without media delivery`);
        }
        return {
          tagName: d.tagName,
          modulePath,
          isPackage: true,
          source: 'package' as const,
          // #638: package island chunks dropped `export default`; the client
          // island factory must read the named export (CEM class name) instead.
          exportName: exportNames?.[d.tagName] ?? d.className,
          hydrate,
          ...(media === undefined ? {} : { media }),
          ...(tags.length > 0 ? { tags } : {}),
          ...(exportNames === undefined ? {} : { exportNames }),
          ...resolveIslandSsrDsd(openElement ?? {}),
        };
      })
  );
  return decls;
}

function staticOpenElementError(message: string): OpenElementError {
  return new OpenElementError(
    `Invalid static island metadata export "openElement": ${message}. Accepted shape: export const openElement = defineIslandConfig({ ssr?: boolean, dsd?: boolean, hydrate?: "load" | "idle" | "visible" | "media" | "only", media?: string }).`,
    {
      code: 'ISLAND_METADATA_ERROR',
      statusCode: 500,
      recoverable: false,
    },
  );
}

/** Static island metadata literal read from defineIslandConfig(). */
type StaticIslandConfig = Pick<
  LocalIslandMeta,
  'ssr' | 'dsd' | 'hydrate' | 'media' | 'tags' | 'tagNames' | 'exportNames'
>;

function staticEntryKey(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || (ts.isStringLiteral(name) && name.text.length > 0)) {
    return name.text;
  }
  throw staticOpenElementError('metadata keys must be identifiers or string literals');
}

function staticEntries(objectLiteral: ts.ObjectLiteralExpression): Array<[string, ts.Expression]> {
  return objectLiteral.properties.map((property) => {
    if (!ts.isPropertyAssignment(property)) {
      throw staticOpenElementError('metadata must contain key/value pairs');
    }
    return [staticEntryKey(property.name), property.initializer];
  });
}

function staticStringValue(node: ts.Expression, context: string): string {
  if (!ts.isStringLiteral(node)) {
    throw staticOpenElementError(context + ' must be a string literal');
  }
  return node.text;
}

function parseStaticStringArray(node: ts.Expression, context: string): string[] {
  if (!ts.isArrayLiteralExpression(node)) {
    throw staticOpenElementError(context + ' must be an array of string literals');
  }
  if (node.elements.length === 0) throw staticOpenElementError(context + ' must not be empty');
  return node.elements.map((element) => staticStringValue(element, context));
}

function parseStaticStringRecord(node: ts.Expression, context: string): Record<string, string> {
  if (!ts.isObjectLiteralExpression(node)) {
    throw staticOpenElementError(context + ' must be an object of string literals');
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of staticEntries(node)) {
    result[key] = staticStringValue(entry, context + '.' + key);
  }
  return result;
}

/** Locate the defineIslandConfig() call the openElement export initializes to. */
function locateDefineIslandConfigCall(initializer: ts.Expression): ts.CallExpression {
  let node = initializer;
  let wrapped = false;
  for (;;) {
    if (
      ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineIslandConfig'
    ) {
      if (wrapped) {
        throw staticOpenElementError(
          'defineIslandConfig() argument must be one static object literal',
        );
      }
      return node;
    }
    if (
      !ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node) &&
      !ts.isCallExpression(node)
    ) {
      throw staticOpenElementError('openElement export must call defineIslandConfig(...)');
    }
    node = node.expression;
    wrapped = true;
  }
}

function parseStaticIslandConfig(
  objectLiteral: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): StaticIslandConfig {
  const literalText = (raw: ts.Expression, context: string): string => {
    if (!ts.isStringLiteral(raw)) {
      throw staticOpenElementError(
        `${context} must be a static literal, got dynamic value "${raw.getText(sourceFile)}"`,
      );
    }
    return raw.text;
  };
  const meta: StaticIslandConfig = {};
  const seen = new Set<string>();
  for (const [key, raw] of staticEntries(objectLiteral)) {
    if (seen.has(key)) throw staticOpenElementError(`duplicate metadata key "${key}"`);
    seen.add(key);
    if (!['ssr', 'dsd', 'hydrate', 'media', 'tags', 'tagNames', 'exportNames'].includes(key)) {
      throw staticOpenElementError(`unsupported openElement metadata key "${key}"`);
    }
    if (key === 'ssr' || key === 'dsd') {
      if (raw.kind !== ts.SyntaxKind.TrueKeyword && raw.kind !== ts.SyntaxKind.FalseKeyword) {
        throw staticOpenElementError(
          `openElement.${key} must be a static literal, got dynamic value "${
            raw.getText(sourceFile)
          }"`,
        );
      }
      meta[key] = raw.kind === ts.SyntaxKind.TrueKeyword;
    } else if (key === 'hydrate') {
      const value = literalText(raw, 'openElement.hydrate');
      if (!(ISLAND_DELIVERY_STRATEGIES as readonly string[]).includes(value)) {
        throw staticOpenElementError(`openElement.hydrate has unsupported value "${value}"`);
      }
      meta.hydrate = value as IslandDeliveryStrategy;
    } else if (key === 'media') {
      meta.media = validateIslandMediaQuery(
        literalText(raw, 'openElement.media'),
        'openElement.media',
      );
    } else if (key === 'tags' || key === 'tagNames') {
      meta[key] = parseStaticStringArray(raw, `openElement.${key}`);
    } else {
      meta.exportNames = parseStaticStringRecord(raw, 'openElement.exportNames');
    }
  }

  if (meta.tags !== undefined || meta.tagNames !== undefined) {
    const tags = resolveIslandDeliveryTags(
      'island-capability',
      meta.tags,
      meta.tagNames,
      'openElement',
    );
    validateIslandDeliveryTags(tags, 'openElement');
  }
  const deliveryTags = meta.tags ?? meta.tagNames;
  if (meta.exportNames !== undefined) {
    for (const [tag, exportName] of Object.entries(meta.exportNames)) {
      if (
        !isValidTagName(tag) ||
        (deliveryTags !== undefined && !deliveryTags.includes(tag)) ||
        exportName.trim() === '' ||
        (() => {
          for (let index = 0; index < exportName.length; index++) {
            const code = exportName.charCodeAt(index);
            if (code <= 0x1f || code === 0x7f) return true;
          }
          return false;
        })()
      ) {
        throw staticOpenElementError(`openElement.exportNames has an invalid entry for "${tag}"`);
      }
    }
  }
  if (meta.media !== undefined && meta.hydrate !== 'media') {
    throw staticOpenElementError('openElement.media is only valid when hydrate is "media"');
  }
  if (meta.hydrate === 'media' && meta.media === undefined) {
    throw staticOpenElementError('openElement.media is required when hydrate is "media"');
  }
  return meta;
}

/**
 * Statically extract `export const openElement = defineIslandConfig({ ... })`.
 *
 * The scanner intentionally does not execute island modules. It locates the
 * defineIslandConfig() call through the TypeScript compiler front-end — the
 * same parser the compiler and sibling scanners use — and accepts only a call
 * with literal metadata. Dynamic metadata is rejected instead of guessed so
 * the server admission plan and client manifest cannot disagree.
 */
export function readIslandConfig(source: string): StaticIslandConfig | null {
  const sourceFile = ts.createSourceFile(
    'island-module.tsx',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  let initializer: ts.Expression | undefined;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) !==
        true
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) && declaration.name.text === 'openElement' &&
        declaration.initializer !== undefined
      ) {
        initializer = declaration.initializer;
        break;
      }
    }
    if (initializer !== undefined) break;
  }
  if (initializer === undefined) return null;

  const call = locateDefineIslandConfigCall(initializer);
  if (call.arguments.length === 0 || !ts.isObjectLiteralExpression(call.arguments[0])) {
    throw staticOpenElementError('defineIslandConfig() argument must be a static object literal');
  }
  if (call.arguments.length > 1) {
    throw staticOpenElementError('defineIslandConfig() argument must be one static object literal');
  }
  return parseStaticIslandConfig(call.arguments[0], sourceFile);
}

/**
 * Scan islands directory recursively for island files.
 * Returns POSIX-separator paths relative to islandsDir (e.g.,
 * ['my-counter.ts', 'posts/index.ts']). node:path join() emits backslashes on
 * Windows, but these segments become module specifiers and tag names, so they
 * are normalized here (#460); join() still reads them back fine on Windows.
 */
export async function scanIslands(
  islandsDir: string,
  relativeDir: string = '',
): Promise<string[]> {
  const files: string[] = [];
  const entries = await safeReadDir(islandsDir);

  if (entries === undefined) {
    log.debug(`Islands directory "${islandsDir}" not found`);
    return files;
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;

    const fullPath = join(islandsDir, entry);
    const fileStat = await safeStat(fullPath);
    if (!fileStat) {
      log.debug(`Island file vanished before stat: ${fullPath}`);
      continue;
    }

    const relativePath = relativeDir ? join(relativeDir, entry) : entry;

    if (fileStat.isDirectory) {
      const subFiles = await scanIslands(fullPath, relativePath);
      files.push(...subFiles);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      files.push(normalizeSeparators(relativePath));
    }
  }

  return files.sort();
}

/**
 * v0.41.0-alpha.1: AST-based — reads island metadata by statically scanning the
 * module source for `export const openElement = defineIslandConfig({ ... })`
 * (see readIslandConfig). Island modules are never executed.
 *
 * Supported form:
 *   export const openElement = defineIslandConfig({ ssr: false, dsd: false, hydrate: 'only' })
 *
 * hydrate:'only' coerces ssr/dsd to false via resolveIslandSsrDsd(). The
 * hydrate fallback chain is NOT applied here — scanIslandMeta records raw
 * authoring intent; resolveIslandHydrate() applies the upgrade-strategy
 * fallback downstream where the configured strategy is known.
 *
 * If a module cannot be read, its metadata is silently skipped.
 */
export async function scanIslandMeta(
  islandsDir: string,
  islandFiles: string[],
): Promise<Record<string, StoredIslandMeta>> {
  const meta: Record<string, LocalIslandMeta> = {};

  for (const filePath of islandFiles) {
    const tagName = pathToTagName(filePath);
    const fullPath = join(islandsDir, filePath);

    const source = await safeReadFile(fullPath);
    if (source === undefined) {
      log.debug(`Unable to read island module for metadata: ${fullPath}`);
      continue;
    }

    const islandConfig = readIslandConfig(source);
    if (!islandConfig) continue;

    // readIslandConfig() already rejects unsupported hydrate values.
    const hydrate = islandConfig.hydrate;

    const { ssr, dsd } = resolveIslandSsrDsd({
      ssr: islandConfig.ssr,
      dsd: islandConfig.dsd,
      hydrate,
      media: islandConfig.media,
    });

    meta[tagName] = {
      tagName,
      filePath,
      ssr,
      dsd,
      hydrate,
      ...(islandConfig.media === undefined ? {} : { media: islandConfig.media }),
      ...(islandConfig.tags === undefined ? {} : { tags: islandConfig.tags }),
      ...(islandConfig.tagNames === undefined ? {} : { tagNames: islandConfig.tagNames }),
      ...(islandConfig.exportNames === undefined ? {} : { exportNames: islandConfig.exportNames }),
      reason: hydrate === 'only'
        ? 'local island exports openElement.hydrate=only'
        : islandConfig.ssr === false
        ? 'local island exports openElement.ssr=false'
        : undefined,
    };
  }

  // Narrow the scanned metadata onto the stored decl view; the runtime
  // objects keep their delivery fields (see StoredIslandMeta).
  return meta as Record<string, StoredIslandMeta>;
}

/**
 * Scan package exports for OpenElementPackageManifest.
 * Packages should export a `manifest` OpenElementPackageManifest in their main entry.
 *
 * Example package export:
 * ```ts
 * // @acme/components/index.ts
 * export { manifest } from './manifest.ts';
 * ```
 *
 * @param packageNames - List of package names to scan (e.g., ['@acme/components'])
 * @returns Array of OpenElementPackageManifest
 */
export async function scanPackageManifests(
  packageNames: string[],
): Promise<OpenElementPackageManifest[]> {
  const allManifests: OpenElementPackageManifest[] = [];

  for (const pkg of packageNames) {
    // @vite-ignore suppresses unanalyzable-dynamic-import JSR warning.
    let mod: Record<string, unknown>;
    try {
      mod = await import(/* @vite-ignore */ pkg) as Record<string, unknown>;
    } catch (e) {
      if (isBrowserOnlyPackageImportError(e)) {
        log.warn(
          `Skipping package manifest from "${pkg}": browser-only package cannot be imported during SSR discovery`,
        );
        continue;
      }
      throw new OpenElementError(
        `Failed to scan package manifest from "${pkg}": ${formatError(e)}`,
        {
          code: 'PACKAGE_SCAN_ERROR',
          statusCode: 500,
          recoverable: false,
        },
      );
    }
    if (mod.manifest && typeof mod.manifest === 'object') {
      const manifest = mod.manifest as OpenElementPackageManifest;
      if (manifest.packageName && manifest.declarations) {
        allManifests.push(manifest);
      } else {
        throw new OpenElementError(
          `Invalid manifest in ${pkg}: missing packageName or declarations`,
          {
            code: 'PACKAGE_MANIFEST_ERROR',
            statusCode: 500,
            recoverable: false,
          },
        );
      }
    } else {
      throw new OpenElementError(
        `Package ${pkg} does not export a manifest`,
        {
          code: 'PACKAGE_MANIFEST_ERROR',
          statusCode: 500,
          recoverable: false,
        },
      );
    }
  }

  return allManifests;
}

/**
 * v0.25: AST-verified — error message classification, regex is the appropriate tool
 * for matching runtime error strings from failed dynamic imports.
 */
function isBrowserOnlyPackageImportError(error: unknown): boolean {
  const message = formatError(error);
  return /\b(window|document|HTMLElement|customElements|navigator)\b.*\bis not defined\b/i.test(
    message,
  );
}
