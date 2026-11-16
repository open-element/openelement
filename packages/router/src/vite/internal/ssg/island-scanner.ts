// Single-file cohesion is a deliberate trade against small-parts granularity (comply-or-explain, design-principles.md:16-19): the scan stages share one private type flow; the public boundary is the structured scan-result union consumed by the SSG pipeline.
/** Island and package-manifest discovery without executing local island modules. */
import ts from 'typescript';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'pathe';
import type { HydrationStrategy, OpenElementPackageManifest } from '../../framework.ts';
import type { IslandDecl } from '@openelement/protocol/ssg';
import { formatError, isValidTagName, OpenElementError } from '@openelement/element';
import {
  camelToKebab,
  forbiddenSinkReason,
  isSafeAttributeName,
} from '@openelement/protocol/forbidden-sinks';
import { createLogger } from '@openelement/element';
import { stableModuleId } from '@openelement/compiler';
import { normalizeSeparators, pathToTagName } from '@openelement/element/build-utils';
import { hasControlCharacter } from '../../../internal/control-characters.ts';
import { checkIslandStyleList } from '../../../internal/island-style-specifiers.ts';
import {
  registerIslandStyleDeclaration,
  resetIslandStyleDeclarations,
} from '../island-style-declarations.ts';
import {
  buildError,
  ClientAssetErrorCode,
  IslandErrorCode,
  PackageIslandErrorCode,
} from '../../../internal/error-codes.ts';
import { createGeneratedElementSiteResolver } from '../../generated-element-site.ts';
import { reportScanFatal } from '../build-diagnostics.ts';
import { type DeclaredStyleSource, STYLE_DIALECTS } from '../style-plan.ts';
import {
  type GeneratedElementHostIdentity,
  resolveGeneratedElementHost,
} from './generated-element-host-metadata.ts';
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

/**
 * One parsed sidecar property entry: the platform facts a typed props member
 * cannot express. The name/type authority is the root component's typed props
 * parameter; the build metadata carries the resolved attribute channel (a
 * missing `attribute` key is already camel-to-kebab'd here) so the compiler
 * lane and the static scan compare one vocabulary.
 */
export interface LocalIslandPropertyConfig {
  /** Resolved attribute name, or null for a property-only channel. */
  attribute: string | null;
  /**
   * True when the sidecar spells `attribute` explicitly. Non-primitive
   * property-only rows require the explicit `false`; an omitted key would
   * derive a kebab attribute and open the JSON-attribute path.
   */
  attributeExplicit: boolean;
  /** Reflect property writes back to the attribute. */
  reflect: boolean;
  /** Declared default (primitive literal, literal graph, or trustedHtml literal). */
  default?: LocalIslandPropertyDefault;
}

/**
 * The statically provable sidecar default vocabulary: a primitive, a bounded
 * recursively literal array/object graph, or the literal HTML string of a
 * canonical `trustedHtml('<literal>')` default. The compiler lane pairs the
 * trustedHtml tag with a `TrustedHtml`-typed member and brands it in the shell.
 */
export type LocalIslandPropertyDefault =
  | string
  | number
  | boolean
  | null
  | readonly LocalIslandPropertyDefault[]
  | { readonly [key: string]: LocalIslandPropertyDefault }
  | { readonly trustedHtml: string };

/** Local island metadata indexed by tag name. */
export interface LocalIslandMeta {
  tagName: string;
  filePath: string;
  ssr?: boolean;
  dsd?: boolean;
  hydrate?: IslandDeliveryStrategy;
  /** Required when hydrate is media; kept as build metadata, not runtime. */
  media?: string;
  /**
   * The island's declared stylesheets (`IslandConfig.styles`, GH issue #1800),
   * admitted only for a light-root generated-element island. The build-time
   * record is the scanned metadata's copy of the declaration; the style-edge
   * plan reads it through `island-style-declarations.ts`, which this same scan
   * writes. It is build metadata only: the public `IslandDecl` protocol shape
   * is unchanged and no renderer consumes it yet (asset + client asset manifest
   * is this slice's delivery; document application is the Alpha17 adoption
   * slice).
   */
  styles?: string[];
  /**
   * The root family the sidecar declares: `'light'`, or `'shadow'` for the DSD
   * default. Absent when the author pinned none: the compiled program's own
   * root decision stands, and the generated shell applies its `light` default.
   */
  root?: 'light' | 'shadow';
  /**
   * M11 prerequisite — the compiler-owned generated-host identity resolved by
   * this scan from the source it already read (see
   * `generated-element-host-metadata.ts`). Build-only metadata that rides the
   * existing scanned record; the public `IslandDecl` shape is unchanged and the
   * internal entry descriptor (`buildEntryDescriptor`) is its one consumer so
   * far — it re-attaches the fact to the scanned local island declarations, and
   * no renderer/registration consumer reads it yet. It is produced by the one
   * scan the build and the dev island rescan share, so it cannot go stale
   * without the descriptor.
   */
  generatedElementHost?: GeneratedElementHostIdentity;
  /**
   * Native `delegatesFocus` fact for the island's shadow root. Declared next
   * to `root` because it is only meaningful with `root: 'shadow'`; the static
   * scan refuses `true` with any other root, and the compiler lane re-reads
   * the same field from the authored sidecar (the same seam as `root`).
   */
  delegatesFocus?: boolean;
  /**
   * Associate the generated element host with its surrounding form. The form
   * value is the declared string property named `value`; optional boolean
   * `required`/`disabled` properties map the required/valueMissing and
   * fieldset-disabled behavior. No `formValue` field exists.
   */
  formAssociated?: boolean;
  /**
   * The island element's declared primitive properties, keyed by the typed
   * props member name. Parsed from the same sidecar as the delivery facts; the
   * compiler lane re-reads it and cross-checks it against the props type.
   */
  properties?: Record<string, LocalIslandPropertyConfig>;
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
 * The `openElement.styles` facts a package manifest declares, validated by the
 * ONE specifier rule the local island scan applies
 * (`internal/island-style-specifiers.ts`). A decl-class package component
 * publishes its host root and its authored sheets in the manifest, so the
 * consuming build registers the SAME declaration a local island scan records —
 * no second sidecar read and no second validator.
 */
export interface PackageIslandStyleFact {
  readonly tagName: string;
  readonly root: 'light' | 'shadow';
  readonly specifiers: readonly string[];
}

export function packageIslandStyleDeclarations(
  packageManifests: readonly OpenElementPackageManifest[],
): PackageIslandStyleFact[] {
  const facts: PackageIslandStyleFact[] = [];
  for (const pkg of packageManifests) {
    for (const declaration of pkg.declarations) {
      const styles = declaration.openElement?.styles;
      if (styles === undefined) continue;
      const check = checkIslandStyleList([...styles]);
      if (!check.ok) {
        throw buildError(
          PackageIslandErrorCode.STYLES_SHAPE,
          `Package island "${declaration.tagName}" (${pkg.packageName}) ${check.reason}`,
        );
      }
      facts.push({
        tagName: declaration.tagName,
        root: declaration.openElement?.root === 'shadow' ? 'shadow' : 'light',
        specifiers: [...check.styles],
      });
    }
  }
  return facts;
}

/** Where the app that consumes a package lives (the module-id anchors). */
export interface PackageIslandStyleHost {
  readonly root: string;
  readonly workspaceRoot?: string;
}

/**
 * Register every package manifest's declared sheets in the build's style
 * declaration carrier, keyed by the package module's stable module id.
 *
 * A specifier the host cannot resolve is skipped: the island pipeline already
 * reports that package module with its own coded failure, and a style record
 * for a module the build never transforms would emit an orphan asset. The
 * caller runs this after every scan that can change either side (local islands
 * or the admitted package set), so the carrier is rebuilt from the current
 * context instead of depending on scan order.
 */
export function registerPackageIslandStyleDeclarations(
  packageIslandDecls: readonly IslandDecl[],
  packageManifests: readonly OpenElementPackageManifest[],
  host: PackageIslandStyleHost,
): void {
  const facts = packageIslandStyleDeclarations(packageManifests);
  if (facts.length === 0) return;
  const requireFromRoot = createRequire(join(host.root, 'package.json'));
  const moduleByTag = new Map<string, string>();
  for (const declaration of packageIslandDecls) {
    if (declaration.source !== 'package') continue;
    const specifier = declaration.modulePath;
    if (specifier === undefined || specifier === '') continue;
    try {
      // The style registry resolves every specifier against the module's own
      // directory, exactly like the local island scan (which passes the
      // island module's ABSOLUTE path). A project-relative stable id would
      // make the emitted edge a relative filesystem path the loader cannot
      // read.
      moduleByTag.set(declaration.tagName, requireFromRoot.resolve(specifier));
    } catch {
      continue;
    }
  }
  for (const fact of facts) {
    const moduleId = moduleByTag.get(fact.tagName);
    if (moduleId === undefined) continue;
    registerIslandStyleDeclaration({
      tagName: fact.tagName,
      root: fact.root,
      moduleId,
      // Diagnostic-only fields for a package module: the file name and its
      // directory. The style plan reads moduleId + specifiers + root only.
      filePath: moduleId.slice(moduleId.lastIndexOf('/') + 1),
      islandsDir: moduleId.slice(0, Math.max(0, moduleId.lastIndexOf('/'))),
      specifiers: fact.specifiers,
    });
  }
}

/**
 * Attach the compiler-owned generated host identity to every package island
 * declaration whose module source resolves.
 *
 * The identity is what the generated entry pairs a tag with (`__registerSsrIsland`
 * writer); a local island gets it from its own source scan, and a package
 * component needs the same carrier even though its declaration comes from a
 * manifest. The compiler is the authority: the declaration supplies the tag and
 * the published root, the module source supplies everything else. A module the
 * host cannot resolve keeps no identity (its own coded failure is reported by
 * the island pipeline) and the entry keeps the class-only bytes.
 */
export function attachPackageIslandHostIdentities(
  declarations: readonly IslandDecl[],
  packageManifests: readonly OpenElementPackageManifest[],
): IslandDecl[] {
  const declaredRoots = new Map<string, 'light' | 'shadow' | undefined>();
  for (const pkg of packageManifests) {
    for (const declaration of pkg.declarations) {
      declaredRoots.set(
        declaration.tagName,
        declaration.openElement?.root === 'shadow'
          ? 'shadow'
          : declaration.openElement?.root === 'light'
            ? 'light'
            : undefined,
      );
    }
  }
  const requireFromRoot = createRequire(join(process.cwd(), 'package.json'));
  return declarations.map((declaration) => {
    if (declaration.source !== 'package') return declaration;
    const specifier = declaration.modulePath;
    if (specifier === undefined || specifier === '') return declaration;
    let file: string;
    try {
      file = requireFromRoot.resolve(specifier);
    } catch {
      return declaration;
    }
    if (!/\.tsx$/.test(file)) return declaration;
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      return declaration;
    }
    const identity = resolveGeneratedElementHost({
      source,
      moduleId: file,
      filePath: file,
      root: declaredRoots.get(declaration.tagName),
      site: { tag: declaration.tagName },
    });
    return { ...declaration, generatedElementHost: identity };
  });
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
    `Invalid static island metadata export "openElement": ${message}. Accepted shape: export const openElement = defineIslandConfig({ ssr?: boolean, dsd?: boolean, hydrate?: "load" | "idle" | "visible" | "media" | "only", media?: string, styles?: readonly string[], root?: "light" | "shadow", delegatesFocus?: boolean, formAssociated?: boolean, properties?: Record<string, { reflect?: boolean, attribute?: string | false, default?: string | number | boolean }> }).`,
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
  | 'ssr'
  | 'dsd'
  | 'hydrate'
  | 'media'
  | 'styles'
  | 'root'
  | 'delegatesFocus'
  | 'formAssociated'
  | 'properties'
  | 'tags'
  | 'tagNames'
  | 'exportNames'
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

/**
 * Parse the sidecar's `styles` array: static string literals only, admitted by
 * the ONE specifier rule the runtime authoring face applies
 * (`internal/island-style-specifiers.ts`, GH issue #1800). The array itself must
 * be a static literal — a spread or a computed element is refused instead of
 * guessed, exactly like every other sidecar fact the scan reads.
 */
function parseStaticStyleList(
  node: ts.Expression,
  context: string,
  sourceFile: ts.SourceFile,
): string[] {
  if (!ts.isArrayLiteralExpression(node)) {
    throw staticOpenElementError(context + ' must be an array of string literals');
  }
  const values: unknown[] = [];
  for (const element of node.elements) {
    if (ts.isSpreadElement(element)) {
      throw staticOpenElementError(context + ' must not contain spreads');
    }
    if (!ts.isStringLiteral(element) && !ts.isNoSubstitutionTemplateLiteral(element)) {
      throw staticOpenElementError(
        `${context} must be a static array of string literals, got dynamic value ` +
          `"${element.getText(sourceFile)}"`,
      );
    }
    values.push(element.text);
  }
  const check = checkIslandStyleList(values);
  if (!check.ok) throw staticOpenElementError(`${context} ${check.reason}`);
  return [...check.styles];
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

/** A boolean literal, or a coded static-metadata refusal. */
function parseStaticBoolean(node: ts.Expression, context: string): boolean {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  throw staticOpenElementError(context + ' must be a boolean literal');
}

const ISLAND_PROPERTY_FIELDS: ReadonlySet<string> = new Set(['reflect', 'attribute', 'default']);
const ISLAND_PROPERTY_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Parse the sidecar's `properties` table: an object map keyed by the typed
 * props member name, each entry carrying only the platform facts a type
 * cannot express (`reflect`, `attribute`, `default`). The name/type pair is
 * the root component's typed props parameter; the compiler lane cross-checks
 * the two declarations, and this scan validates the same accepted shape the
 * runtime authoring surface validates.
 */
const PROPERTY_DEFAULT_MAX_DEPTH = 8;

/** One bounded, recursively literal JSON-safe default graph. */
type StaticDefaultGraph =
  | string
  | number
  | boolean
  | null
  | readonly StaticDefaultGraph[]
  | { readonly [key: string]: StaticDefaultGraph };

function parseStaticDefaultGraph(
  node: ts.Expression,
  context: string,
  depth = 0,
): StaticDefaultGraph {
  if (depth > PROPERTY_DEFAULT_MAX_DEPTH) {
    throw staticOpenElementError(context + ' is nested deeper than the admitted literal depth');
  }
  const value = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isNumericLiteral(value)) {
    const number = Number(value.text);
    if (!Number.isFinite(number))
      throw staticOpenElementError(context + ' must be a finite number');
    return number;
  }
  if (
    ts.isPrefixUnaryExpression(value) &&
    value.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(value.operand)
  ) {
    const number = -Number(value.operand.text);
    if (!Number.isFinite(number))
      throw staticOpenElementError(context + ' must be a finite number');
    return number;
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.map((element) => {
      if (ts.isSpreadElement(element)) {
        throw staticOpenElementError(context + ' must not contain spreads');
      }
      return parseStaticDefaultGraph(element, context, depth + 1);
    });
  }
  if (ts.isObjectLiteralExpression(value)) {
    const object: Record<string, StaticDefaultGraph> = {};
    for (const [key, entry] of staticEntries(value)) {
      // One canonical rule on every recursive default-graph key: the same
      // property-sink predicate the compiler and the runtime authoring face
      // use. No private `__proto__`-only list.
      const sinkReason = forbiddenSinkReason('prop', key);
      if (sinkReason !== null) {
        throw staticOpenElementError(
          context + ' must not contain a property-sink key "' + key + '" (' + sinkReason + ')',
        );
      }
      object[key] = parseStaticDefaultGraph(entry, context + '.' + key, depth + 1);
    }
    return object;
  }
  throw staticOpenElementError(
    context + ' must be a static string, number, boolean, null, array, or object literal',
  );
}

/**
 * The canonical `trustedHtml` import bindings in one island module. Mirrors the
 * class-lane provenance rule: a named import of `trustedHtml` from
 * '@openelement/element' (aliases followed, no local shadowing); a same-name
 * binding from anywhere else is reported as non-canonical instead of being
 * read as the capability.
 */
function staticTrustedHtmlBinding(sourceFile: ts.SourceFile): {
  readonly canonicalLocals: ReadonlySet<string>;
  readonly nonCanonicalLocals: ReadonlySet<string>;
  readonly shadowed: ReadonlySet<string>;
} {
  const canonicalLocals = new Set<string>();
  const nonCanonicalLocals = new Set<string>();
  const shadowed = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
      const clause = statement.importClause;
      if (clause?.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) continue;
      const clauseTypeOnly = clause.isTypeOnly;
      for (const element of clause.namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (importedName !== 'trustedHtml') continue;
        // A type-only import can never supply the runtime capability; the
        // compiler's intrinsic resolver refuses it, so the scanner must agree.
        const typeOnly = clauseTypeOnly || element.isTypeOnly;
        if (moduleName === '@openelement/element' && !typeOnly) {
          canonicalLocals.add(element.name.text);
        } else {
          nonCanonicalLocals.add(element.name.text);
        }
      }
      continue;
    }
    const declaredName =
      (ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name?.text !== undefined
        ? statement.name.text
        : undefined;
    if (declaredName !== undefined) shadowed.add(declaredName);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) shadowed.add(declaration.name.text);
      }
    }
  }
  return { canonicalLocals, nonCanonicalLocals, shadowed };
}

function parseStaticPropertyDefault(
  sourceFile: ts.SourceFile,
  raw: ts.Expression,
  context: string,
): LocalIslandPropertyDefault {
  const value = ts.isParenthesizedExpression(raw) ? raw.expression : raw;
  if (ts.isCallExpression(value)) {
    const callee = value.expression;
    if (!ts.isIdentifier(callee)) {
      throw staticOpenElementError(
        context + ' must be a static literal or the canonical trustedHtml(<literal string>)',
      );
    }
    const bindings = staticTrustedHtmlBinding(sourceFile);
    const canonical =
      bindings.canonicalLocals.has(callee.text) &&
      !bindings.nonCanonicalLocals.has(callee.text) &&
      !bindings.shadowed.has(callee.text);
    if (!canonical) {
      throw staticOpenElementError(
        context +
          ' must be created by the canonical trustedHtml import from ' +
          "'@openelement/element'; a same-name or aliased-to-other-module callee is not admitted",
      );
    }
    if (value.arguments.length !== 1) {
      throw staticOpenElementError(context + ' trustedHtml(...) takes exactly one literal string');
    }
    const html = value.arguments[0]!;
    if (!ts.isStringLiteral(html) && !ts.isNoSubstitutionTemplateLiteral(html)) {
      throw staticOpenElementError(
        context + ' trustedHtml(...) requires a literal string argument',
      );
    }
    return { trustedHtml: html.text };
  }
  const graph = parseStaticDefaultGraph(value, context);
  if (graph === null) {
    throw staticOpenElementError(
      context + ' must not be null; declare an explicit literal default',
    );
  }
  return graph;
}

function parseStaticPropertyTable(
  sourceFile: ts.SourceFile,
  node: ts.Expression,
  context: string,
): Record<string, LocalIslandPropertyConfig> {
  if (!ts.isObjectLiteralExpression(node)) {
    throw staticOpenElementError(context + ' must be an object of static property entries');
  }
  const result: Record<string, LocalIslandPropertyConfig> = Object.create(null);
  const names = new Set<string>();
  const attributes = new Set<string>();
  for (const [name, entry] of staticEntries(node)) {
    if (!ISLAND_PROPERTY_NAME.test(name)) {
      throw staticOpenElementError(
        `${context} key "${name}" must be an identifier naming a typed props member`,
      );
    }
    const sinkReason = forbiddenSinkReason('prop', name);
    if (sinkReason !== null) {
      throw staticOpenElementError(
        `${context} key "${name}" is not an admissible property name: ${sinkReason}`,
      );
    }
    // A duplicate NAME is a shape defect independent of the attribute channel:
    // with `attribute: false` or distinct explicit attributes no resolved
    // attribute collides, so the attribute set alone would miss it (D2).
    if (names.has(name)) {
      throw staticOpenElementError(`${context} declares property "${name}" more than once`);
    }
    names.add(name);
    if (!ts.isObjectLiteralExpression(entry)) {
      throw staticOpenElementError(context + '.' + name + ' must be an object');
    }
    const seenFields = new Set<string>();
    let reflect = false;
    let attribute: string | null | undefined;
    let attributeExplicit = false;
    let defaultValue: LocalIslandPropertyDefault | undefined;
    for (const [field, raw] of staticEntries(entry)) {
      if (!ISLAND_PROPERTY_FIELDS.has(field)) {
        throw staticOpenElementError(
          `${context}.${name} does not accept "${field}" — admitted options are reflect, ` +
            'attribute, and default',
        );
      }
      if (seenFields.has(field)) {
        throw staticOpenElementError(`${context}.${name} declares ${field} more than once`);
      }
      seenFields.add(field);
      if (field === 'reflect') {
        reflect = parseStaticBoolean(raw, `${context}.${name}.reflect`);
      } else if (field === 'attribute') {
        if (raw.kind === ts.SyntaxKind.FalseKeyword) {
          attribute = null;
          attributeExplicit = true;
        } else if (ts.isStringLiteral(raw) && raw.text.length > 0) {
          const normalized = raw.text.toLowerCase();
          if (!isSafeAttributeName(normalized)) {
            throw staticOpenElementError(
              `${context}.${name}.attribute "${raw.text}" is not a safe HTML attribute name`,
            );
          }
          attribute = normalized;
          attributeExplicit = true;
        } else {
          throw staticOpenElementError(
            `${context}.${name}.attribute must be a string literal or false`,
          );
        }
      } else {
        defaultValue = parseStaticPropertyDefault(sourceFile, raw, `${context}.${name}.default`);
      }
    }
    if (reflect && attribute === null) {
      throw staticOpenElementError(
        `${context}.${name} cannot reflect without an attribute channel`,
      );
    }
    const effectiveAttribute = attribute === undefined ? camelToKebab(name) : attribute;
    if (effectiveAttribute !== null) {
      if (attributes.has(effectiveAttribute)) {
        throw staticOpenElementError(
          `${context} declares attribute "${effectiveAttribute}" more than once`,
        );
      }
      attributes.add(effectiveAttribute);
    }
    result[name] = {
      attribute: effectiveAttribute,
      attributeExplicit,
      reflect,
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
    };
  }
  return result;
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
    if (
      ![
        'ssr',
        'dsd',
        'hydrate',
        'media',
        'styles',
        'root',
        'delegatesFocus',
        'formAssociated',
        'properties',
        'tags',
        'tagNames',
        'exportNames',
      ].includes(key)
    ) {
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
    } else if (key === 'styles') {
      // The generated-island style declaration (GH issue #1800). The runtime
      // authoring face validates the same shape; this pass is the build-time
      // authority for the authored sidecar and the lane/root admission below
      // (`scanIslandMeta`) decides whether the declaration can be delivered.
      meta.styles = parseStaticStyleList(raw, 'openElement.styles', sourceFile);
    } else if (key === 'root') {
      // `IslandConfig.root` is a published field the runtime already validates;
      // the static scan is the build-time authority for the same two values and
      // fails closed on anything else (P8: one sidecar, two readers, one
      // accepted set).
      const value = literalText(raw, 'openElement.root');
      if (value !== 'light' && value !== 'shadow') {
        throw staticOpenElementError(`openElement.root has unsupported value "${value}"`);
      }
      meta.root = value;
    } else if (key === 'delegatesFocus') {
      // The same static-literal rule as ssr/dsd: a boolean literal or a coded
      // refusal. The runtime authoring surface validates the same field; this
      // pass is the build-time authority for the authored sidecar.
      if (raw.kind !== ts.SyntaxKind.TrueKeyword && raw.kind !== ts.SyntaxKind.FalseKeyword) {
        throw staticOpenElementError(
          `openElement.delegatesFocus must be a static literal, got dynamic value "${raw.getText(
            sourceFile,
          )}"`,
        );
      }
      meta.delegatesFocus = raw.kind === ts.SyntaxKind.TrueKeyword;
    } else if (key === 'formAssociated') {
      if (raw.kind !== ts.SyntaxKind.TrueKeyword && raw.kind !== ts.SyntaxKind.FalseKeyword) {
        throw staticOpenElementError(
          `openElement.formAssociated must be a static literal, got dynamic value "${raw.getText(
            sourceFile,
          )}"`,
        );
      }
      meta.formAssociated = raw.kind === ts.SyntaxKind.TrueKeyword;
    } else if (key === 'properties') {
      meta.properties = parseStaticPropertyTable(sourceFile, raw, 'openElement.properties');
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
  if (meta.delegatesFocus === true && meta.root !== 'shadow') {
    throw staticOpenElementError(
      'openElement.delegatesFocus requires root: "shadow" — a light root has no shadow boundary',
    );
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
 * The two coded refusals the generated-island `styles` admission raises (GH
 * issue #1800). They are `OE_`-prefixed producer codes so the CLI's diagnostics
 * exit keeps them verbatim on the envelope (#1612) instead of classifying the
 * failure as uncoded — a host must be able to tell the shadow-carrier gap from
 * the class-lane gap without pattern-matching prose.
 */
const ISLAND_STYLES_SHADOW_UNWIRED_CODE = IslandErrorCode.STYLE_SHADOW_UNWIRED;
const ISLAND_STYLES_LANE_UNSUPPORTED_CODE = IslandErrorCode.STYLE_LANE_UNSUPPORTED;

/**
 * Admit one island's declared stylesheets (`IslandConfig.styles`, GH issue
 * #1800) on the lane/root the compiler identity resolved for it, or fail
 * closed.
 *
 * Carrier matrix for this slice (the Alpha17 generated-island style adoption is
 * the owner of the missing delivery surfaces, GH issue #1800):
 *
 * - `light-no-producer` (a light-root generated-element island): admitted. The
 *   list is recorded in the build-time declaration carrier
 *   (`island-style-declarations.ts`), which the client build's style-edge plan
 *   turns into the SAME content-addressed `.css` asset and client asset
 *   manifest entry the class lane's sheets get. The document-level application
 *   of that asset is the Alpha17 adoption slice, not this one.
 * - `producer` (a shadow-root generated-element island whose leaf emitted the
 *   compiled host producer): admitted with root `shadow`. The carried sheet is
 *   declared INSIDE the host's DSD template as the canonical marked `<link>`
 *   prefix (M09-2e / #1803); a sheet the client build did not emit fails the
 *   build closed, so the asset and the declared link cannot disagree.
 * - `missing-producer` (a shadow-root island with no compiled host producer):
 *   refused. There is no DSD template to declare the sheet in and no client
 *   adoption channel yet, so shipping the asset would be a silent loss dressed
 *   up as delivery.
 * - `lane-declined` (the module is not a generated-element island: a class
 *   island or a file outside the lane's admission): refused. A class island
 *   owns the `static styles` + `.css` import channel; this field would be
 *   ignored by the compiled class, i.e. silently dropped.
 * - `lane-refused`: the compiler already refuses the module, and the transform
 *   is the authoritative build-failure reporter. The scan records nothing and
 *   raises no second, less precise error — the build cannot ship the module
 *   with or without a style declaration.
 *
 * Returns the accepted specifiers for the scanned metadata record.
 */
function admitIslandStyles(input: {
  readonly filePath: string;
  readonly tagName: string;
  readonly islandsDir: string;
  readonly absoluteModuleId: string;
  readonly identity: GeneratedElementHostIdentity;
  readonly styles: readonly string[];
}): string[] {
  switch (input.identity.kind) {
    case 'light-no-producer':
      registerIslandStyleDeclaration({
        tagName: input.tagName,
        root: 'light',
        moduleId: input.absoluteModuleId,
        filePath: input.filePath,
        islandsDir: normalizeSeparators(input.islandsDir),
        specifiers: input.styles,
      });
      return [...input.styles];
    case 'producer':
      // M09-2e / #1803: the DSD style-link carrier exists for a shadow host
      // with a compiled producer. The client build joins this declaration to
      // the emitted asset and the generated SSR entry declares the canonical
      // marked `<link>` inside the template; a missing asset fails closed there.
      registerIslandStyleDeclaration({
        tagName: input.tagName,
        root: 'shadow',
        moduleId: input.absoluteModuleId,
        filePath: input.filePath,
        islandsDir: normalizeSeparators(input.islandsDir),
        specifiers: input.styles,
      });
      return [...input.styles];
    case 'missing-producer':
      throw reportScanFatal(
        buildError(
          ISLAND_STYLES_SHADOW_UNWIRED_CODE,
          `Island "${input.filePath}" (<${input.tagName}>) declares openElement.styles on a ` +
            'shadow-root generated element whose leaf emitted no compiled DSD host producer, ' +
            'so there is no template the canonical style link could be declared in. The ' +
            'declared sheets would be silently lost, so the build fails closed: give the ' +
            "component a claimable/SSR-capable shadow shape, set root: 'light', or remove " +
            'styles (generated-island client style adoption is GH issue #1800, Alpha17).',
        ),
      );
    case 'lane-refused':
      // The compiler owns this failure; registering an edge for a module that
      // cannot compile would emit an orphan asset and mask the authoritative
      // diagnostics with a second error.
      return [];
    case 'lane-declined':
      throw reportScanFatal(
        buildError(
          ISLAND_STYLES_LANE_UNSUPPORTED_CODE,
          `Island "${input.filePath}" (<${input.tagName}>) declares openElement.styles but the ` +
            'compiler did not admit it as a generated-element island ' +
            `(${input.identity.reason}). A class island declares its sheets through \`.css\` ` +
            'imports arrayed in `static styles`, and this field would be silently dropped, so the ' +
            "build fails closed: move the sheets to the component's static styles, or author the " +
            'island as a generated (default-exported function) island. Generated-island style ' +
            'adoption is GH issue #1800 (Alpha17).',
        ),
      );
  }
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
 * If a module cannot be read, its metadata is skipped with a structured
 * status: the unreadable module is reported on the scan log (never a silent
 * drop), and the scan result simply carries no record for that file.
 *
 * Delivery-tag ownership is checked HERE, at scan time: this record is keyed
 * by derived tag, so a second file deriving the same tag would silently
 * overwrite the first entry — and every consumer that looks a tag up
 * (build-postprocess, entry-descriptor, build-client) would then read the
 * survivor's sidecar for both files. Two files can collide because
 * pathToTagName is not injective (`a_b.tsx`/`a-b.tsx`, `about.tsx`/
 * `about-page.tsx`, `Card.tsx`/`card.tsx`), so the second claimant fails
 * `ISLAND_TAG_DUPLICATE` with both source paths named. This is the fail-early
 * half of one ownership invariant: the client manifest and the SSR admission
 * guards keep their own fail-late checks (defense in depth), and they only
 * ever see islands a page reaches.
 *
 * M11 prerequisite: the same pass resolves each local island's compiler-owned
 * generated-host identity from the source it just read (one extra compiler
 * call per `.tsx` island, including `ssr: false` ones — the classification is
 * admission-independent, so the scan never needs a second pass once a consumer
 * asks for it). The host-site fact comes from the existing
 * `createGeneratedElementSiteResolver`, the ONE identity helper the transform
 * hosts use, so the scan's admission and tag cannot diverge from the
 * transform's. The identity is attached to the scanned record as
 * `generatedElementHost`; the internal entry descriptor (`buildEntryDescriptor`)
 * re-attaches it to the scanned local island declarations (delivery aliases
 * included), and no renderer/registration consumer reads it yet.
 *
 * `projectRoot` is the compiler identity anchor: the compile call receives
 * `stableModuleId(fullPath, projectRoot)` (the same anchoring
 * `island-blocks-scan` uses) so a refusal diagnostic carries a stable
 * project-relative id, never a machine path. Only the host-site resolver gets
 * the absolute path, because it needs the `islandsDir` segment. Callers pass
 * their real root (the Vite plugin's resolved root, the SSG build's root); the
 * cwd default only serves hosts that never resolved one.
 *
 * Generated-island styles (GH issue #1800): the same pass admits each accepted
 * `styles` declaration into the build-time declaration carrier
 * (`island-style-declarations.ts`, reset first so the scan is authoritative) and
 * refuses it with a coded build error on every lane/root this slice cannot
 * deliver (shadow root: M09-2e owed; non-generated lane: the class island's
 * `static styles` channel owns it). The declaration itself never reaches the
 * public `IslandDecl` shape — it is build metadata, and the existing style plan
 * plus the client asset manifest are its delivery in this slice.
 */
export async function scanIslandMeta(
  islandsDir: string,
  islandFiles: string[],
  projectRoot: string = process.cwd(),
): Promise<Record<string, StoredIslandMeta>> {
  const meta: Record<string, LocalIslandMeta> = {};
  /** tag -> the island file that first wrote it (islandsDir-relative). */
  const tagClaimants = new Map<string, string>();
  // The generated-island style declarations are built from THIS scan, so the
  // scan owns the carrier's authority: a removed `styles` field cannot leave a
  // stale declaration for the client build's style plan (GH issue #1800).
  resetIslandStyleDeclarations();
  // One resolver per scan, over the same root the island loop reads: the
  // generated host site fact is the transform's own admission identity.
  const generatedElementSite = createGeneratedElementSiteResolver(normalizeSeparators(islandsDir));

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

    const claimant = tagClaimants.get(tagName);
    if (claimant !== undefined) {
      throw buildError(
        ClientAssetErrorCode.ISLAND_TAG_DUPLICATE,
        `Derived tag "${tagName}" is claimed by two island files: "${claimant}" and ` +
          `"${filePath}" — each island derives its tag from its path, so rename one file ` +
          `or declare the tag explicitly with the sidecar tags/tagNames option`,
      );
    }
    tagClaimants.set(tagName, filePath);

    // The compiler identity is project-anchored (the same `stableModuleId`
    // anchoring island-blocks-scan uses), so a refusal diagnostic carries a
    // stable id instead of the machine path. The ABSOLUTE path is only for
    // the host-site resolver, which anchors admission on the islandsDir
    // segment.
    const absoluteModuleId = normalizeSeparators(fullPath);
    const moduleId = stableModuleId(absoluteModuleId, projectRoot);
    const generatedElementHost = resolveGeneratedElementHost({
      source,
      moduleId,
      filePath,
      root: islandConfig.root,
      // The same host-side site fact the compiler transform resolves for this
      // module path (M09-1b); null means this host never admits the module.
      site: generatedElementSite(absoluteModuleId),
    });
    // The generated-island `styles` declaration (GH issue #1800): admitted only
    // on the one lane/root this slice can deliver (light-root generated island),
    // and refused with a coded build error everywhere else — never dropped.
    const styles =
      islandConfig.styles === undefined
        ? undefined
        : admitIslandStyles({
            filePath,
            tagName,
            islandsDir,
            absoluteModuleId,
            identity: generatedElementHost,
            styles: islandConfig.styles,
          });

    meta[tagName] = {
      tagName,
      filePath,
      generatedElementHost,
      ssr,
      dsd,
      hydrate,
      ...(islandConfig.media === undefined ? {} : { media: islandConfig.media }),
      ...(styles === undefined || styles.length === 0 ? {} : { styles }),
      ...(islandConfig.root === undefined ? {} : { root: islandConfig.root }),
      ...(islandConfig.delegatesFocus === undefined
        ? {}
        : { delegatesFocus: islandConfig.delegatesFocus }),
      ...(islandConfig.formAssociated === undefined
        ? {}
        : { formAssociated: islandConfig.formAssociated }),
      ...(islandConfig.properties === undefined ? {} : { properties: islandConfig.properties }),
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
