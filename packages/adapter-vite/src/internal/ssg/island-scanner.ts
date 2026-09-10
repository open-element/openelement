/** Island and package-manifest discovery without executing local island modules. */
import type { HydrationStrategy, OpenElementPackageManifest } from '../protocol/framework.ts';
import type { IslandDecl } from '../protocol/ssg.ts';
import { formatError, isValidTagName, OpenElementError } from '@openelement/element';
import { createLogger } from '@openelement/element';
import { normalizeSeparators, pathToTagName } from '@openelement/element/build-utils';
import { join } from 'node:path';
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

function findStaticConfigBody(source: string, from: number): string | undefined {
  const objectStart = source.indexOf('{', from);
  if (objectStart === -1) return undefined;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = objectStart; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(objectStart + 1, index);
  }
  return undefined;
}

function splitStaticValues(value: string): string[] {
  const values: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') depth++;
    else if (char === '}' || char === ']' || char === ')') depth--;
    else if (char === ',' && depth === 0) {
      values.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) values.push(last);
  return values;
}

function findStaticColon(value: string): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') depth++;
    else if (char === '}' || char === ']' || char === ')') depth--;
    else if (char === ':' && depth === 0) return index;
  }
  return -1;
}

function unquoteStaticString(raw: string, context: string): string {
  const value = raw.trim();
  if (
    value.length < 2 ||
    (value[0] !== '"' && value[0] !== "'") ||
    value[value.length - 1] !== value[0]
  ) {
    throw staticOpenElementError(context + ' must be a string literal');
  }
  let result = '';
  for (let index = 1; index < value.length - 1; index++) {
    const char = value[index];
    if (char !== '\\') {
      result += char;
      continue;
    }
    index++;
    const escaped = value[index];
    if (escaped === undefined) throw staticOpenElementError(context + ' has an invalid escape');
    if (escaped === 'b') result += '\b';
    else if (escaped === 'f') result += '\f';
    else if (escaped === 'n') result += '\n';
    else if (escaped === 'r') result += '\r';
    else if (escaped === 't') result += '\t';
    else if (escaped === 'v') result += '\v';
    else if (escaped === '\\' || escaped === "'" || escaped === '"') result += escaped;
    else if (escaped === '0') {
      if (/\d/.test(value[index + 1] ?? '')) {
        throw staticOpenElementError(context + ' has an unsupported octal escape');
      }
      result += '\0';
    } else if (escaped === 'x') {
      const hex = value.slice(index + 1, index + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw staticOpenElementError(context + ' has an invalid hex escape');
      }
      result += String.fromCharCode(Number.parseInt(hex, 16));
      index += 2;
    } else if (escaped === 'u') {
      if (value[index + 1] === '{') {
        const end = value.indexOf('}', index + 2);
        const hex = end === -1 ? '' : value.slice(index + 2, end);
        const code = Number.parseInt(hex, 16);
        if (!/^[0-9a-fA-F]+$/.test(hex) || code > 0x10FFFF) {
          throw staticOpenElementError(context + ' has an invalid Unicode escape');
        }
        result += String.fromCodePoint(code);
        index = end;
      } else {
        const hex = value.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw staticOpenElementError(context + ' has an invalid Unicode escape');
        }
        result += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
      }
    } else if (escaped === '\n') {
      // JavaScript line-continuation escape: it contributes no character.
    } else if (escaped === '\r') {
      if (value[index + 1] === '\n') index++;
    } else {
      throw staticOpenElementError(context + ` has an unsupported escape "\\${escaped}"`);
    }
  }
  return result;
}

function isQuotedStaticString(raw: string): boolean {
  const value = raw.trim();
  return value.length >= 2 &&
    (value[0] === '"' || value[0] === "'") &&
    value[value.length - 1] === value[0];
}

function readStaticProperties(body: string): Array<[string, string]> {
  return splitStaticValues(body).filter(Boolean).map((property) => {
    const colon = findStaticColon(property);
    if (colon === -1) throw staticOpenElementError('metadata must contain key/value pairs');
    const rawKey = property.slice(0, colon).trim();
    const quoted = rawKey.startsWith('"') || rawKey.startsWith("'");
    const key = quoted ? unquoteStaticString(rawKey, 'metadata key') : rawKey;
    if ((quoted && key.length === 0) || (!quoted && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key))) {
      throw staticOpenElementError('metadata keys must be identifiers or string literals');
    }
    return [key, property.slice(colon + 1).trim()] as [string, string];
  });
}

function parseStaticStringArray(raw: string, context: string): string[] {
  const value = raw.trim();
  if (!value.startsWith('[') || !value.endsWith(']')) {
    throw staticOpenElementError(context + ' must be an array of string literals');
  }
  const parts = splitStaticValues(value.slice(1, -1));
  if (parts.length === 0) throw staticOpenElementError(context + ' must not be empty');
  return parts.map((part) => unquoteStaticString(part, context));
}

function parseStaticStringRecord(raw: string, context: string): Record<string, string> {
  const value = raw.trim();
  if (!value.startsWith('{') || !value.endsWith('}')) {
    throw staticOpenElementError(context + ' must be an object of string literals');
  }
  const entries = readStaticProperties(value.slice(1, -1));
  const result: Record<string, string> = {};
  for (const [key, entry] of entries) {
    result[key] = unquoteStaticString(entry, context + '.' + key);
  }
  return result;
}

function parseStaticIslandConfigBody(body: string): {
  ssr?: boolean;
  dsd?: boolean;
  hydrate?: IslandDeliveryStrategy;
  media?: string;
  tags?: string[];
  tagNames?: string[];
  exportNames?: Record<string, string>;
} {
  const meta: {
    ssr?: boolean;
    dsd?: boolean;
    hydrate?: IslandDeliveryStrategy;
    media?: string;
    tags?: string[];
    tagNames?: string[];
    exportNames?: Record<string, string>;
  } = {};
  const seen = new Set<string>();
  for (const [key, raw] of readStaticProperties(body)) {
    if (seen.has(key)) throw staticOpenElementError(`duplicate metadata key "${key}"`);
    seen.add(key);
    if (!['ssr', 'dsd', 'hydrate', 'media', 'tags', 'tagNames', 'exportNames'].includes(key)) {
      throw staticOpenElementError(`unsupported openElement metadata key "${key}"`);
    }
    if (key === 'ssr' || key === 'dsd') {
      if (raw !== 'true' && raw !== 'false') {
        throw staticOpenElementError(
          `openElement.${key} must be a static literal, got dynamic value "${raw}"`,
        );
      }
      meta[key] = raw === 'true';
    } else if (key === 'hydrate') {
      if (!isQuotedStaticString(raw)) {
        throw staticOpenElementError(
          `openElement.hydrate must be a static literal, got dynamic value "${raw}"`,
        );
      }
      const value = unquoteStaticString(raw, 'openElement.hydrate');
      if (!(ISLAND_DELIVERY_STRATEGIES as readonly string[]).includes(value)) {
        throw staticOpenElementError(`openElement.hydrate has unsupported value "${value}"`);
      }
      meta.hydrate = value as IslandDeliveryStrategy;
    } else if (key === 'media') {
      if (!isQuotedStaticString(raw)) {
        throw staticOpenElementError(
          `openElement.media must be a static literal, got dynamic value "${raw}"`,
        );
      }
      meta.media = validateIslandMediaQuery(
        unquoteStaticString(raw, 'openElement.media'),
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
 * The scanner intentionally does not execute island modules. It accepts only a
 * defineIslandConfig() call with literal metadata. Dynamic metadata is rejected
 * instead of guessed so the server admission plan and client manifest cannot
 * disagree.
 */
export function readIslandConfig(source: string): {
  ssr?: boolean;
  dsd?: boolean;
  hydrate?: LocalIslandMeta['hydrate'];
  media?: string;
  tags?: string[];
  tagNames?: string[];
  exportNames?: Record<string, string>;
} | null {
  const declMatch = source.match(/export\s+const\s+openElement\s*=/);
  if (!declMatch) return null;

  const afterEquals = source.slice(declMatch.index! + declMatch[0].length).trimStart();

  // Must call defineIslandConfig(...) - reject legacy object literals.
  const callMatch = afterEquals.match(/^defineIslandConfig\s*\(/);
  if (!callMatch) {
    throw staticOpenElementError('openElement export must call defineIslandConfig(...)');
  }

  const argument = afterEquals.slice(callMatch[0].length).trimStart();
  if (!argument.startsWith('{')) {
    throw staticOpenElementError(
      'defineIslandConfig() argument must be a static object literal',
    );
  }
  const body = findStaticConfigBody(argument, 0);
  if (body === undefined) {
    throw staticOpenElementError(
      'defineIslandConfig() argument must be a static object literal',
    );
  }
  const callTail = argument.slice(body.length + 2).trimStart();
  const afterParen = callTail.startsWith(')') ? callTail.slice(1) : '';
  const continuation = afterParen.trimStart();
  const hasStatementTerminator = afterParen.startsWith(';');
  const hasAutomaticSemicolonBoundary = /^\s*\r?\n/.test(afterParen) &&
    !/^(?:[.[(`]|[+\-*%/&|^!=<>:]|as\b|satisfies\b)/.test(continuation);
  if (
    !callTail.startsWith(')') ||
    (continuation !== '' && !hasStatementTerminator && !hasAutomaticSemicolonBoundary)
  ) {
    throw staticOpenElementError(
      'defineIslandConfig() argument must be one static object literal',
    );
  }

  return parseStaticIslandConfigBody(body);
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

    if (fileStat.isDirectory()) {
      const subFiles = await scanIslands(fullPath, relativePath);
      files.push(...subFiles);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      files.push(normalizeSeparators(relativePath));
    }
  }

  return files.sort();
}

/**
 * v0.41.0-alpha.1: Regex-based — reads island metadata by statically scanning the
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
