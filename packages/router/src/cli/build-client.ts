/**
 * @openelement/router - CLI: Client Island Build
 *
 * Client build for Island components.
 * Produces dist/client/islands/*.js + manifest for SSG post-processing, and
 * the client asset manifest (#1471) — compile-time island identity joined
 * with the build manifest and Rollup module metadata.
 *
 * Library module: exports buildClient(), invoked from closeBundle() in the
 * open:build plugin (the `oe build` task of a generated project runs the
 * unified multi-phase build). ctx parameter is required (no globalThis
 * fallback).
 */

import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import process from 'node:process';
import { build as viteBuild, type InlineConfig } from 'vite';
import { dirname, isAbsolute, join, relative, resolve } from 'pathe';
import {
  clientEntryNeedsElementRuntime,
  extractCustomElementTags,
  generateClientEntry,
  islandsMightUseBlocks,
  elementRuntimeBlocksAlias,
} from '../vite/internal/ssg/index.ts';
import { runtimeModulePath } from '../vite/internal/runtime-module-path.ts';
import { findBuildWorkspaceRoot } from '../vite/workspace-alias.ts';
import { buildClientIslandEntries } from '../vite/internal/ssg/client-island-entries.ts';
import { resolveElementServicesRuntimeModule } from '../vite/internal/ssg/entry-client-codegen.ts';
import {
  type ClientIslandDeliveryEntry,
  type IslandDeliveryMeta,
  resolveIslandDeliveryTags,
} from '../vite/internal/ssg/delivery.ts';
import { walkHtmlFileEntries } from '../vite/internal/html-files.ts';
import { VIRTUAL_RUNTIME_SPECIFIERS } from '../vite/internal/ssg/entry-generators.ts';
import type { OpenElementBuildContext } from '../vite/build-context.ts';
import type { IslandDecl } from '@openelement/protocol/ssg';
import type { ClientAssetManifest } from '@openelement/protocol/client-assets';
import {
  type ClientAssetIslandInput,
  createClientAssetManifest,
  collectClientBuildChunks,
  findClientEntryStyles,
  packageIslandChunkName,
  readViteClientManifest,
} from '../vite/client-asset-manifest.ts';
import { createClassCandidateRegistry } from '@openelement/compiler';
import { stylePlanForApp } from '../vite/internal/style-plan.ts';
import { createStyleBuildIntegration } from '../vite/internal/style-provider.ts';
import {
  ELEMENT_RUNTIME_ENTRY_SPECIFIER,
  type ElementRuntimeIdentity,
  elementRuntimeChunkName,
  requireElementRuntimeChunk,
  requireEntryStaticGraphFreeOfRuntime,
  resolveElementRuntimeIdentity,
} from '../vite/internal/element-runtime-chunk.ts';
import { requireViteHelperChunk, viteHelperChunkName } from '../vite/internal/vite-helper-chunk.ts';
import {
  analyzeModuleSemantics,
  clearStyleRequests,
  compiledElementPlugin,
} from '@openelement/compiler';
import { ELEMENT_RUNTIME_MESSAGES_DEFINE } from '../vite/internal/element-error-messages.ts';
import {
  type ServerRenderedSeeds,
  type StyleAssetRecord,
  clientStyleAssetPlugin,
  serverRenderedStyleEdgesPlugin,
} from '../vite/internal/style-assets.ts';
import { ISLAND_ADMISSION } from '@openelement/protocol/island-admission';
import { ROUTER_MODULE_VOCABULARY } from '@openelement/protocol/module-vocabulary';
import {
  createServerComponentSourceResolver,
  serverComponentAdmissionTags,
} from '../vite/internal/server-component-host.ts';
import { compilerBehaviorDeclarations } from '../vite/internal/ssg/client-admission.ts';
import { sortAliasEntries } from '../vite/alias-utils.ts';
import { formatError } from '@openelement/element';
import { createLogger } from '@openelement/element';
import { buildError, ClientAssetErrorCode, ClientBuildErrorCode } from '../internal/error-codes.ts';
import {
  CHUNK_SIZE_WARNING_LIMIT_KB,
  DEFAULT_ISLANDS_DIR,
  DEFAULT_OUT_DIR,
} from '../vite/internal/paths.ts';

const log = createLogger('build-client');

const VIRTUAL_CLIENT_ENTRY_ID = 'virtual:open-client-entry';
const RESOLVED_CLIENT_ENTRY_ID = '\0' + VIRTUAL_CLIENT_ENTRY_ID;

type DeliveryIslandRecord = IslandDeliveryMeta & { tagName?: string };

function deliveryTagsForLocal(
  tagName: string,
  meta: Partial<DeliveryIslandRecord> | undefined,
): string[] {
  return resolveIslandDeliveryTags(tagName, meta?.tags, meta?.tagNames, tagName);
}

function deliveryTagsForPackage(island: IslandDecl): string[] {
  const delivery = island as IslandDecl & DeliveryIslandRecord;
  return resolveIslandDeliveryTags(
    island.tagName,
    delivery.tags,
    delivery.tagNames,
    island.tagName,
  );
}

/**
 * The chunk-grouping identity for one declared package island: the module id
 * the client build's identity pass resolved for the island's declared
 * specifier — the same id the asset manifest joins on. Every admitted
 * specifier is resolved before chunk grouping runs, so a missing id here is
 * an internal ordering bug and fails with a coded build error instead of
 * grouping chunks on the raw specifier.
 */
export function packageIslandIdentity(
  island: IslandDecl,
  islandModuleIds: ReadonlyMap<string, string>,
): { tagName: string; identity: string } {
  const identity = islandModuleIds.get(island.modulePath);
  if (!identity) {
    throw buildError(
      ClientBuildErrorCode.PACKAGE_IDENTITY_UNRESOLVED,
      `[openElement] Package island "${island.tagName}" declared specifier ` +
        `"${island.modulePath}" was never resolved by the client build's identity pass — ` +
        `refusing to group chunks on an unresolved identity`,
    );
  }
  return { tagName: island.tagName, identity };
}

const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function sourceCandidates(base: string): string[] {
  const withoutExtension = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(base)
    ? base.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/, '')
    : base;
  const stems = withoutExtension === base ? [base] : [base, withoutExtension];
  return [
    ...new Set(
      stems.flatMap((stem) => [
        stem,
        ...SOURCE_EXTENSIONS.slice(1).map((extension) => `${stem}${extension}`),
        ...SOURCE_EXTENSIONS.slice(1).map((extension) => join(stem, `index${extension}`)),
      ]),
    ),
  ];
}

function isWithinRoot(candidate: string, root: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
}

function existingSourceFile(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // A directory or unreadable path is not a source graph node.
    }
  }
  return null;
}

function resolveSourceImport(fromFile: string, specifier: string, root: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  const base = resolve(dirname(fromFile), cleanSpecifier);
  if (!isWithinRoot(base, root)) return null;
  if (base.replaceAll('\\', '/').includes('/node_modules/')) return null;
  return existingSourceFile(sourceCandidates(base));
}

function resolveConfiguredSource(root: string, importPath: string): string | null {
  const candidate = importPath.startsWith('/')
    ? resolve(root, importPath.slice(1))
    : resolve(root, importPath);
  if (!isWithinRoot(candidate, root)) return null;
  return existingSourceFile(sourceCandidates(candidate));
}

/**
 * Select only admitted island tags that are observable in the rendered site
 * or in a request-time page source. This keeps a declaration from becoming a
 * client-bundle tax merely because it exists in app/islands/.
 */
/**
 * The server-renderable module roots the CSS discovery pass walks (S-C1.4).
 *
 * Route/page/layout sources are SERVER-renderable roots and have nothing to do
 * with browser hydration: this list must never be NARROWED to the island set
 * the client bundle admits (a component whose JavaScript is never admitted to a
 * client bundle still owns stylesheets that must be emitted). Three
 * authoritative, hydration-independent sources are unioned with the traversal's
 * own file set:
 *
 *  - the production build plan's route modules (`ctx.buildPlan.routes`), which
 *    exist whenever the build knows a route — including builds where the
 *    optional route cache the traversal reads is empty;
 *  - the configured layout shells (`layout` / `layouts`), which render on the
 *    server for every route but are not route modules themselves;
 *  - every SSR-RENDERABLE island module, which is exactly the set the generated
 *    SSR entry imports: the entry registers each admitted tag so any of them
 *    can appear in server-rendered markup, whether or not a page references it.
 *    A package island no page references (the packed consumer's installed
 *    `@openelement/ui/open-input`) is such a root — its `.css` edge is loaded by
 *    the SSR build like any other, and the client build owns that emitted asset.
 *
 * Island modules are returned as SPECIFIERS: a package island is addressable
 * only through the bundler's own resolution, and the discovery pass resolves
 * them exactly as the entry's import does.
 */
function serverRenderedSeeds(
  ctx: OpenElementBuildContext,
  root: string,
  scanned: ReadonlySet<string>,
  declared: {
    readonly localTagNames: readonly string[];
    readonly localFiles: readonly string[];
    readonly packageDecls: readonly IslandDecl[];
  },
): ServerRenderedSeeds {
  const seeds = new Set(scanned);
  for (const route of ctx.buildPlan?.routes ?? []) {
    const file = resolve(root, route.filePath);
    if (existsSync(file)) seeds.add(file);
  }
  const shells = [ctx.phase3.layout, ...Object.values(ctx.phase3.layouts ?? {})];
  for (const shell of shells) {
    const source = (shell as { import?: unknown } | null | undefined)?.import;
    if (typeof source !== 'string') continue;
    const file = resolve(root, source.startsWith('/') ? source.slice(1) : source);
    if (existsSync(file)) seeds.add(file);
  }
  // The SSR entry's island imports, read from the same two facts the entry
  // generator reads: the DECLARED islands (the client bundle's reachability
  // selection runs later and must not narrow this) and the admission plan's
  // renderable set. A `hydrate: 'only'` island renders no server markup and is
  // excluded by that set, so its sheets never become a build tax.
  const renderableTags =
    ctx.phase1.ssrAdmissionPlan === null
      ? undefined
      : new Set(ctx.phase1.ssrAdmissionPlan.renderableTags);
  const isRenderable = (tags: readonly string[]): boolean =>
    renderableTags === undefined || tags.some((tag) => renderableTags.has(tag));
  const islandsDir = ctx.phase3.islandsDir || DEFAULT_ISLANDS_DIR;
  declared.localTagNames.forEach((tagName, index) => {
    const meta = ctx.phase1.islandMeta[tagName] as Partial<DeliveryIslandRecord> | undefined;
    if (!isRenderable(deliveryTagsForLocal(tagName, meta))) return;
    const islandFile = declared.localFiles[index];
    if (!islandFile) return;
    const file = resolve(root, islandsDir, islandFile);
    if (existsSync(file)) seeds.add(file);
  });
  const specifiers = new Set<string>();
  for (const island of declared.packageDecls) {
    if (!isRenderable(deliveryTagsForPackage(island))) continue;
    specifiers.add(island.modulePath);
  }
  return { files: [...seeds], specifiers: [...specifiers] };
}

export interface ReachableSourceScan {
  /** The admitted island tags observable in the rendered site or page sources. */
  readonly tags: Set<string>;
  /**
   * Every local source file the traversal visited — the route/page/layout
   * modules the server renders and everything they import. It is the SEED set
   * of the server-rendered style-edge pass (S-C1.4, #1609), which then walks
   * the static module graph through the bundler's own resolver.
   */
  readonly sourceFiles: Set<string>;
}

export function findReachableIslandTags(
  ctx: OpenElementBuildContext,
  root: string,
  outDir: string,
  candidates: string[],
): ReachableSourceScan {
  const plan = ctx.phase1.ssrAdmissionPlan;
  const admitted = plan
    ? new Set([...plan.renderableTags, ...plan.clientOnlyTags])
    : new Set(candidates);
  const allowed = candidates.filter((tag) => admitted.has(tag));
  const reachable = new Set<string>();
  const candidateSet = new Set(allowed);
  const recordSource = (source: string, filePath?: string): void => {
    if (filePath) {
      const semantics = analyzeModuleSemantics(source, filePath, {
        vocabulary: ROUTER_MODULE_VOCABULARY,
      });
      for (const tag of semantics.referencedCustomElementTags) {
        if (candidateSet.has(tag)) reachable.add(tag);
      }
    } else {
      for (const tag of extractCustomElementTags(source)) {
        if (candidateSet.has(tag)) reachable.add(tag);
      }
    }
  };

  const visitedSourceFiles = new Set<string>();
  const recordSourceFile = (filePath: string): void => {
    const normalizedPath = resolve(filePath);
    if (visitedSourceFiles.has(normalizedPath)) return;
    visitedSourceFiles.add(normalizedPath);
    let source: string;
    try {
      source = readFileSync(normalizedPath, 'utf8');
    } catch {
      return;
    }
    const semantics = analyzeModuleSemantics(source, normalizedPath, {
      vocabulary: ROUTER_MODULE_VOCABULARY,
    });
    recordSource(source, normalizedPath);
    if (ctx.options.renderer === 'lit') {
      // #1339: lit pages reference islands inside html`` template literals,
      // which the JSX-oriented semantic scan never sees. The raw-text
      // extractor (the same one used for rendered HTML) observes them.
      for (const tag of extractCustomElementTags(source)) {
        if (candidateSet.has(tag)) reachable.add(tag);
      }
    }
    // Importing a local island module is an explicit registration-capability
    // edge even when its tag is created later by opaque third-party code.
    // The declaration itself is therefore observable reachability evidence.
    for (const tag of semantics.definedCustomElementTags) {
      if (candidateSet.has(tag)) reachable.add(tag);
    }
    for (const specifier of semantics.relativeImports) {
      const imported = resolveSourceImport(normalizedPath, specifier, root);
      if (imported) recordSourceFile(imported);
    }
  };

  for (const entry of walkHtmlFileEntries(resolve(root, outDir))) {
    recordSource(readFileSync(entry.absolutePath, 'utf8'));
  }

  const routesDir = ctx.phase3.routesDir || 'app/routes';
  for (const route of ctx.phase1.cachedRoutes ?? []) {
    if (route.type !== 'page' || route.special) continue;
    recordSourceFile(resolve(root, routesDir, route.filePath));
  }

  const layoutConfigs = [ctx.phase3.layout, ...Object.values(ctx.phase3.layouts ?? {})];
  for (const shell of layoutConfigs) {
    if (!shell || typeof shell !== 'object') continue;
    const shellFile = resolveConfiguredSource(root, shell.import);
    if (shellFile) recordSourceFile(shellFile);
  }

  // A project without route metadata can still call buildClient() directly
  // (used by adapter integrations). In that case preserve admitted entries;
  // normal app builds always have HTML or route sources to establish reachability.
  if ((ctx.phase1.cachedRoutes ?? []).length === 0 && reachable.size === 0) {
    return { tags: new Set(allowed), sourceFiles: visitedSourceFiles };
  }
  return { tags: reachable, sourceFiles: visitedSourceFiles };
}

async function removeClientDeliveryArtifacts(root: string, outDir: string): Promise<void> {
  await rm(resolve(root, outDir, 'client'), { recursive: true, force: true }).catch(() => {});
  await rm(resolve(root, outDir, 'island-manifests'), { recursive: true, force: true }).catch(
    () => {},
  );
}

// #868: the browser runtimes are real modules bundled through virtual
// specifiers — resolved by the shared runtimeModulePath helper
// (vite/internal/runtime-module-path.ts).

type ViteBuildOptionsWithManifest = NonNullable<InlineConfig['build']> & {
  manifest?: boolean;
};

type ViteInlineConfigWithManifest = Omit<InlineConfig, 'build'> & {
  build?: ViteBuildOptionsWithManifest;
};

async function buildClient(ctx: OpenElementBuildContext): Promise<ClientAssetManifest | null> {
  // the style-request registry's bookkeeping is this build's
  // lifetime — the SSR build clears and re-registers through its own
  // transforms, and a stale entry from an earlier build in this process must
  // never answer a request this build's graph did not produce. The clear runs
  // AFTER the server-rendered-edges read below, which asks the Phase 1 graph's
  // registrations whether this app owns server-only sheets at all (S-C2/S-12).
  const root = ctx.phase3.root || process.cwd();
  const outDir = ctx.phase3.outDir || DEFAULT_OUT_DIR;
  const islandsDir = ctx.phase3.islandsDir || DEFAULT_ISLANDS_DIR;
  const localIslands = ctx.phase1.islandTagNames || [];
  const localIslandFiles = ctx.phase1.islandFiles || [];
  const packageIslandDecls = ctx.phase1.packageIslandDecls || [];
  const compilerBehaviorDecls = compilerBehaviorDeclarations(
    ctx.phase1.staticComponents,
    ctx.phase3.upgradeStrategy,
  );

  // Aliases pre-generated by createOpenPlugin() and stored in ctx
  const resolveAlias = ctx.phase1.userResolveAlias;
  // #709: shared specificity sort with alias-utils.ts (single implementation).
  const serializedAlias = sortAliasEntries(
    resolveAlias
      ? Array.isArray(resolveAlias)
        ? resolveAlias.map((a) => ({
            find: a.find,
            replacement: a.replacement,
          }))
        : Object.entries(resolveAlias).map(([find, replacement]) => ({ find, replacement }))
      : [],
  );

  // #569: an island-free app with data-open-enhance forms still needs the
  // client entry — it carries the form-enhancement layer.
  const enhancedForms = (ctx.phase1.cachedRoutes ?? []).some(
    (route) => route.type === 'page' && route.hasEnhancedForms === true,
  );

  // The style entry (alpha15 S lane; demand is DECLARED): the pipeline exists
  // when the application declares it OR an admitted package declaration
  // requires/offers it. With no declaration at all nothing here resolves, no
  // peer is loaded, no entry is generated and no resource is emitted. A
  // declared `false` is authoritative and fails closed when an admitted
  // component requires the compile. Which ENGINE compiles it is the
  // application's own declaration (`tailwind` or `unocss`); see `style-plan`.
  const stylePlan = stylePlanForApp(ctx, root, ctx.options.tailwind, ctx.options.unocss);

  // The component stylesheet (alpha15 S lane): the compiler's shadow-root
  // class candidates compiled by the same official peer into one shared,
  // content-addressed asset. The generated client entry registers it globally;
  // the SSR build declares it as a marked `<link>` in the DSD templates of the
  // components whose classes were admitted.
  //
  // The candidates are discovered INSIDE this build, from the bundler-resolved
  // module graph (the server-rendered discovery pass below): the client graph
  // holds islands only, and an inventory assembled outside the build could not
  // see a component reached through a `package.json` imports subpath or a
  // configured alias — the silent loss of defect B. This build OWNS the
  // registry (defect C): it is created here, written by this build's transform
  // and discovery pass, read by this build's stylesheet emitter, and it never
  // sees another build's facts.
  const shadowCandidateRegistry = createClassCandidateRegistry();
  /**
   * The module texts this build's discovery walk read (id → source). The walk
   * already reads every server-rendered module to ask the compiler for its
   * admission facts; a provider that extracts candidates from SOURCE (UnoCSS)
   * consumes these through its own extractors, so the framework never
   * tokenizes anything itself. One writer (the discovery pass), one reader
   * (the selected provider's document compile).
   */
  const walkedSources = new Map<string, string>();
  const componentSheetCandidates = (): readonly string[] =>
    stylePlan ? shadowCandidateRegistry.all() : [];
  const documentCandidates = (): readonly string[] =>
    stylePlan ? shadowCandidateRegistry.allLight() : [];
  /**
   * The style engine this build selected, its plugins and its emission
   * records. Constructed once the plan exists; an unselected engine is never
   * imported, so it cannot reach this build or the browser bundle.
   */
  const styleIntegration =
    stylePlan === undefined
      ? undefined
      : await createStyleBuildIntegration({
          root,
          plan: stylePlan,
          unocss: ctx.options.unocss,
          componentSheetCandidates,
          documentCandidates,
          sources: () => walkedSources,
        });
  /**
   * The component stylesheet's graph specifier, decided from the CURRENT
   * registry: the generated entry imports the adapter when (and only when) the
   * build discovered shadow candidates, so the client adopts the one shared
   * sheet. Asked lazily — the entry module's `load` runs after the discovery
   * pass registered its facts.
   */
  const componentSheetSpecifier = (): string | undefined =>
    componentSheetCandidates().length > 0
      ? styleIntegration?.provider.componentSheetSpecifier
      : undefined;
  /**
   * Whether the selected engine reads its candidates from source. The module
   * texts the discovery walk reads are republished only for such an engine.
   */
  const isSourceExtractingProvider = styleIntegration?.provider.documentDelivery === 'generated';

  const localDeliveryTags = localIslands.flatMap((tagName) =>
    deliveryTagsForLocal(
      tagName,
      ctx.phase1.islandMeta[tagName] as Partial<DeliveryIslandRecord> | undefined,
    ),
  );
  const packageDeliveryTags = packageIslandDecls.flatMap(deliveryTagsForPackage);
  const compilerDeliveryTags = compilerBehaviorDecls.flatMap(deliveryTagsForPackage);
  const candidateTags = [
    ...new Set([...localDeliveryTags, ...compilerDeliveryTags, ...packageDeliveryTags]),
  ];
  const reachableScan = findReachableIslandTags(ctx, root, outDir, candidateTags);

  // The server-rendered roots this build must serve (S-C1.4). They are the
  // reason the emission stage runs even when the app has nothing to deliver to
  // the browser: a server-rendered component's authored `.css` edge is declared
  // by the SSR build as a URL, and the retired inline fallback is not an
  // answer. Without this term the zero-client-JS shortcuts below would return
  // before the client build and an app with no islands, no enhanced forms and
  // no Tailwind — but with server-rendered components that own sheets — would
  // emit no asset at all, failing the SSR build closed on every one of its
  // sheets (reproduced on the non-root-base fixture, S-C2/S-12).
  const seeds = serverRenderedSeeds(ctx, root, reachableScan.sourceFiles, {
    localTagNames: localIslands,
    localFiles: localIslandFiles,
    packageDecls: packageIslandDecls,
  });
  const hasServerRenderedRoots = seeds.files.length > 0 || seeds.specifiers.length > 0;
  // This build's own registry lifetime starts here.
  clearStyleRequests();

  if (
    localIslands.length === 0 &&
    packageIslandDecls.length === 0 &&
    compilerBehaviorDecls.length === 0 &&
    !enhancedForms &&
    !stylePlan &&
    !hasServerRenderedRoots
  ) {
    await removeClientDeliveryArtifacts(root, outDir);
    log.info('No islands found - zero client JS output');
    return null;
  }

  const reachableTags = reachableScan.tags;
  const selectedLocal = localIslands
    .map((tagName, index) => ({ tagName, index }))
    .filter(({ tagName }) =>
      deliveryTagsForLocal(
        tagName,
        ctx.phase1.islandMeta[tagName] as Partial<DeliveryIslandRecord> | undefined,
      ).some((deliveredTag) => reachableTags.has(deliveredTag)),
    );
  const selectedLocalTags = selectedLocal.map(({ tagName }) => tagName);
  const selectedLocalFiles = selectedLocal.map(
    ({ tagName, index }) => localIslandFiles[index] || `${tagName}.ts`,
  );
  const selectedPackageDecls = packageIslandDecls.filter((island) =>
    deliveryTagsForPackage(island).some((deliveredTag) => reachableTags.has(deliveredTag)),
  );
  const selectedCompilerBehaviorDecls = compilerBehaviorDecls.filter((island) =>
    deliveryTagsForPackage(island).some((deliveredTag) => reachableTags.has(deliveredTag)),
  );

  // Keep the post-processor and manifest inputs in lockstep with the exact
  // client entry. This also makes an unused declaration disappear from the
  // generated per-page manifests instead of leaving a false chunk reference.
  ctx.phase1.islandTagNames = selectedLocalTags;
  ctx.phase1.islandFiles = selectedLocalFiles;
  ctx.phase1.packageIslandDecls = selectedPackageDecls;
  ctx.phase1.compilerBehaviorDecls = selectedCompilerBehaviorDecls;

  // S-C2/S-12: an app with server-rendered sheets but nothing to deliver to
  // the browser still needs this build — for the emission stage alone. The
  // generated entry is the island-free placeholder (`generateClientEntry`), so
  // the build ships styles and no client JavaScript.
  //
  // Defect D: this shape is decided by the ENTRY's own runtime requirement, not
  // by which feature asked for the build. A Tailwind-enabled app with no islands
  // and no enhanced forms generates the same island-free (CSS-only) entry, so it
  // ships styles and no client JavaScript too — and the element-runtime chunk
  // guard must not demand a runtime module for an entry that never imports one.
  // The fact comes from the entry generator's own helper (below), so the guard,
  // the JS drop and the generated code cannot drift apart.

  if (
    selectedLocalTags.length === 0 &&
    selectedPackageDecls.length === 0 &&
    selectedCompilerBehaviorDecls.length === 0 &&
    !enhancedForms &&
    !stylePlan &&
    !hasServerRenderedRoots
  ) {
    await removeClientDeliveryArtifacts(root, outDir);
    log.info('No admitted reachable islands - zero client JS output');
    return null;
  }

  const totalIslands =
    selectedLocalTags.length + selectedCompilerBehaviorDecls.length + selectedPackageDecls.length;
  log.info(
    `Building client bundle for ${totalIslands} island(s)` +
      (enhancedForms ? ' + data-open-enhance form enhancement' : '') +
      '...',
  );

  // Generate client entry code (#951: entry list built by the shared helper,
  // identical to what the dev island client plugin serves).
  const islandEntries: ClientIslandDeliveryEntry[] = buildClientIslandEntries({
    root,
    islandsDir,
    islandTagNames: selectedLocalTags,
    islandFiles: selectedLocalFiles,
    islandMeta: ctx.phase1.islandMeta,
    packageIslandDecls: selectedPackageDecls,
    compilerBehaviorDecls: selectedCompilerBehaviorDecls,
    upgradeStrategy: ctx.phase3.upgradeStrategy,
  });

  // The generated entry's own runtime requirement — the one fact the guard and
  // the JS drop below consume, asked of the generator with the exact inputs it
  // will be called with (defect D: an entry that imports only the document
  // stylesheet must not be held to the island entry's runtime contract).
  const entryNeedsElementRuntime = clientEntryNeedsElementRuntime(islandEntries, {
    enhancedForms,
  });
  const styleOnlyEmission = !entryNeedsElementRuntime;
  if (styleOnlyEmission) {
    log.info('Island-free client entry - style-only client build, zero client JS');
  }

  // #1471: island identity comes from this build's own resolver. Each
  // admitted island's declared module specifier — local islands, package
  // islands and compiler behavior islands alike — is resolved ONCE through
  // the client build (the identity plugin's buildStart `this.resolve`, the
  // same plugin container, alias table and node_modules layout the generated
  // client entry's dynamic imports resolve through), and the resulting
  // module ids feed both the chunk grouping and the asset manifest join.
  // The map is ephemeral output of this build — not a registry and not a
  // second resolution source. Fail-closed: a specifier this build cannot
  // resolve fails here, and a resolved id the emitted module graph does not
  // carry fails the manifest join; neither path falls back to guessing a
  // different same-named module.
  const islandModuleIds = new Map<string, string>();
  const declaredIslandSpecifiers = [...new Set(islandEntries.map((entry) => entry.modulePath))];

  // #1544: the shared element-runtime chunk's grouping identity — the
  // element package root, derived from a module id this build's own resolver
  // answers (same identity pass, same virtual-entry importer the generated
  // entry's runtime import resolves through). Filled in buildStart, before
  // chunk grouping runs, renderer-independent: the specifier resolves under
  // lit too — the lit entry is element-free (#1339), but element modules
  // still reach its graph transitively through the router client runtime —
  // so the identity, and the group, are real under both renderers. Only the
  // guards are renderer-conditional: an unresolvable specifier fails a
  // native build and is tolerated under lit.
  let elementRuntimeIdentity: ElementRuntimeIdentity | null = null;

  const clientAssetIslands: ClientAssetIslandInput[] = [
    ...selectedLocalTags.map((tagName, index) => ({
      entry: islandEntries[index],
      sourceFile: resolve(
        root,
        selectedLocalFiles[index]
          ? `${islandsDir}/${selectedLocalFiles[index]}`
          : `${islandsDir}/${tagName}.ts`,
      ),
    })),
    // Package-side islands keep their declared specifier as the identity the
    // manifest join resolves: the identity pass above pins each specifier to
    // the actual module id, and the join confirms that id against the emitted
    // graph before any island is attributed.
    ...islandEntries.slice(selectedLocalTags.length).map((entry) => ({
      entry,
      sourceFile: null,
    })),
  ];

  // The chunk-grouping identities for the declared package islands — the
  // actual module ids the identity pass resolved, the same ids the asset
  // manifest joins on. Every admitted package island was resolved or the
  // build already failed, so a missing id here is an internal ordering bug
  // and fails instead of grouping on the raw specifier.
  const packageDeclIdentities = () =>
    selectedPackageDecls.map((island) => packageIslandIdentity(island, islandModuleIds));

  // #1548: the blocks axis of the element entry selection. The scan asks the
  // compiler (the single owner of the fact) whether any admitted island
  // module lowers when/each Block Parts; only its proof of absence drops
  // the Block builders from the page's element entry. The sidecar
  // descriptors match the compiledElementPlugin call below, so the scan
  // admits exactly the modules the build's own transform admits.
  const mightUseBlocks = islandsMightUseBlocks({
    root,
    islandsDir,
    islandTagNames: selectedLocalTags,
    islandFiles: selectedLocalFiles,
    packageIslandDecls: selectedPackageDecls,
    compilerBehaviorDecls: selectedCompilerBehaviorDecls,
    staticSidecars: [ISLAND_ADMISSION],
  });
  // The emission half of the same axis: resolve the bare element specifier to
  // the blocks-free entry for the whole client graph. Native renderer only —
  // a lit build's element modules arrive transitively through the router
  // client runtime and its generated entry is element-free (#1339).
  const elementRuntimeBlocksAliasValue =
    !mightUseBlocks && ctx.options.renderer !== 'lit'
      ? elementRuntimeBlocksAlias(root, serializedAlias)
      : undefined;

  /**
   * The generated entry's text, built when the module graph asks for the entry
   * (a `load` hook) rather than when the plugin list is assembled: the
   * component stylesheet's adapter import depends on the shadow candidates this
   * build DISCOVERS, and the discovery pass registers them in its own
   * `buildStart` — before any module loads, but after this closure is created.
   */
  const buildClientEntryCode = (): string => {
    const utilitySheet = componentSheetSpecifier();
    return generateClientEntry(islandEntries, {
      enhancedForms,
      renderer: ctx.options.renderer,
      // The document stylesheet's module: for a `graph-entry` provider the
      // generated entry imports the CSS entry so the engine's pipeline
      // compiles it inside this build's CSS graph and Vite emits the
      // content-hashed `.css` asset (plus every `url()` asset the sources
      // reference) into dist/client. No other module imports it, so the entry
      // chunk's CSS is exactly the document stylesheet. A `generated` provider
      // emits its document sheet as its own asset and the head links it, so
      // nothing is imported here.
      ...(stylePlan !== undefined && styleIntegration?.provider.documentDelivery === 'graph-entry'
        ? { styleEntry: styleIntegration.provider.documentSheetModule }
        : {}),
      // The component stylesheet's adapter: imported and registered by the entry
      // (native renderer) when the compiler admitted shadow-root candidates.
      ...(utilitySheet === undefined ? {} : { utilitySheet }),
      // Omitted on any doubt: the flag's default (builders installed) is the
      // entry codegen's own conservative default, not a second copy of it. The
      // alias bailing out does not flip this flag: the entry subpath resolves
      // through the package exports regardless of the alias, and keeping the
      // builders in the entry graph is the safe direction.
      ...(mightUseBlocks ? {} : { includeBlocksRuntime: false }),
    });
  };

  // Restore RegExp from serialized noExternal patterns
  const noExternalPatterns = (ctx.phase3.ssrNoExternal || []).map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && (item as Record<string, unknown>).__type === 'RegExp') {
      return new RegExp(
        (item as { source: string; flags: string }).source,
        (item as { source: string; flags: string }).flags,
      );
    }
    return item;
  });

  const clientOutDir = resolve(root, outDir, 'client');
  const clientBase = ctx.phase3.base || '/';

  // The selected engine's plugins, in the two positions their ordering
  // requires (alpha15 S lane + stage 2B). A `graph-entry` provider contributes
  // its virtual entry plus the official peer (`@tailwindcss/vite`, an optional
  // peer that fails closed with the loader's own coded diagnostic when
  // missing) BEFORE the discovery pass — Vite's CSS graph compiles that entry
  // as it reaches it — and its sheet-compiling half after. A `generated`
  // provider contributes only the sheet half. Absent — not inert — when no plan
  // exists, so an unselected engine is never imported.
  const styleGraphPlugins = styleIntegration?.graphPlugins ?? [];
  const styleSheetPlugins = styleIntegration?.sheetPlugins ?? [];

  // this build owns the island style asset protocol's `.css`
  // artifacts. The emission records feed the manifest's `styles` field and
  // the Phase 3 SSR read.
  const styleAssetRecords = new Map<string, StyleAssetRecord>();
  // One emission state for this build: the graph path and the server-rendered
  // discovery pass share it (S-C1.4 packed fix).
  const styleAssetEmission = clientStyleAssetPlugin(styleAssetRecords);

  const clientConfig: ViteInlineConfigWithManifest = {
    configFile: false,
    root,
    base: `${clientBase}client/`,
    logLevel: 'warn',
    // The island bundle is a build-stage artifact, not a second copy of the
    // app's static files: copying public/ here would publish every static
    // asset under a second URL (`/client/openelement-mark.svg` beside
    // `/openelement-mark.svg`), byte-identical and differently cached. The
    // outer build already copies public/ into dist/, and the SSR bundle build
    // sets the same flag for the same reason (cli/build-ssg.ts).
    publicDir: false,
    // #1546: production bundles strip the element runtime's authored error
    // prose to its stable codes (element's protocol/errors.ts seam). Dev
    // builds never inject this, so dev keeps the full messages.
    define: ELEMENT_RUNTIME_MESSAGES_DEFINE,
    // JSX automatic runtime must be configured in the internal
    // viteBuild() call — configFile:false means user's vite.config.ts is
    // NOT read. Without this, the oxc transform falls back to the react
    // jsx-runtime import, producing {type, props, $$typeof} objects that
    // OpenElement does not recognize (causes [object Object] rendering).
    oxc: {
      jsx: {
        runtime: 'automatic',
        importSource: '@openelement/element',
      },
    },
    build: {
      outDir: clientOutDir,
      emptyOutDir: true,
      chunkSizeWarningLimit: CHUNK_SIZE_WARNING_LIMIT_KB,
      minify: 'oxc',
      manifest: true,
      rollupOptions: {
        input: { client: VIRTUAL_CLIENT_ENTRY_ID },
        output:
          ctx.options.renderer === 'lit'
            ? {
                format: 'esm',
                entryFileNames: 'islands/[name].js',
                chunkFileNames: 'islands/[name]-[hash].js',
                // #1339: lit hydration is order-sensitive —
                // lit-element-hydrate-support must set
                // globalThis.litElementHydrateSupport BEFORE any lit-element
                // module body reads it. Rolldown's default chunking can home
                // shared lit-html/lit-element modules in a lazy island chunk,
                // which then evaluates (via the entry's static import of the
                // shared chunk) BEFORE the entry's hydrate-support module — the
                // patch never applies and islands re-render instead of adopting
                // DSD (observed as duplicated island content). The manualChunks
                // compat shim did not hold here; use rolldown's native
                // codeSplitting with an explicit high-priority lit-runtime group:
                // it evaluates first (the entry imports hydrate-support first),
                // and island chunks keep only the island module, staying lazy.
                codeSplitting: {
                  groups: [
                    {
                      name: 'lit-runtime',
                      test: /\/(lit|lit-html|lit-element)\/|\/@lit\/|\/@lit-labs\/ssr-client\//,
                      priority: 20,
                    },
                    {
                      // B2 gap (a): the same dedicated eager home the native
                      // branch gives Vite's injected preload helper, for the
                      // same reason — the entry imports the helper, and a lit
                      // graph has island chunks of its own the helper would
                      // otherwise ride. Two properties are load-bearing and
                      // measured on the repro rather than assumed: the claim
                      // must live in a group of its OWN (folding it into the
                      // general decision group leaves the helper in the island
                      // chunk), and that group must outrank every other group
                      // in the build — lit declares 20/15/10 below, so this is
                      // strictly highest. With a higher-priority group present
                      // the helper follows that group's chunk again.
                      name(id: string) {
                        return viteHelperChunkName(id) ?? null;
                      },
                      priority: 30,
                    },
                    {
                      name: 'preact',
                      test: /node_modules\/preact|\/preact\//,
                      priority: 10,
                    },
                    {
                      // #1544: the element runtime rides one shared chunk,
                      // exactly as the native renderer's manualChunks branch
                      // groups it. Real under lit too: the identity pass
                      // resolves the runtime here as well, and the element
                      // modules that reach a lit graph transitively (router
                      // client runtime) home in this chunk. Harmless for lit
                      // — its element-free entry (#1339) has no ordering
                      // stake in the runtime — and a lit graph with zero
                      // element modules legally leaves the group empty (lit
                      // skips the post-build guard).
                      name(id: string) {
                        return elementRuntimeChunkName(id, elementRuntimeIdentity) ?? null;
                      },
                      priority: 15,
                    },
                    {
                      name(id: string) {
                        if (id.includes(`/${islandsDir}/`)) {
                          const match = id.match(/\/([^/]+)\.(ts|tsx|js|jsx)$/);
                          if (match) return `island-${match[1]}`;
                        }
                        // #1471: package islands group by the actual module id
                        // the asset manifest joins on — zero matches and
                        // ambiguous matches fail the build.
                        return packageIslandChunkName(id, packageDeclIdentities());
                      },
                    },
                  ],
                },
              }
            : {
                format: 'esm',
                entryFileNames: 'islands/[name].js',
                chunkFileNames: 'islands/[name]-[hash].js',
                // B2 gap (a) is why this branch is `codeSplitting`, not
                // `manualChunks`.
                //
                // Every rule below used to be a `manualChunks` function — the
                // Rollup-compat shim — and that worked for as long as every
                // module it had an opinion about was an ordinary resolved
                // module. Vite's injected preload helper is not: it is created
                // by Vite's NATIVE import-analysis plugin
                // (`native:import-analysis-build`), and the compat shim does
                // not re-home it. Measured, not inferred: `manualChunks` is
                // called with `\0vite/preload-helper.js` and returns the helper
                // chunk name, and the helper still lands in the island chunk —
                // reproduced on the real www build and on a minimal
                // one-entry/two-island repro. `codeSplitting` and
                // `manualChunks` are mutually exclusive (specifying both
                // silently discards `manualChunks`), so this is a migration of
                // the one decision into the surface that can express all of
                // it, never an addition beside the old one. The lit branch
                // below already groups this way, for the same documented
                // reason: the compat shim could not express what that branch
                // needed either.
                //
                // Two groups, not one, and the split is load-bearing. A
                // dedicated group whose `name` answers ONLY for the injected
                // helper ids re-homes the helper; folding the same answer into
                // the general decision group does not (measured on the repro:
                // the helper stays in the island chunk). The dedicated group
                // must also outrank every other group in the build — with a
                // group of higher priority present, the helper follows THAT
                // group's chunk again. Hence one helper-only group at a
                // priority above every rule the build declares, and the
                // pre-existing decision kept verbatim as its own group.
                codeSplitting: {
                  groups: [
                    {
                      name(id: string) {
                        return viteHelperChunkName(id) ?? null;
                      },
                      // Declared above every other group this build declares
                      // (and above the lit branch's 20/15/10). The priority is
                      // load-bearing, not decoration: measured on the repro, a
                      // competing group of HIGHER priority present in the same
                      // build re-claims the helper and the island edge returns.
                      // Keeping this group strictly highest is what makes the
                      // claim unconditional; the emitted-chunk guard below is
                      // what makes a future violation fatal instead of silent.
                      priority: 100,
                    },
                    {
                      name(id: string) {
                        // #1544: the element runtime rides one shared chunk
                        // every island imports, instead of homing inside
                        // whichever island chunk its import reached first. The
                        // match is exact package-root containment from the
                        // identity pass — a native build that groups zero
                        // runtime modules fails the post-build guard below
                        // rather than shipping per-island copies.
                        const runtimeChunk = elementRuntimeChunkName(id, elementRuntimeIdentity);
                        if (runtimeChunk) return runtimeChunk;
                        // Force preact + preact/hooks into a single chunk so the
                        // shared options object is not duplicated across chunks
                        // (which breaks hooks).
                        if (id.includes('node_modules/preact') || id.includes('/preact/')) {
                          return 'preact';
                        }
                        if (id.includes(`/${islandsDir}/`)) {
                          // Extension list contract: mirrors
                          // resolve.extensions below and scanIslands
                          // (ts/tsx/js/jsx), so every island module id matches
                          // and gets the `island-` prefix.
                          const match = id.match(/\/([^/]+)\.(ts|tsx|js|jsx)$/);
                          if (match) return `island-${match[1]}`;
                        }
                        // #1471: package islands group by the actual module id
                        // the asset manifest joins on — zero matches and
                        // ambiguous matches fail the build, never a substring
                        // first-hit. A group's "no opinion" answer is null.
                        return packageIslandChunkName(id, packageDeclIdentities()) ?? null;
                      },
                      priority: 0,
                    },
                  ],
                },
              },
      },
    },
    resolve: {
      alias: [
        // #1548: with the blocks scan's proof of absence, the WHOLE client
        // graph resolves the element runtime to the blocks-free entry — the
        // generated entry's specifier alone cannot prune the blocks cluster,
        // because every island module imports `@openelement/element` for its
        // base class and the package's sideEffects declaration (#1425) keeps
        // the default entry's installs alive in every graph that touches it.
        // Undefined (or lit, whose element modules arrive transitively and
        // whose entry is element-free) keeps the default resolution.
        ...(elementRuntimeBlocksAliasValue !== undefined ? [elementRuntimeBlocksAliasValue] : []),
        ...serializedAlias,
      ],
      // The browser-client resolve policy the outer resolved config carries
      // (captured in the open plugin's configResolved). Empty conditions and
      // an unset preserveSymlinks mean "nothing to override" and this build
      // supplies Vite's own client defaults.
      ...(ctx.phase1.clientResolveConditions.length > 0
        ? { conditions: [...ctx.phase1.clientResolveConditions] }
        : {}),
      ...(ctx.phase1.clientPreserveSymlinks ? { preserveSymlinks: true } : {}),
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
      dedupe: ['preact'],
    },
    ssr: {
      noExternal: (noExternalPatterns.length > 0 ? noExternalPatterns : undefined) as
        | (string | RegExp)[]
        | undefined,
    },
    plugins: [
      // The engine's graph half (stage 2B): the document entry module and the
      // official peer that compiles it, both inert until the entry is reached.
      ...styleGraphPlugins,
      // S-C1.4 (#1609) + defect B: the sources the SERVER renders are part of the
      // same asset build. The pass walks their static module graph through this
      // build's resolver, asks the compiler for each module's admission facts —
      // the authored `.css` edges AND the statically admitted class candidates
      // (defect B) — and registers both. It is mounted FIRST of the two
      // consumers: its `buildStart` discovery must complete before the
      // component stylesheet below compiles from those candidates. Emission of
      // the walked edges happens in the pass's own `load` hook, through the
      // SAME emission plugin further down — so a server-only sheet is emitted,
      // hashed and named exactly like an island's, and no server-only
      // JavaScript enters any client bundle.
      serverRenderedStyleEdgesPlugin(
        seeds,
        styleAssetEmission,
        shadowCandidateRegistry,
        // Admission is the scanned manifests (explicit and scan-derived alike):
        // the discovery pass uses the list to tell the app when a component
        // package it merely IMPORTS is not delivered. See the plugin's
        // parameter note.
        (ctx.phase1.packageManifests ?? []).map((manifest) => manifest.packageName),
        // The walk's own reads, republished for a provider whose extractors
        // consume source (alpha15 stage 2B). Absent — not empty — when the
        // selected engine's integration owns its own detection, so a Tailwind
        // build pays nothing for a map it will never read.
        isSourceExtractingProvider ? walkedSources : undefined,
        // Under AUTO the scan owns the unadmitted-package report (it knows the
        // derived set and the manifest-less owners directly); the walk-based
        // report is the manual-mode boundary.
        ctx.phase1.packageAdmissionMode ?? 'auto',
        // The tags the server function component lane routes nested hosts
        // through `__ssr` with: the admission plan's renderable islands plus
        // the static compiled components — the union the SSR registry carries.
        serverComponentAdmissionTags(
          ctx.phase1.staticComponents,
          ctx.phase1.ssrAdmissionPlan?.renderableTags,
        ),
      ),
      // The engine's sheet half: it sits AFTER the discovery pass, so its
      // `buildStart` compile reads the candidates that pass registered — never
      // gated on a pre-build candidate count, which is exactly what the
      // aliased-reachability defect made wrong: the sheet emits when this build
      // DISCOVERED candidates (a candidate-less build emits nothing). Absent
      // (not inert) when no plan exists, so an unselected engine is never
      // imported.
      ...styleSheetPlugins,
      // The compiler is part of the official client build path. The outer
      // open:core hook covers normal Vite transforms; this inline build owns
      // its own plugin list and must use the same transform exactly once.
      // Island modules carry the island delivery policy statement; the
      // compiler admits it only through the injected descriptor (the router
      // build is the only host that can produce island modules).
      compiledElementPlugin({
        // Linked workspace packages sit outside the project root; without the
        // workspace anchor their absolute ids would land in the source maps.
        workspaceRoot: findBuildWorkspaceRoot(root) ?? undefined,
        staticSidecars: [ISLAND_ADMISSION],
        // This build's own class-candidate registry (defect C): the transform's
        // write path and the discovery pass share exactly this instance, and no
        // other build's facts can reach it.
        candidates: shadowCandidateRegistry,
        // The server function component lane (alpha15): route modules whose
        // class-lane compile declines compile into `__h`/`__t`/`__ssr`
        // constructors through the same transform — the client build must
        // lower them exactly as the dev and SSG hosts do, or the route
        // module would ship authored JSX.
        resolveServerComponentModule: createServerComponentSourceResolver({
          root,
          workspaceRoot: findBuildWorkspaceRoot(root) ?? undefined,
        }),
        // The union the entry's SSR registry carries (renderable islands plus
        // static compiled components): a function page's nested host rides
        // `__ssr` under exactly the tags the render can expand.
        compiledTags: serverComponentAdmissionTags(
          ctx.phase1.staticComponents,
          ctx.phase1.ssrAdmissionPlan?.renderableTags,
        ),
      }),
      // intercepts the compiled modules' authored `.css` imports before
      // vite's CSS plugin, emits the real `.css` assets, and hands the sheet
      // adapters back to the module graph.
      styleAssetEmission,
      {
        name: 'open:exclude-preact-rts',
        resolveId(id: string) {
          if (id === 'preact-render-to-string') {
            return '\0empty-preact-rts';
          }
          return null;
        },
        load(id: string) {
          if (id === '\0empty-preact-rts') {
            return 'export const renderToString = () => { throw new Error("preact-render-to-string is not available in browser"); };';
          }
          return null;
        },
      },
      {
        name: 'open:virtual-client-entry',
        resolveId(id) {
          if (id === VIRTUAL_CLIENT_ENTRY_ID) return RESOLVED_CLIENT_ENTRY_ID;
          // #868: the client runtimes resolve to their real source modules,
          // so they typecheck, bundle and minify like any other module.
          if (id === VIRTUAL_RUNTIME_SPECIFIERS.scheduler) {
            return runtimeModulePath('./ssg/island-scheduler.ts');
          }
          if (id === VIRTUAL_RUNTIME_SPECIFIERS.enhance) {
            return runtimeModulePath('./ssg/enhance-client.ts');
          }
          // B2: the generated entry reaches the element-services surface
          // through a stable virtual id (so the emitted entry text is
          // machine-independent); the selector and its one resolution rule
          // live together in entry-client-codegen.ts.
          const elementServices = resolveElementServicesRuntimeModule(id);
          if (elementServices !== null) return elementServices;
          return null;
        },
        load(id) {
          if (id === RESOLVED_CLIENT_ENTRY_ID) return buildClientEntryCode();
        },
      },
      {
        name: 'open:island-identity-resolution',
        buildStart: {
          async handler() {
            // Resolve each admitted island's declared specifier once, through
            // this build's own resolver — the same plugin container, alias
            // table and node_modules layout the generated client entry's
            // dynamic imports go through (the virtual entry module is the
            // importer, exactly as for the entry's own imports). The result
            // is the island identity the chunk grouping and the asset
            // manifest join consume; no other mechanism resolves island
            // specifiers.
            for (const specifier of declaredIslandSpecifiers) {
              const resolved = await this.resolve(specifier, RESOLVED_CLIENT_ENTRY_ID);
              if (!resolved) {
                this.error(
                  `Admitted island "${specifier}" does not resolve in the client build ` +
                    `(importer: ${VIRTUAL_CLIENT_ENTRY_ID}) — an island must resolve to a real ` +
                    `module, not stay a bare declaration`,
                );
              }
              islandModuleIds.set(specifier, resolved.id);
            }
            // #1544: anchor the shared element-runtime chunk's identity the
            // same way — through this build's own resolver, from the virtual
            // entry the generated code imports the runtime through. The
            // specifier resolves under both renderers (lit carries element
            // modules transitively via the router client runtime), so the
            // identity — and the group — are set for lit builds too. The
            // element-free lit entry (#1339) changes only the failure
            // posture: native builds statically import the runtime, so an
            // unresolvable specifier (or a package layout the root walk
            // cannot anchor) fails here instead of letting chunk grouping
            // guess, while lit tolerates it with the identity left null
            // rather than failing a build that requires no runtime.
            const runtimeResolved = await this.resolve(
              ELEMENT_RUNTIME_ENTRY_SPECIFIER,
              RESOLVED_CLIENT_ENTRY_ID,
            );
            if (runtimeResolved) {
              elementRuntimeIdentity = resolveElementRuntimeIdentity(runtimeResolved.id);
            } else if (ctx.options.renderer !== 'lit') {
              this.error(
                `The element runtime "${ELEMENT_RUNTIME_ENTRY_SPECIFIER}" does not resolve in the ` +
                  `client build (importer: ${VIRTUAL_CLIENT_ENTRY_ID}) — the generated entry ` +
                  `statically imports it, so the shared element-runtime chunk cannot be grouped`,
              );
            }
          },
        },
      },
    ],
  };

  try {
    const outputs = await viteBuild(clientConfig);
    log.info('Client bundle built -> ' + clientOutDir);

    // #1544, fail closed: a native build's entry statically imports the
    // element runtime, so the emitted graph must group runtime modules into
    // the shared chunk — zero matches is a structural failure (per-island
    // runtime copies would ship silently), not a degraded chunk layout. Lit
    // builds are element-free by design (#1339) and skip the guard; an
    // island-free entry (style-only / CSS-only, S-C2/S-12 and defect D) imports
    // the document stylesheet and nothing else, so there is no runtime to
    // group — the requirement is the generated entry's own fact, never a
    // property of the emission shape.
    if (ctx.options.renderer !== 'lit' && entryNeedsElementRuntime) {
      requireElementRuntimeChunk(collectClientBuildChunks(outputs), elementRuntimeIdentity);
    }

    // B2 gap (a), fail closed, both halves:
    //
    //  1. Vite's injected preload helper modules, when the graph carries any,
    //     must be homed in the one dedicated `vite-helper` chunk. Anywhere
    //     else — in practice a lazily-loaded island chunk — is the layout that
    //     gives the entry a static edge to that island.
    //  2. The property itself: the emitted entry must not STATICALLY reach the
    //     shared element-runtime chunk. This is the one that survives Vite
    //     renaming its helper id: guard 1 would then match nothing and pass
    //     vacuously, while guard 2 still fails the build the moment the
    //     runtime reappears in the entry's static closure.
    //
    // Guard 2 runs under the native renderer only, matching
    // requireElementRuntimeChunk's posture and for the same reason: lit's
    // entry is element-free by design (#1339) but element modules reach a lit
    // graph transitively through the router client runtime, so a lit entry may
    // legitimately reach the shared chunk — the B2 promise is the native
    // entry's, and www is the acceptance case.
    if (ctx.options.renderer !== 'lit') {
      const emittedChunks = collectClientBuildChunks(outputs);
      requireViteHelperChunk(emittedChunks);
      if (entryNeedsElementRuntime) {
        requireEntryStaticGraphFreeOfRuntime(emittedChunks, elementRuntimeIdentity);
      }
    }

    // #1471: the client asset manifest — compile-time island identity joined
    // with the build manifest and Rollup module metadata (never output file
    // names). Stored on ctx so closeBundle's post-processing and the
    // request-time artifact consume the same record. The island identities
    // travel with it: the map this build's identity pass resolved — declared
    // specifier to actual module id — is what the manifest joins on, and a
    // resolved id the emitted module graph does not carry fails the build.
    // Fails closed: a missing/corrupted manifest, a missing client entry, or
    // an island that cannot be attributed to exactly one emitted module fails
    // Phase 2.
    ctx.clientAssetManifest = await createClientAssetManifest({
      root,
      base: clientBase,
      islands: clientAssetIslands,
      manifestPath: join(clientOutDir, '.vite', 'manifest.json'),
      buildResult: outputs,
      resolvedIslandModuleIds: islandModuleIds,
      styleFileNames: [...styleAssetRecords.values()].map((record) => record.fileName),
    });

    // The document stylesheet (S lane): the client entry chunk's emitted CSS
    // files, read from the same manifest the asset manifest consumes — or, for
    // an engine that generates its own sheet, the asset this build emitted
    // directly. Fail closed either way: a declared entry that emitted no
    // stylesheet would ship pages styled by nothing, silently.
    if (stylePlan && styleIntegration) {
      if (styleIntegration.provider.documentDelivery === 'generated') {
        const fileName = styleIntegration.documentRecord?.fileName;
        if (fileName === undefined) {
          throw buildError(
            ClientAssetErrorCode.STYLESHEET_MISSING,
            `The ${stylePlan.provider} style entry is enabled but the client build emitted no ` +
              'document stylesheet — the engine compiled no CSS for the declared sources, ' +
              'candidates or preflight layers. A missing document sheet is a build defect, ' +
              'never a silently unstyled page.',
          );
        }
        ctx.clientStyleAssets = [fileName];
      } else {
        const manifestPath = join(clientOutDir, '.vite', 'manifest.json');
        const viteManifest = await readViteClientManifest(manifestPath);
        ctx.clientStyleAssets = findClientEntryStyles(viteManifest, manifestPath);
        if (ctx.clientStyleAssets.length === 0) {
          throw buildError(
            ClientAssetErrorCode.STYLESHEET_MISSING,
            `The ${stylePlan.provider} style entry is enabled but the client build emitted no ` +
              `document stylesheet (manifest: ${manifestPath}) — the generated entry imports ` +
              `${styleIntegration.provider.documentSheetModule}, so a missing CSS asset is a ` +
              'build defect, never a silently unstyled page',
          );
        }
      }
      log.info(
        `${stylePlan.provider} document stylesheet emitted: ${ctx.clientStyleAssets.join(', ')}`,
      );
    }

    // The authored sheets' emitted files (S5-C): the SSR adapter declares each
    // as an external resource instead of inlining the bytes.
    ctx.clientStyleAssetFiles = new Map(
      [...styleAssetRecords.entries()].map(([key, record]) => [key, record.fileName]),
    );

    // The component stylesheet (alpha15 S lane): a discovered shadow-candidate
    // set whose entry emitted no CSS would ship unstyled shadow components —
    // fail closed instead. The candidates are THIS build's own discovered facts
    // (defect C: no other build's registry is consulted).
    const discoveredSheetCandidates = componentSheetCandidates();
    if (discoveredSheetCandidates.length > 0) {
      const componentSheetFile = styleIntegration?.componentRecord.fileName;
      if (componentSheetFile === undefined) {
        throw buildError(
          ClientAssetErrorCode.STYLESHEET_MISSING,
          'The compiler admitted class candidates but the client build emitted no ' +
            `component stylesheet — the ${stylePlan?.provider ?? 'style'} compile produced no ` +
            'CSS for the entry',
        );
      }
      ctx.componentStyleSheet = { fileName: componentSheetFile };
      log.info(
        `${stylePlan?.provider ?? 'style'} component stylesheet emitted: ${componentSheetFile} ` +
          `(${discoveredSheetCandidates.length} admitted class candidate(s))`,
      );
    }

    const { printBuildManifest } = await import('../vite/build-manifest.ts');
    printBuildManifest({ root, outDir, phase: 2, budget: ctx.phase3.manifestBudget });

    // S-C2/S-12 (and defect D): an island-free entry emitted no client bundle
    // worth shipping — its generated entry was the placeholder that imports the
    // document stylesheet only. Drop the JS half so the zero-client-JS contract
    // holds exactly as it does on the shortcut paths; every emitted style asset
    // stays (that is the whole point of the pass — including the Tailwind
    // document sheet and the shadow components' sheet), and nothing references
    // the removed files (no island entry exists to be script-tagged).
    if (styleOnlyEmission) {
      await rm(join(clientOutDir, 'islands'), { recursive: true, force: true }).catch(() => {});
      // Every style resource this build emitted, not just the authored `.css`
      // edges: an app whose only styles are the Tailwind entries must keep them
      // (the check below decides whether the app owns any style at all).
      const emittedStyleResources =
        styleAssetRecords.size +
        (ctx.clientStyleAssets?.length ?? 0) +
        (ctx.componentStyleSheet === null ? 0 : 1);
      if (emittedStyleResources === 0) {
        // No sheet on any server-rendered root either: this app is the pinned
        // zero-JS shape after all, so leave no trace.
        await removeClientDeliveryArtifacts(root, outDir);
        log.info('No server-rendered style edges - zero client JS output');
      } else {
        log.info(
          `Style-only emission complete: ${emittedStyleResources} style asset(s), zero client JS`,
        );
      }
      // No client deliverable exists, so no client asset manifest is handed
      // back — exactly as the shortcut paths behave. Phase 3's script-tag and
      // island-manifest passes key off the manifest, and this app has neither.
      return null;
    }
  } catch (error) {
    log.error(`Client build failed: ${formatError(error)}`);
    throw error;
  }

  return ctx.clientAssetManifest;
}

export { buildClient };
