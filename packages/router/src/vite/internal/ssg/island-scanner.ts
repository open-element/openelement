/** Island and package-manifest discovery without executing local island modules. */
import ts from 'typescript';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'pathe';
import type { HydrationStrategy, OpenElementPackageManifest } from '../../framework.ts';
import type { IslandDecl } from '@openelement/protocol/ssg';
import { formatError, isValidTagName, OpenElementError } from '@openelement/element';
import { createLogger } from '@openelement/element';
import { normalizeSeparators, pathToTagName } from '@openelement/element/build-utils';
import { hasControlCharacter } from '../../../internal/control-characters.ts';
import { buildError, PackageIslandErrorCode } from '../../../internal/error-codes.ts';
import { reportScanFatal } from '../build-diagnostics.ts';
import { type DeclaredStyleSource, STYLE_DIALECTS } from '../style-plan.ts';
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
 * Single source of truth for island render directives: the
 * `hydrate === 'only' ? false : meta?.ssr` coercion and the
 * `hydrate || upgradeStrategy || 'idle'` fallback are defined here once, and
 * every consumer (plugin.ts, entry-descriptor.ts, island-scanner.ts,
 * build-client.ts) resolves through them.
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
    ? resolveIslandDeliveryTags(island.tagName, delivery.tags, delivery.tagNames, island.tagName)
    : [island.tagName];
  const exportNames = validateIslandDeliveryExportNames(delivery.exportNames, tags, island.tagName);
  const { tags: _tags, tagNames: _tagNames, exportNames: _exportNames, ...base } = delivery;
  return tags.map((tagName) => ({
    ...base,
    tagName,
    ...(exportNames?.[tagName] === undefined ? {} : { exportName: exportNames[tagName] }),
  })) as IslandDecl[];
}

/** Package island declaration with delivery aliases resolved. */
export type DeliveryIslandDecl = IslandDecl & IslandDeliveryMeta;

/**
 * The admitted declarations' Tailwind facts (the declared-compilation contract).
 *
 * "Admitted" is this scan's own verdict: the package is on the scan list, its
 * manifest was readable, and the declaration carries the `openElement.module`
 * the island pipeline admits. Reachability narrows DELIVERY, not admission, so
 * a listed package's requirement is honoured for every build of that app —
 * conservative, and independent of which page happens to render first.
 *
 * The block's shape is validated here (the scan owns manifest shape): a
 * malformed `tailwind` block fails the build instead of being silently ignored.
 * Resolution of the declared sources themselves belongs to the Tailwind plan
 * (`resolveTailwindPlan`), which knows the app root.
 */
export function admittedTailwindDeclarations(
  packageManifests: readonly OpenElementPackageManifest[],
  admitted: readonly { readonly tagName: string }[],
): DeclaredStyleSource[] {
  const admittedTags = new Set(admitted.map((decl) => decl.tagName));
  const facts: DeclaredStyleSource[] = [];
  for (const pkg of packageManifests) {
    for (const declaration of pkg.declarations) {
      if (!admittedTags.has(declaration.tagName)) continue;
      const block = declaration.openElement?.tailwind;
      if (block === undefined) continue;
      if (block === null || typeof block !== 'object') {
        throw buildError(
          PackageIslandErrorCode.TAILWIND_SHAPE,
          `${pkg.packageName} <${declaration.tagName}> declares openElement.tailwind as ` +
            `${JSON.stringify(block)}; it must be an object.`,
        );
      }
      const { required, sources, dialect } = block as {
        required?: unknown;
        sources?: unknown;
        dialect?: unknown;
      };
      if (required !== undefined && typeof required !== 'boolean') {
        throw buildError(
          PackageIslandErrorCode.TAILWIND_SHAPE,
          `${pkg.packageName} <${declaration.tagName}> declares openElement.tailwind.required as ` +
            `${JSON.stringify(required)}; it must be a boolean.`,
        );
      }
      if (
        sources !== undefined &&
        (!Array.isArray(sources) || sources.some((source) => typeof source !== 'string'))
      ) {
        throw buildError(
          PackageIslandErrorCode.TAILWIND_SHAPE,
          `${pkg.packageName} <${declaration.tagName}> declares openElement.tailwind.sources as ` +
            `${JSON.stringify(sources)}; it must be an array of package-relative paths.`,
        );
      }
      // A dialect outside the shipped set is a coded failure, not a typo that
      // quietly falls back: the declaration is a compile-time requirement, and
      // an unknown language has no provider that could satisfy it.
      if (dialect !== undefined && !STYLE_DIALECTS.includes(dialect as never)) {
        throw buildError(
          PackageIslandErrorCode.TAILWIND_SHAPE,
          `${pkg.packageName} <${declaration.tagName}> declares openElement.tailwind.dialect ` +
            `as ${JSON.stringify(dialect)}; the supported dialects are ` +
            `${STYLE_DIALECTS.join(', ')} (an unknown dialect has no provider that could ` +
            'compile it).',
        );
      }
      facts.push({
        packageName: pkg.packageName,
        tagName: declaration.tagName,
        required: required === true,
        dialect: (dialect as DeclaredStyleSource['dialect'] | undefined) ?? 'tailwind4',
        sources: (sources as string[] | undefined) ?? [],
      });
    }
  }
  return facts;
}

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
          throw buildError(
            PackageIslandErrorCode.MODULE_MISSING,
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
        const media =
          delivery.media === undefined
            ? undefined
            : validateIslandMediaQuery(delivery.media, d.tagName);
        if (hydrate === 'media' && media === undefined) {
          throw buildError(
            PackageIslandErrorCode.MEDIA_WITHOUT_DELIVERY,
            `Package island "${d.tagName}" uses media delivery without media`,
          );
        }
        if (hydrate !== 'media' && media !== undefined) {
          throw buildError(
            PackageIslandErrorCode.DELIVERY_WITHOUT_MEDIA,
            `Package island "${d.tagName}" declares media without media delivery`,
          );
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
      }),
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
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
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
      !ts.isPropertyAccessExpression(node) &&
      !ts.isElementAccessExpression(node) &&
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
          `openElement.${key} must be a static literal, got dynamic value "${raw.getText(
            sourceFile,
          )}"`,
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
        hasControlCharacter(exportName)
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
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'openElement' &&
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
export async function scanIslands(islandsDir: string, relativeDir: string = ''): Promise<string[]> {
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
      reason:
        hydrate === 'only'
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
 * One package's manifest load, classified. Both admission paths share it: the
 * EXPLICIT scan (`scanPackageManifests`) turns every non-ok status into its
 * existing coded failure, and the DERIVATION (`deriveAdmittedPackages`)
 * classifies 'no-manifest' as the manifest-less warning class while keeping
 * 'invalid' and 'transport' fail-closed. One loader, one classification, two
 * severity policies — never a second manifest mechanism.
 */
export type PackageManifestLoad =
  | { status: 'ok'; manifest: OpenElementPackageManifest }
  /** The import missed the package itself: it is not installed under that name. */
  | { status: 'missing-package' }
  /**
   * The package exports no manifest: no `./manifest` subpath and no root-entry
   * export, or the entry cannot be read in this host (`reason: 'browser-only'`
   * — the shape the explicit scan has always tolerated with a warning).
   */
  | { status: 'no-manifest'; reason: string }
  /** The package exports a manifest whose shape is not the contract (missing packageName/declarations). */
  | { status: 'invalid'; reason: string }
  /** The manifest channel failed in a way that is none of the shapes above. */
  | { status: 'transport'; error: unknown };

/**
 * Load ONE package's manifest through the shared channel: the `./manifest`
 * subpath first (loads only the manifest module, so a node-host scan never
 * pulls the package's component modules), the root entry as the legacy
 * fallback. Classifies the outcome; never throws.
 *
 * Anchoring, most precise first:
 * - `packageRoot`: the walked module's own package directory (the derivation
 *   has it — the walk RESOLVED the module). The manifest entry is read from
 *   that package's `exports['./manifest']`, falling back to the conventional
 *   `manifest.{ts,js}` — no name-based resolution that a workspace checkout
 *   could not answer.
 * - `from`: the APPLICATION root (the same anchor the style plan resolves
 *   declared sources from) — for explicitly listed packages, whose directory
 *   is not known before the manifest answers.
 * - neither: a bare-specifier import from this module's install location (the
 *   historical contract; an installed-router app resolves its own
 *   node_modules this way).
 */
export async function loadPackageManifest(
  pkg: string,
  anchor?: { from?: string; packageRoot?: string },
): Promise<PackageManifestLoad> {
  const packageRoot = anchor?.packageRoot;
  if (packageRoot !== undefined) {
    const anchored = await importAnchoredManifestModule(pkg, packageRoot);
    if (anchored !== undefined) return anchored;
  }
  const from = anchor?.from;
  let anchored: Record<string, unknown> | undefined;
  if (from !== undefined) {
    try {
      const requireFromApp = createRequire(join(from, 'package.json'));
      const manifestEntry = requireFromApp.resolve(`${pkg}/manifest`);
      anchored = (await import(pathToFileURL(manifestEntry).href)) as Record<string, unknown>;
    } catch (anchorError) {
      const code = (anchorError as NodeJS.ErrnoException)?.code;
      const message = (anchorError as Error)?.message ?? '';
      // Node refuses to strip types under node_modules — a package whose
      // manifest is TypeScript inside an install directory cannot be loaded
      // by a node-host scan (the published artifact stages a compiled
      // manifest); manifest-less, with the reason, never a build failure.
      if (code === 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING') {
        return {
          status: 'no-manifest',
          reason:
            'the manifest module is TypeScript under node_modules, which a node-host scan cannot load',
        };
      }
      // The anchor's own verdict is the accurate one about the APP's install:
      // the whole package missing vs. the package present without a manifest
      // file. (`MODULE_NOT_FOUND` is require's legacy spelling of the same
      // shape; `ERR_PACKAGE_PATH_NOT_EXPORTED` — a conditions mismatch — is
      // left to the import-condition flow below, which owns the answer.)
      if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
        if (message.includes(`Cannot find package '${pkg}`)) {
          return { status: 'missing-package' };
        }
        return { status: 'no-manifest', reason: 'does not export a manifest' };
      }
      anchored = undefined;
    }
  }
  if (anchored !== undefined) {
    if (anchored.manifest && typeof anchored.manifest === 'object') {
      const manifest = anchored.manifest as OpenElementPackageManifest;
      if (manifest.packageName && manifest.declarations) {
        return { status: 'ok', manifest };
      }
      return { status: 'invalid', reason: 'missing packageName or declarations' };
    }
    return { status: 'no-manifest', reason: 'does not export a manifest' };
  }
  let mod: Record<string, unknown>;
  try {
    // @vite-ignore suppresses Vite's unanalyzable-dynamic-import warning.
    mod = (await import(/* @vite-ignore */ `${pkg}/manifest`)) as Record<string, unknown>;
  } catch (subpathError) {
    const code = (subpathError as NodeJS.ErrnoException)?.code ?? '';
    const message = (subpathError as Error)?.message ?? '';
    // A ./manifest miss has two environment shapes: native node raises
    // ERR_PACKAGE_PATH_NOT_EXPORTED (or ERR_MODULE_NOT_FOUND for a package
    // without an exports map), while a module-runner host re-wraps the
    // same failure with no errno code and a `"./manifest" is not exported`
    // message. Both mean "no ./manifest subpath export" — the root-entry
    // fallback below is the answer — anything else fails loud.
    const isMissingSubpathExport =
      code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
      code === 'ERR_MODULE_NOT_FOUND' ||
      message.includes('"./manifest" is not exported');
    if (!isMissingSubpathExport) {
      return { status: 'transport', error: subpathError };
    }
    // ERR_MODULE_NOT_FOUND is ambiguous between "the package is not
    // installed" and "the package is installed but carries no ./manifest
    // file (no exports map)". The message separates them (see
    // isMissingPackageImportError): a missing package fails here, before
    // the root-entry fallback can run and bury the real cause under a
    // second, unrelated-looking import failure.
    if (isMissingPackageImportError(subpathError, pkg)) {
      return { status: 'missing-package' };
    }
    try {
      mod = (await import(/* @vite-ignore */ pkg)) as Record<string, unknown>;
    } catch (e) {
      if (isBrowserOnlyPackageImportError(e)) {
        return {
          status: 'no-manifest',
          reason: 'browser-only',
        };
      }
      return { status: 'transport', error: e };
    }
  }
  if (mod.manifest && typeof mod.manifest === 'object') {
    const manifest = mod.manifest as OpenElementPackageManifest;
    if (manifest.packageName && manifest.declarations) {
      return { status: 'ok', manifest };
    }
    return {
      status: 'invalid',
      reason: `missing packageName or declarations`,
    };
  }
  return { status: 'no-manifest', reason: 'does not export a manifest' };
}

/**
 * Load the manifest module from the package's own directory: the
 * `exports['./manifest']` spelling first (the declared channel), the
 * conventional `manifest.{ts,js}` files as the fallback — the same files the
 * subpath contract names. Returns undefined when the package carries none, so
 * the caller can keep anchoring; a manifest that exists but is malformed
 * classifies as 'invalid' right here.
 *
 * A TypeScript target UNDER `node_modules` is skipped, not attempted: node
 * refuses to strip types there (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`)
 * — the published artifact contract stages a compiled `.js` manifest (the
 * release pipeline's compiled-pack staging), so a package whose only manifest
 * is TypeScript inside an install directory classifies as manifest-less with
 * that reason instead of failing the build on a node capability.
 */
async function importAnchoredManifestModule(
  pkg: string,
  packageRoot: string,
): Promise<PackageManifestLoad | undefined> {
  const manifestPackageJsonPath = join(packageRoot, 'package.json');
  const targets: string[] = [];
  try {
    const parsed = JSON.parse(readFileSync(manifestPackageJsonPath, 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    const entry = parsed.exports?.['./manifest'];
    if (typeof entry === 'string') {
      targets.push(resolve(packageRoot, entry));
    } else if (entry !== undefined && typeof entry === 'object' && entry !== null) {
      const conditional = entry as { default?: unknown; import?: unknown };
      for (const spelling of [conditional.default, conditional.import]) {
        if (typeof spelling === 'string') targets.push(resolve(packageRoot, spelling));
      }
    }
  } catch {
    // An unreadable package.json: the conventional names decide below.
  }
  for (const conventional of ['manifest.js', 'manifest.ts']) {
    targets.push(resolve(packageRoot, conventional));
  }
  let skippedTypesUnderNodeModules = false;
  for (const target of targets) {
    if (!existsSync(target)) continue;
    if (/\.tsx?$/.test(target) && target.includes('/node_modules/')) {
      // Node refuses to strip types under node_modules; the published
      // artifact stages a compiled manifest. Skip — a compiled target later
      // in the list still wins — and remember why nothing loaded.
      skippedTypesUnderNodeModules = true;
      log.debug(
        `Skipping the manifest module "${target}": node cannot strip types under node_modules.`,
      );
      continue;
    }
    let loaded: Record<string, unknown>;
    try {
      loaded = (await import(pathToFileURL(target).href)) as Record<string, unknown>;
    } catch (cause) {
      if (isBrowserOnlyPackageImportError(cause)) {
        return { status: 'no-manifest', reason: 'browser-only' };
      }
      return { status: 'transport', error: cause };
    }
    if (loaded.manifest && typeof loaded.manifest === 'object') {
      const manifest = loaded.manifest as OpenElementPackageManifest;
      if (manifest.packageName && manifest.declarations) {
        return { status: 'ok', manifest };
      }
      return { status: 'invalid', reason: 'missing packageName or declarations' };
    }
    return { status: 'no-manifest', reason: 'does not export a manifest' };
  }
  if (skippedTypesUnderNodeModules) {
    return {
      status: 'no-manifest',
      reason:
        'the manifest module is TypeScript under node_modules, which a node-host scan cannot load',
    };
  }
  return undefined;
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
  from?: string,
): Promise<OpenElementPackageManifest[]> {
  const allManifests: OpenElementPackageManifest[] = [];

  for (const pkg of packageNames) {
    const load = await loadPackageManifest(pkg, { from });
    if (load.status === 'ok') {
      allManifests.push(load.manifest);
      continue;
    }
    if (load.status === 'missing-package') {
      // reportScanFatal first (#1616): the buildStart error surface does not
      // carry a thrown message to the CLI on rolldown-vite 8 — a fatal that
      // only throws never reaches the developer, and the build walks on to a
      // misleading downstream failure.
      throw reportScanFatal(
        buildError(
          PackageIslandErrorCode.PACKAGE_MISSING,
          `Package "${pkg}" is not installed: install it or remove it from the package-island list`,
        ),
      );
    }
    if (load.status === 'no-manifest') {
      // The legacy root-entry contract: a browser-only entry is the shape the
      // explicit scan has always tolerated (warned and skipped); a package
      // with no manifest export claimed component-packageness by being
      // listed, so the absence is a coded failure, not a skip.
      if (load.reason === 'browser-only') {
        log.warn(
          `Skipping package manifest from "${pkg}": browser-only package cannot be imported during SSR discovery`,
        );
        continue;
      }
      throw reportScanFatal(
        buildError('PACKAGE_MANIFEST_ERROR', `Package ${pkg} does not export a manifest`),
      );
    }
    if (load.status === 'invalid') {
      throw reportScanFatal(
        buildError('PACKAGE_MANIFEST_ERROR', `Invalid manifest in ${pkg}: ${load.reason}`),
      );
    }
    throw reportScanFatal(
      buildError(
        'PACKAGE_SCAN_ERROR',
        `Failed to scan package manifest from "${pkg}": ${formatError(load.error)}`,
        { cause: load.error instanceof Error ? load.error : undefined },
      ),
    );
  }

  return allManifests;
}

/**
 * Error message classification: regex is the appropriate tool for matching
 * runtime error strings from failed dynamic imports.
 */
function isBrowserOnlyPackageImportError(error: unknown): boolean {
  const message = formatError(error);
  return /\b(window|document|HTMLElement|customElements|navigator)\b.*\bis not defined\b/i.test(
    message,
  );
}

/**
 * The import missed the package itself, not a file inside it: both reporter
 * shapes quote exactly the specifier this scan asked for — native node the
 * bare package ("Cannot find package '<pkg>'"), a module-runner host the
 * full subpath ("Cannot find package '<pkg>/manifest'"). A missing file
 * inside an installed package quotes a resolved path instead, where neither
 * quoted shape appears, so an installed package cannot false-positive.
 */
function isMissingPackageImportError(error: unknown, pkg: string): boolean {
  if ((error as NodeJS.ErrnoException)?.code !== 'ERR_MODULE_NOT_FOUND') return false;
  const message = (error as Error)?.message ?? '';
  return (
    message.includes(`Cannot find package '${pkg}'`) ||
    message.includes(`Cannot find package '${pkg}/manifest'`)
  );
}
