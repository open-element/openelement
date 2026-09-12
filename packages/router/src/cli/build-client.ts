/**
 * @openelement/router - CLI: Client Island Build
 *
 * Client build for Island components.
 * Produces dist/client/islands/*.js + manifest for SSG post-processing.
 *
 * ADR 0011: This module exports buildClient() only - it is called from
 * closeBundle() in open:build plugin. No longer a standalone CLI entry.
 * ctx parameter is required (no globalThis fallback).
 *
 * Usage:
 *   deno task build  (unified entry - runs all 3 phases)
 */

import { build as viteBuild, type InlineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { extractCustomElementTags, generateClientEntry } from '../vite/internal/ssg/index.ts';
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
import { createNpmSpecifierPlugin } from '../vite/npm-specifier-plugin.ts';
import { analyzeModuleSemantics, compiledElementPlugin } from '@openelement/element/compiler';
import { compilerBehaviorDeclarations } from '../vite/internal/ssg/client-admission.ts';
import { parseJsonc } from '../vite/internal/jsonc.ts';
import { sortAliasEntries } from '../vite/alias-utils.ts';
import { formatError } from '@openelement/element';
import { createLogger } from '@openelement/element';
import { normalizeSeparators } from '@openelement/element/build-utils';
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

const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function sourceCandidates(base: string): string[] {
  const withoutExtension = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(base)
    ? base.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/, '')
    : base;
  const stems = withoutExtension === base ? [base] : [base, withoutExtension];
  return [
    ...new Set(stems.flatMap((stem) => [
      stem,
      ...SOURCE_EXTENSIONS.slice(1).map((extension) => `${stem}${extension}`),
      ...SOURCE_EXTENSIONS.slice(1).map((extension) => join(stem, `index${extension}`)),
    ])),
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
      const semantics = analyzeModuleSemantics(source, filePath);
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
    const semantics = analyzeModuleSemantics(source, normalizedPath);
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

  const shellConfigs = [
    ctx.phase3.appShell,
    ...Object.values(ctx.phase3.layouts ?? {}),
  ];
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
  await rm(resolve(root, outDir, 'client'), { recursive: true, force: true });
  await rm(resolve(root, outDir, 'island-manifests'), { recursive: true, force: true });
}

// #868: the browser runtimes are real modules bundled through virtual
// specifiers. Development resolves the TypeScript source; `deno pack` removes
// raw TypeScript payloads, so an installed tarball must instead resolve the
// staged JavaScript counterpart.
function runtimeModulePath(relativeSource: string): string {
  const sourcePath = fileURLToPath(new URL(relativeSource, import.meta.url));
  if (existsSync(sourcePath)) return sourcePath;
  return sourcePath.replace(/\.(?:[cm]?ts|tsx)$/, '.js');
}

type ViteBuildOptionsWithManifest = NonNullable<InlineConfig['build']> & {
  manifest?: boolean;
};

type ViteInlineConfigWithManifest = Omit<InlineConfig, 'build'> & {
  build?: ViteBuildOptionsWithManifest;
};

/** Workspace root derived from this module's location (packages/router/src/cli/).
 * Only valid in the local monorepo layout. In npm/JSR consumers, returns null. */
const WORKSPACE_ROOT: string | null = (() => {
  if (!import.meta.url.startsWith('file:')) return null;
  try {
    const root = normalizeSeparators(fileURLToPath(new URL('../../../..', import.meta.url)));
    if (!existsSync(join(root, 'packages', 'element', 'deno.json'))) return null;
    return root;
  } catch (e) {
    log.warn('Unable to resolve workspace root, falling back to null', e);
    return null;
  }
})();

/**
 * Look up a bare specifier in a deno.json import map.
 * Walks up directory tree to find workspace-level deno.json as fallback.
 * Returns { target, denoJsonDir } so relative paths can be resolved correctly.
 */
function lookupInDenoJson(
  id: string,
  root: string,
): { target: string; denoJsonDir: string } | null {
  const denoJsonDirs = new Set<string>();
  let dir = resolve(root);

  // Walk up from consumer root
  while (!denoJsonDirs.has(dir)) {
    denoJsonDirs.add(dir);
    const found = tryDenoJsonDir(id, dir);
    if (found) return found;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  // Also try workspace root (module-relative, for monorepo dev / testing)
  if (WORKSPACE_ROOT && !denoJsonDirs.has(WORKSPACE_ROOT)) {
    const found = tryDenoJsonDir(id, WORKSPACE_ROOT);
    if (found) return found;
  }

  return null;
}

/** Check a single directory for a deno.json with the given import. */
function tryDenoJsonDir(
  id: string,
  dir: string,
): { target: string; denoJsonDir: string } | null {
  const denoJsonPath = join(dir, 'deno.json');
  if (!existsSync(denoJsonPath)) return null;
  const raw = readFileSync(denoJsonPath, 'utf-8');
  // #708: shared JSONC parser (single implementation with workspace-alias.ts).
  // Handles mid-line // comments, /* */ blocks, string literals, and trailing commas.
  const denoJson = parseJsonc(raw);
  if (!denoJson) {
    log.warn('Invalid deno.json JSON, skipping');
    return null; // Invalid JSON — skip this deno.json
  }
  const imports = denoJson.imports as Record<string, string> | undefined;
  if (!imports) return null;
  // Exact match
  if (imports[id]) return { target: imports[id], denoJsonDir: dir };
  // Prefix/subpath matching (trailing slash)
  for (const [key, value] of Object.entries(imports)) {
    if (key.endsWith('/') && id.startsWith(key)) {
      return { target: value + id.slice(key.length), denoJsonDir: dir };
    }
  }
  return null;
}

/**
 * Convert a Deno import map target to a resolvable Vite path.
 * - file:// URLs → absolute filesystem path
 * - Relative paths (./) → resolved relative to denoJsonDir
 * - npm:, jsr: → null (handled by node_modules)
 */
function convertImportMapTarget(target: string, denoJsonDir: string): string | null {
  if (target.startsWith('file://')) {
    try {
      return normalizeSeparators(fileURLToPath(target));
    } catch (e) {
      log.warn('Unable to convert file:// import-map target, skipping', e);
      return null;
    }
  }
  // Relative path — resolve relative to the deno.json directory
  if (target.startsWith('./') || target.startsWith('../')) {
    return normalizeSeparators(resolve(denoJsonDir, target));
  }
  // npm:, jsr: — let Vite/Rolldown handle these normally
  return null;
}

async function buildClient(ctx: OpenElementBuildContext): Promise<void> {
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
      ? (Array.isArray(resolveAlias)
        ? resolveAlias.map((a) => ({
          find: a.find,
          replacement: a.replacement,
        }))
        : Object.entries(resolveAlias).map(([find, replacement]) => ({ find, replacement })))
      : [],
  );

  // #569: an island-free app with data-open-enhance forms still needs the
  // client entry — it carries the form-enhancement layer.
  const enhancedForms = (ctx.phase1.cachedRoutes ?? []).some((route) =>
    route.type === 'page' && route.hasEnhancedForms === true
  );

  if (
    localIslands.length === 0 && packageIslandDecls.length === 0 &&
    compilerBehaviorDecls.length === 0 && !enhancedForms
  ) {
    await removeClientDeliveryArtifacts(root, outDir);
    log.info('No islands found - zero client JS output');
    return;
  }

  const localDeliveryTags = localIslands.flatMap((tagName) =>
    deliveryTagsForLocal(
      tagName,
      ctx.phase1.islandMeta[tagName] as Partial<DeliveryIslandRecord> | undefined,
    )
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
      ).some((deliveredTag) => reachableTags.has(deliveredTag))
    );
  const selectedLocalTags = selectedLocal.map(({ tagName }) => tagName);
  const selectedLocalFiles = selectedLocal.map(({ tagName, index }) =>
    localIslandFiles[index] || `${tagName}.ts`
  );
  const selectedPackageDecls = packageIslandDecls.filter((island) =>
    deliveryTagsForPackage(island).some((deliveredTag) => reachableTags.has(deliveredTag))
  );
  const selectedCompilerBehaviorDecls = compilerBehaviorDecls.filter((island) =>
    deliveryTagsForPackage(island).some((deliveredTag) => reachableTags.has(deliveredTag))
  );

  // Keep the post-processor and manifest inputs in lockstep with the exact
  // client entry. This also makes an unused declaration disappear from the
  // generated per-page manifests instead of leaving a false chunk reference.
  ctx.phase1.islandTagNames = selectedLocalTags;
  ctx.phase1.islandFiles = selectedLocalFiles;
  ctx.phase1.packageIslandDecls = selectedPackageDecls;
  ctx.phase1.compilerBehaviorDecls = selectedCompilerBehaviorDecls;

  if (
    selectedLocalTags.length === 0 && selectedPackageDecls.length === 0 &&
    selectedCompilerBehaviorDecls.length === 0 && !enhancedForms
  ) {
    await removeClientDeliveryArtifacts(root, outDir);
    log.info('No admitted reachable islands - zero client JS output');
    return;
  }

  const totalIslands = selectedLocalTags.length + selectedCompilerBehaviorDecls.length +
    selectedPackageDecls.length;
  log.info(
    `Building client bundle for ${totalIslands} island(s)` +
      (enhancedForms ? ' + data-open-enhance form enhancement' : '') + '...',
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
    // ADR-0057: JSX automatic runtime must be configured in the internal
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
        output: ctx.options.renderer === 'lit'
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
                    for (const island of selectedPackageDecls) {
                      if (id.includes(island.modulePath)) return `island-${island.tagName}`;
                    }
                    return undefined;
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
                // Extensions mirror resolve.extensions below and scanIslands
                // (ts/tsx/js/jsx). Previously missing tsx/jsx meant .tsx
                // islands skipped manualChunks and lost the `island-` prefix.
                const match = id.match(/\/([^/]+)\.(ts|tsx|js|jsx)$/);
                if (match) return `island-${match[1]}`;
              }
              for (const island of selectedPackageDecls) {
                if (id.includes(island.modulePath)) return `island-${island.tagName}`;
              }
            },
          },
      },
    },
    resolve: {
      ...(serializedAlias.length > 0 ? { alias: serializedAlias } : {}),
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
      compiledElementPlugin(),
      createNpmSpecifierPlugin(),
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
            return runtimeModulePath('../vite/internal/ssg/island-scheduler.ts');
          }
          if (id === VIRTUAL_RUNTIME_SPECIFIERS.enhance) {
            return runtimeModulePath('../vite/internal/ssg/enhance-client.ts');
          }
          return null;
        },
        load(id) {
          if (id === RESOLVED_CLIENT_ENTRY_ID) return clientEntryCode;
        },
      },
      {
        name: 'open:deno-import-map-resolve',
        enforce: 'pre',
        async resolveId(id, importer) {
          // Only handle bare specifiers (no relative imports, no absolute paths)
          if (id.startsWith('.') || id.startsWith('/') || id.startsWith('file:')) {
            return null;
          }

          // Try deno.json import map — walks up from root to find
          // workspace-level deno.json as fallback for monorepo dev.
          const result = lookupInDenoJson(id, root);
          if (!result) return null;

          // Only handle file:// and relative targets (workspace-local dev mappings).
          // npm:, jsr: → return null, let node_modules handle them.
          const resolved = convertImportMapTarget(result.target, result.denoJsonDir);
          if (!resolved) return null;

          return await this.resolve(resolved, importer, { skipSelf: true });
        },
      },
    ],
  };

  try {
    await viteBuild(clientConfig);
    log.info('Client bundle built -> ' + clientOutDir);

    const { printBuildManifest } = await import('../vite/build-manifest.ts');
    printBuildManifest({ root, outDir, phase: 2, budget: ctx.phase3.manifestBudget });
  } catch (error) {
    log.error(`Client build failed: ${formatError(error)}`);
    throw error;
  }
}

export { buildClient };
