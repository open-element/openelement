/**
 * @openelement/router - CLI: Client Island Build
 *
 * Client build for Island components.
 * Produces dist/client/islands/*.js + manifest for SSG post-processing, and
 * the client asset manifest (#1471) — compile-time island identity joined
 * with the build manifest and Rollup module metadata.
 *
 * Library module: exports buildClient(), invoked from closeBundle() in the
 * open:build plugin (the `pnpm build` task of a generated project runs the
 * unified multi-phase build). ctx parameter is required (no globalThis
 * fallback).
 */

import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import process from 'node:process';
import { build as viteBuild, type InlineConfig } from 'vite';
import { dirname, isAbsolute, join, relative, resolve } from 'pathe';
import { extractCustomElementTags, generateClientEntry } from '../vite/internal/ssg/index.ts';
import { runtimeModulePath } from '../vite/internal/runtime-module-path.ts';
import { findBuildWorkspaceRoot } from '../vite/workspace-alias.ts';
import { buildClientIslandEntries } from '../vite/internal/ssg/client-island-entries.ts';
import {
  type ClientIslandDeliveryEntry,
  type IslandDeliveryMeta,
  resolveIslandDeliveryTags,
} from '../vite/internal/ssg/delivery.ts';
import { walkHtmlFileEntries } from '../vite/internal/html-files.ts';
import { VIRTUAL_RUNTIME_SPECIFIERS } from '../vite/internal/ssg/entry-generators.ts';
import type { OpenElementBuildContext } from '../vite/build-context.ts';
import type { IslandDecl } from '../vite/internal/protocol/ssg.ts';
import type { ClientAssetManifest } from '../vite/internal/protocol/client-assets.ts';
import {
  type ClientAssetIslandInput,
  createClientAssetManifest,
  packageIslandChunkName,
} from '../vite/client-asset-manifest.ts';
import { analyzeModuleSemantics, compiledElementPlugin } from '@openelement/element/compiler';
import { ISLAND_ADMISSION } from '../vite/internal/protocol/island-admission.ts';
import { ROUTER_MODULE_VOCABULARY } from '../vite/internal/protocol/module-vocabulary.ts';
import { compilerBehaviorDeclarations } from '../vite/internal/ssg/client-admission.ts';
import { sortAliasEntries } from '../vite/alias-utils.ts';
import { formatError } from '@openelement/element';
import { createLogger } from '@openelement/element';
import { buildError, ClientBuildErrorCode } from '../internal/error-codes.ts';
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
export function findReachableIslandTags(
  ctx: OpenElementBuildContext,
  root: string,
  outDir: string,
  candidates: string[],
): Set<string> {
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

  const shellConfigs = [ctx.phase3.appShell, ...Object.values(ctx.phase3.layouts ?? {})];
  for (const shell of shellConfigs) {
    if (!shell || typeof shell !== 'object') continue;
    const shellFile = resolveConfiguredSource(root, shell.import);
    if (shellFile) recordSourceFile(shellFile);
  }

  // A project without route metadata can still call buildClient() directly
  // (used by adapter integrations). In that case preserve admitted entries;
  // normal app builds always have HTML or route sources to establish reachability.
  if ((ctx.phase1.cachedRoutes ?? []).length === 0 && reachable.size === 0) {
    return new Set(allowed);
  }
  return reachable;
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

  if (
    localIslands.length === 0 &&
    packageIslandDecls.length === 0 &&
    compilerBehaviorDecls.length === 0 &&
    !enhancedForms
  ) {
    await removeClientDeliveryArtifacts(root, outDir);
    log.info('No islands found - zero client JS output');
    return null;
  }

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
  const reachableTags = findReachableIslandTags(ctx, root, outDir, candidateTags);
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

  if (
    selectedLocalTags.length === 0 &&
    selectedPackageDecls.length === 0 &&
    selectedCompilerBehaviorDecls.length === 0 &&
    !enhancedForms
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

  const clientEntryCode = generateClientEntry(islandEntries, {
    enhancedForms,
    renderer: ctx.options.renderer,
  });

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
  const clientConfig: ViteInlineConfigWithManifest = {
    configFile: false,
    root,
    base: `${clientBase}client/`,
    logLevel: 'warn',
    // JSX automatic runtime must be configured in the internal
    // viteBuild() call — configFile:false means user's vite.config.ts is
    // NOT read. Without this, esbuild defaults to classic React.createElement
    // transform, producing {type, props, $$typeof} objects that OpenElement
    // does not recognize (causes [object Object] rendering).
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: '@openelement/element',
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
                      name: 'preact',
                      test: /node_modules\/preact|\/preact\//,
                      priority: 10,
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
                manualChunks(id: string) {
                  // Force preact + preact/hooks into a single chunk so the shared
                  // options object is not duplicated across chunks (which breaks hooks).
                  if (id.includes('node_modules/preact') || id.includes('/preact/')) {
                    return 'preact';
                  }
                  if (id.includes(`/${islandsDir}/`)) {
                    // Extension list contract: mirrors resolve.extensions below
                    // and scanIslands (ts/tsx/js/jsx), so every island module id
                    // matches and gets the `island-` prefix.
                    const match = id.match(/\/([^/]+)\.(ts|tsx|js|jsx)$/);
                    if (match) return `island-${match[1]}`;
                  }
                  // #1471: package islands group by the actual module id the
                  // asset manifest joins on — zero matches and ambiguous
                  // matches fail the build, never a substring first-hit.
                  return packageIslandChunkName(id, packageDeclIdentities());
                },
              },
      },
    },
    resolve: {
      ...(serializedAlias.length > 0 ? { alias: serializedAlias } : {}),
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
      // The compiler is part of the official client build path. The outer
      // open:core hook covers normal Vite transforms; this inline build owns
      // its own plugin list and must use the same transform exactly once.
      compiledElementPlugin({
        // Linked workspace packages sit outside the project root; without the
        // workspace anchor their absolute ids would land in the source maps.
        workspaceRoot: findBuildWorkspaceRoot(root) ?? undefined,
        // Island modules carry the island delivery policy statement; the
        // compiler admits it only through the injected descriptor.
        staticSidecars: [ISLAND_ADMISSION],
      }),
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
          return null;
        },
        load(id) {
          if (id === RESOLVED_CLIENT_ENTRY_ID) return clientEntryCode;
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
          },
        },
      },
    ],
  };

  try {
    const outputs = await viteBuild(clientConfig);
    log.info('Client bundle built -> ' + clientOutDir);

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
    });

    const { printBuildManifest } = await import('../vite/build-manifest.ts');
    printBuildManifest({ root, outDir, phase: 2, budget: ctx.phase3.manifestBudget });
  } catch (error) {
    log.error(`Client build failed: ${formatError(error)}`);
    throw error;
  }

  return ctx.clientAssetManifest;
}

export { buildClient };
