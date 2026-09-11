/**
 * Extracted from index.ts in v0.22 (SOP-004: build tooling decomposition).
 *
 * This is the core build plugin implementation. It is NOT part of the
 * public API. Use `openPipeline()` from the main entry instead.
 *
 * Internal only: called by openPipeline() and the @openelement/router umbrella.
 */

import type { Alias, Plugin, ViteDevServer } from 'vite';
import type {
  FrameworkOptions,
  OpenElementPackageManifest,
  RouteEntry,
} from './internal/protocol/framework.ts';
import type { SsgBehaviorOptions } from './internal/protocol/ssg.ts';
import type { IslandDecl } from './internal/protocol/ssg.ts';

import { join, relative, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { formatError, OpenElementError } from '@openelement/element';
import { createLogger } from '@openelement/element';

const log = createLogger('router-vite');

import { lazyHonoDevServer } from './dev-server.ts';
import { OpenElementBuildContext } from './build-context.ts';
import { findWorkspaceRoot, generateWorkspaceAliases } from './workspace-alias.ts';
import { normalizeViteAliases } from './alias-utils.ts';
import { buildPlugin } from './build.ts';
import type { EntryDescriptor } from './internal/ssg/index.ts';
import {
  buildEntryDescriptor,
  generateCustomElementsPolyfill,
  renderEntry,
} from './internal/ssg/index.ts';
import { buildHeadExtras } from './head-injection.ts';
import {
  buildCriticalHeadExtras,
  minifyCriticalStyleBlocks,
} from './internal/ssg/critical-assets.ts';
import { islandTransformPlugin } from './island-transform.ts';
import { compileElementModule, stripInlineSourceMapComment } from '@openelement/element/compiler';
import { devIslandClientPlugin, RESOLVED_CLIENT_ENTRY_ID } from './dev-island-client.ts';
import {
  detectAndClassifyCemPackages,
  fileToTagName,
  scanForeignTags,
  scanIslandMeta,
  scanIslands,
  scanPackageManifests,
  scanRoutes,
  scanStaticComponents,
} from './internal/ssg/index.ts';
import { buildPackageIslandDecls } from './internal/ssg/island-scanner.ts';
import { resolveIslandDeliveryTags } from './internal/ssg/delivery.ts';
import { mdxPlugin } from './plugin-mdx.ts';
import {
  CHUNK_SIZE_WARNING_LIMIT_KB,
  DEFAULT_COMPONENTS_DIR,
  DEFAULT_ISLANDS_DIR,
  DEFAULT_ROUTES_DIR,
} from './internal/paths.ts';

type AliasOptionsInput = Record<string, string> | Alias[] | null | undefined;

function mergeAliasOptions(
  primary: AliasOptionsInput,
  fallback: AliasOptionsInput,
): Record<string, string> | Alias[] | null {
  if (!primary) return fallback ?? null;
  if (!fallback) return primary;

  const merged: Alias[] = [];
  const append = (aliases: AliasOptionsInput): void => {
    if (!aliases) return;
    if (Array.isArray(aliases)) {
      merged.push(...aliases);
      return;
    }
    for (const [find, replacement] of Object.entries(aliases)) {
      merged.push({ find, replacement });
    }
  };

  append(primary);
  append(fallback);
  return merged;
}

/**
 * This is the core build plugin implementation. It is NOT part of the
 * public API. Use `openPipeline()` from @openelement/router instead.
 *
 * Internal only: called by openPipeline() and the @openelement/router umbrella.
 * Jamstack: M=SSG+DSD, A=API Routes, J=Islands.
 *
 * @param options - Framework options
 * @param externalCtx - Optional shared OpenElementBuildContext (used by openElement() umbrella)
 * @internal
 */
export function createOpenPlugin(
  options: FrameworkOptions & { ssg?: SsgBehaviorOptions } = {},
  externalCtx?: OpenElementBuildContext,
): Plugin[] {
  // Build the validated legacy head channel, then prepend the opt-in alpha.4
  // critical-assets channel. Both become one immutable document artifact; no
  // runtime renderer or client fallback is introduced by the convention.
  const legacyHead = buildHeadExtras(options);
  const criticalHead = buildCriticalHeadExtras(options);
  const headExtrasParts = [
    criticalHead.headExtras,
    legacyHead.headExtras ? minifyCriticalStyleBlocks(legacyHead.headExtras) : undefined,
  ].filter((part): part is string => Boolean(part));
  const headExtras = headExtrasParts.length > 0 ? headExtrasParts.join('\n  ') : undefined;
  const allowHeadExtrasScripts = legacyHead.allowHeadExtrasScripts ||
    criticalHead.allowHeadExtrasScripts;

  const resolvedOptions: FrameworkOptions & {
    allowHeadExtrasScripts?: boolean;
    ssg?: SsgBehaviorOptions;
  } = {
    ...options,
    routesDir: options.routesDir || DEFAULT_ROUTES_DIR,
    islandsDir: options.islandsDir || DEFAULT_ISLANDS_DIR,
    componentsDir: options.componentsDir || DEFAULT_COMPONENTS_DIR,
    headExtras,
    allowHeadExtrasScripts,
  };

  const ctx = externalCtx || new OpenElementBuildContext(resolvedOptions);
  // Per-plugin-instance compiler state only. It is used to distinguish a
  // compatible behavior edit from a Part Program shape edit during HMR; no
  // module-global cache can leak a program between Vite builds. The shape
  // excludes the program sourceMap: source offsets shift on ANY edit
  // (including behavior-only method-body edits), so comparing them would
  // force a full reload for every keystroke instead of only for
  // template/Part/Region shape changes.
  const compiledProgramShapes = new Map<string, string>();
  const programShape = (program: unknown): string => {
    const { sourceMap: _sourceMap, ...shape } = program as Record<string, unknown>;
    return JSON.stringify(shape);
  };

  // Pre-generate workspace aliases (sync, once, cached in ctx).
  // Phase 1 config, Phase 2 client build, and Phase 3 SSG build
  // all read ctx.phase1.userResolveAlias - zero redundant generation.
  try {
    const wsRoot = findWorkspaceRoot(process.cwd());
    if (wsRoot) {
      ctx.phase1.userResolveAlias = generateWorkspaceAliases(wsRoot);
      log.info(
        `Auto-generated ${
          (ctx.phase1.userResolveAlias as Array<unknown>).length
        } resolve alias(es) from workspace`,
      );
    }
  } catch (e) {
    log.debug('Workspace not available - aliases stay null', e);
  }

  const VIRTUAL_ENTRY_ID = 'virtual:open-hono-entry';
  const RESOLVED_ENTRY_ID = '\0' + VIRTUAL_ENTRY_ID;
  const VIRTUAL_BUILD_TRIGGER_ID = 'virtual:open-build-trigger';
  const RESOLVED_BUILD_TRIGGER_ID = '\0' + VIRTUAL_BUILD_TRIGGER_ID;
  // Dev SSR polyfill (ADR-0044): route modules call customElements.define()
  // at module top level, so the dev SSR entry imports the polyfill as its
  // first module — ESM evaluates it before every other import. The build
  // path ships the same stub as the Rollup banner (build-ssg.ts).
  const VIRTUAL_POLYFILL_ID = 'virtual:open-ssr-polyfill';
  const RESOLVED_POLYFILL_ID = '\0' + VIRTUAL_POLYFILL_ID;

  function buildDescriptor(
    routes: RouteEntry[],
    islandTagNames: string[] = [],
    packageManifests: OpenElementPackageManifest[] = [],
    islandFiles: string[] = [],
  ): EntryDescriptor {
    return buildEntryDescriptor(routes, {
      routesDir: resolvedOptions.routesDir,
      islandsDir: resolvedOptions.islandsDir,
      middleware: resolvedOptions.middleware,
      renderer: resolvedOptions.renderer,
      islandTagNames,
      islandFiles,
      islandMeta: ctx.phase1.islandMeta,
      staticComponents: ctx.phase1.staticComponents,
      packageManifests,
      cemClassifications: ctx.phase1.cemClassifications,
      foreignTags: ctx.phase1.foreignTags,
      headExtras: resolvedOptions.headExtras,
      allowHeadExtrasScripts,
      html: resolvedOptions.html,
      upgradeStrategy: resolvedOptions.island?.upgradeStrategy || 'idle',
      appShell: resolvedOptions.appShell,
      layouts: resolvedOptions.layouts,
    });
  }

  // alpha.17 B1: the entry descriptor is instantiated once per buildStart and
  // shared between the emitted virtual entry code (renderEntry) and
  // ctx.phase1.ssrAdmissionPlan. Previously the descriptor was built twice
  // with divergent options (the plan saw CEM classifications, the emitted
  // entry did not).
  let entryDescriptor: EntryDescriptor | null = null;

  function generateEntry(
    routes: RouteEntry[],
    islandTagNames: string[] = [],
    packageManifests: OpenElementPackageManifest[] = [],
    islandFiles: string[] = [],
  ): string {
    entryDescriptor = buildDescriptor(routes, islandTagNames, packageManifests, islandFiles);
    return renderEntry(entryDescriptor);
  }

  /**
   * #1028: dev-only route rescan. buildStart() scans the routes dir once, so a
   * route file added/removed while `deno task dev` runs never reached the
   * cached entryDescriptor and 404'd until restart. Re-scan, rebuild the
   * descriptor (virtualEntryPlugin.load() renders from it), and invalidate the
   * virtual entry module so the dev server re-evaluates it on the next pass.
   */
  async function rescanRoutes(): Promise<void> {
    const routes = await scanRoutes(resolvedOptions.routesDir!);
    ctx.phase1.cachedRoutes = routes;
    ctx.phase1.staticComponents = await scanStaticComponents({
      root: process.cwd(),
      routesDir: resolvedOptions.routesDir!,
      islandsDir: resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
      routes,
    });
    if (resolvedOptions.mode === 'spa') return;
    generateEntry(
      routes,
      ctx.phase1.islandTagNames,
      ctx.phase1.packageManifests,
      ctx.phase1.islandFiles,
    );
    if (entryDescriptor) {
      ctx.phase1.ssrAdmissionPlan = entryDescriptor.ssrAdmissionPlan;
    }
  }

  /**
   * #1062: dev-only island rescan — same mechanism as rescanRoutes (#1028).
   * buildStart() scans the islands dir once, so an island added/removed while
   * `deno task dev` runs never reached the cached descriptor (SSR admission
   * plan) or the dev island client map: the page rendered DSD but the island
   * never hydrated, with no hint why. Re-scan, rebuild the descriptor
   * (virtualEntryPlugin.load() and devIslandClientPlugin.load() both render
   * from ctx.phase1), and let the configureServer watcher invalidate both
   * virtual entries and full-reload, exactly as for routes.
   */
  async function rescanIslands(): Promise<void> {
    const islandsRoot = join(
      process.cwd(),
      resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
    );
    const islandFiles = await scanIslands(islandsRoot);
    ctx.phase1.islandTagNames = islandFiles.map((f) => fileToTagName(f));
    ctx.phase1.islandFiles = islandFiles;
    ctx.phase1.islandMeta = await scanIslandMeta(islandsRoot, islandFiles);
    if (resolvedOptions.mode === 'spa') return;
    generateEntry(
      ctx.phase1.cachedRoutes || [],
      ctx.phase1.islandTagNames,
      ctx.phase1.packageManifests,
      ctx.phase1.islandFiles,
    );
    if (entryDescriptor) {
      ctx.phase1.ssrAdmissionPlan = entryDescriptor.ssrAdmissionPlan;
    }
  }

  const corePlugin: Plugin = {
    name: 'open:core',
    // The transform hook compiles @element modules and must see the authored
    // TSX source: enforce 'pre' so it runs before Vite's builtin TS/JSX
    // lowering (see @openelement/element/compiler).
    enforce: 'pre',

    config(userConfig) {
      if (userConfig.resolve?.alias) {
        ctx.phase1.userResolveAlias = mergeAliasOptions(
          userConfig.resolve.alias as Record<string, string> | Alias[],
          ctx.phase1.userResolveAlias,
        );
      }

      const aliases = ctx.phase1.userResolveAlias as
        | Alias[]
        | Record<string, string>
        | null;
      const normalizedAliases = normalizeViteAliases(aliases, process.cwd());
      if (normalizedAliases) {
        ctx.phase1.userResolveAlias = normalizedAliases;
      }

      return {
        resolve: normalizedAliases ? { alias: normalizedAliases } : undefined,
        // Chokidar's fs.watch backend drops consecutive change events within
        // 50ms. A quick fix after a syntax error can otherwise leave Vite's
        // SSR error cached forever (the packed Lit consumer on Linux).
        // Use its native write-stability queue, which delivers the final
        // write instead of throttling it away. Explicit watcher settings win.
        ...(userConfig.server?.watch === null ||
            userConfig.server?.watch?.awaitWriteFinish !== undefined
          ? {}
          : {
            server: {
              watch: { awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 } },
            },
          }),
        build: {
          // The generated virtual entry intentionally contains the whole route graph.
          // Keep the budget explicit so Vite does not report it as an unexpected warning.
          chunkSizeWarningLimit: CHUNK_SIZE_WARNING_LIMIT_KB,
          rollupOptions: {
            input: [VIRTUAL_BUILD_TRIGGER_ID],
          },
        },
      };
    },

    configResolved(cfg) {
      if (cfg.resolve?.alias && !ctx.phase1.userResolveAlias) {
        ctx.phase1.userResolveAlias = cfg.resolve.alias;
      }
      // v0.14.6: Generate placeholder entry code with empty routes in configResolved.
      // This is a Vite requirement - the virtual entry must exist before buildStart().
      // The real entry with actual routes is generated in buildStart() which runs later.
      // The returned code string is discarded: the call's job is to populate
      // entryDescriptor, which virtualEntryPlugin.load() renders from.
      generateEntry(
        [],
        ctx.phase1.islandTagNames,
        ctx.phase1.packageManifests,
        ctx.phase1.islandFiles,
      );
    },

    transform(code, id) {
      try {
        const result = compileElementModule(code, id);
        if (!result) return null;
        const key = id.split('?', 1)[0];
        compiledProgramShapes.set(key, programShape(result.program));
        // The semantic core emits the real Source Map v3 (#1210): return it as
        // this hook's `map` output so Vite composes it downstream, and strip
        // the inline comment the standalone artifact carries so the served
        // module has exactly one map story.
        return {
          code: stripInlineSourceMapComment(result.code),
          map: result.map,
        };
      } catch (error) {
        if (error instanceof Error) this.error(error.message);
        throw error;
      }
    },

    async handleHotUpdate(hmr) {
      if (!/\.tsx$/.test(hmr.file)) return;
      let source: string;
      try {
        source = await readFile(hmr.file, 'utf8');
      } catch {
        compiledProgramShapes.delete(hmr.file);
        return;
      }
      try {
        const result = compileElementModule(source, hmr.file);
        if (!result) {
          compiledProgramShapes.delete(hmr.file);
          return;
        }
        const nextShape = programShape(result.program);
        const previousShape = compiledProgramShapes.get(hmr.file);
        compiledProgramShapes.set(hmr.file, nextShape);
        if (previousShape !== undefined && previousShape !== nextShape) {
          // A changed static tree or Part/Region instruction cannot be safely
          // patched in place. Full reload is the bounded fail-closed path;
          // same-program method/initializer edits retain the element module's
          // live state through ordinary Vite HMR.
          hmr.server.ws.send({ type: 'full-reload' });
          return [];
        }
        return hmr.modules;
      } catch {
        // The next normal transform reports the source-located compiler error.
        // Do not keep a stale compiled module alive after an invalid edit.
        compiledProgramShapes.delete(hmr.file);
        hmr.server.ws.send({ type: 'full-reload' });
        return [];
      }
    },

    async buildStart() {
      ctx.reset();

      try {
        const routes = await scanRoutes(resolvedOptions.routesDir!);
        ctx.phase1.staticComponents = await scanStaticComponents({
          root: process.cwd(),
          routesDir: resolvedOptions.routesDir!,
          islandsDir: resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
          routes,
        });

        const islandsRoot = join(
          process.cwd(),
          resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
        );
        const islandFiles = await scanIslands(islandsRoot);
        ctx.phase1.islandTagNames = islandFiles.map((f) => fileToTagName(f));
        ctx.phase1.islandFiles = islandFiles;
        ctx.phase1.islandMeta = await scanIslandMeta(islandsRoot, islandFiles);

        if (
          resolvedOptions.packageIslands &&
          resolvedOptions.packageIslands.length > 0
        ) {
          ctx.phase1.packageManifests = await scanPackageManifests(
            resolvedOptions.packageIslands,
          );
          if (ctx.phase1.packageManifests.length > 0) {
            // Extract island declarations from manifests
            ctx.phase1.packageIslandDecls = buildPackageIslandDecls(
              ctx.phase1.packageManifests,
              resolvedOptions.island?.upgradeStrategy,
            );
            log.info(
              `Package islands: ${ctx.phase1.packageIslandDecls.map((i) => i.tagName).join(', ')}`,
            );
          }
        }

        // Cache routes for lazy load() regeneration.
        ctx.phase1.cachedRoutes = routes;

        // SPA mode: skip SSR virtual entry generation + SSR admission plan
        if (resolvedOptions.mode === 'spa') {
          ctx.phase1.isSpa = true;
          log.info('SPA mode: skipping SSR entry generation, SSG rendering will be skipped');
          const pageCount = routes.filter(
            (r) => r.type === 'page' && !r.special,
          ).length;
          const totalIslands = ctx.phase1.islandTagNames.length +
            ctx.phase1.packageIslandDecls.length;
          log.info(
            `Routes: ${pageCount} page(s), ${totalIslands} island(s) - openElement Architecture (SPA)`,
          );
          return;
        }

        // v0.18.0: CEM auto-detection - scan node_modules for custom-elements.json
        // without importing or executing any package code. Runs BEFORE the entry
        // descriptor is built so the emitted entry and the SSR admission plan
        // share one descriptor instantiation (alpha.17 B1).
        try {
          const nodeModulesDir = join(process.cwd(), 'node_modules');
          ctx.phase1.cemClassifications = await detectAndClassifyCemPackages(nodeModulesDir);
          if (ctx.phase1.cemClassifications.length > 0) {
            log.info(
              `CEM auto-detection: classified ${ctx.phase1.cemClassifications.length} component(s) from node_modules`,
            );
          }
        } catch (err) {
          // CEM detection is best-effort - never fail the build
          log.debug(
            `CEM auto-detection failed (non-fatal): ${formatError(err)}`,
          );
          ctx.phase1.cemClassifications = [];
        }

        // #979 (0.43.0-alpha.2): foreign-tag discovery. Scan page route and
        // island sources for custom-element tags that are neither local
        // islands, package-manifest islands, nor openElement-authored
        // elements, so the admission plan records them explicitly
        // (client-only, visibility only) instead of never seeing them.
        try {
          const knownTags = new Set<string>(ctx.phase1.islandTagNames);
          for (const [tagName, meta] of Object.entries(ctx.phase1.islandMeta)) {
            const delivery = meta as IslandDecl & {
              tags?: readonly string[];
              tagNames?: readonly string[];
            };
            for (
              const deliveredTag of resolveIslandDeliveryTags(
                tagName,
                delivery.tags,
                delivery.tagNames,
                tagName,
              )
            ) knownTags.add(deliveredTag);
          }
          for (const pkg of ctx.phase1.packageManifests) {
            for (const decl of pkg.declarations) {
              const delivery = decl as typeof decl & {
                tags?: readonly string[];
                tagNames?: readonly string[];
              };
              const openElement = decl.openElement as typeof decl.openElement & {
                tags?: readonly string[];
                tagNames?: readonly string[];
              };
              for (
                const deliveredTag of resolveIslandDeliveryTags(
                  decl.tagName,
                  delivery.tags ?? openElement?.tags,
                  delivery.tagNames ?? openElement?.tagNames,
                  decl.tagName,
                )
              ) knownTags.add(deliveredTag);
            }
          }
          const pageRoutes = routes.filter((r) => r.type === 'page' && !r.special);
          for (const route of pageRoutes) {
            knownTags.add(fileToTagName(route.filePath));
            if (route.tagName) knownTags.add(route.tagName);
          }
          const shellConfigs = [
            resolvedOptions.appShell,
            ...Object.values(resolvedOptions.layouts ?? {}),
          ];
          for (const shell of shellConfigs) {
            if (shell && typeof shell === 'object' && shell.tagName) {
              knownTags.add(shell.tagName);
            }
          }
          ctx.phase1.foreignTags = await scanForeignTags({
            routesDir: join(process.cwd(), resolvedOptions.routesDir || DEFAULT_ROUTES_DIR),
            islandsDir: islandsRoot,
            routeFiles: pageRoutes.map((r) => r.filePath),
            islandFiles,
            knownTags,
          });
          if (ctx.phase1.foreignTags.length > 0) {
            log.info(
              `Foreign WC tags consumed in JSX: ${ctx.phase1.foreignTags.join(', ')}`,
            );
          }
        } catch (err) {
          // Foreign-tag discovery is best-effort - never fail the build
          log.debug(
            `Foreign-tag scan failed (non-fatal): ${formatError(err)}`,
          );
          ctx.phase1.foreignTags = [];
        }

        // Single descriptor instantiation: the emitted entry code and the
        // admission plan come from the same object. The returned code string
        // is discarded — the call populates entryDescriptor, which
        // virtualEntryPlugin.load() renders from.
        generateEntry(
          routes,
          ctx.phase1.islandTagNames,
          ctx.phase1.packageManifests,
          ctx.phase1.islandFiles,
        );
        if (entryDescriptor) {
          ctx.phase1.ssrAdmissionPlan = entryDescriptor.ssrAdmissionPlan;
        }
        const pageCount = routes.filter(
          (r) => r.type === 'page' && !r.special,
        ).length;
        const apiCount = routes.filter(
          (r) => r.type === 'api' && !r.special,
        ).length;
        const totalIslands = ctx.phase1.islandTagNames.length +
          ctx.phase1.packageIslandDecls.length;
        log.info(
          `Routes: ${pageCount} page(s), ${apiCount} API route(s), ` +
            `${totalIslands} island(s) - openElement Architecture`,
        );
      } catch (err) {
        throw new OpenElementError(`Route scan failed: ${formatError(err)}`, {
          code: 'ROUTE_SCAN_ERROR',
          statusCode: 500,
          recoverable: false,
        });
      }
    },

    configureServer(server: ViteDevServer) {
      const absoluteRoutesDir = resolve(process.cwd(), resolvedOptions.routesDir!);
      const absoluteIslandsDir = resolve(
        process.cwd(),
        resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
      );
      server.watcher.add(absoluteRoutesDir);
      server.watcher.add(absoluteIslandsDir);

      let routeDirty = false;
      let islandDirty = false;
      let latestChangedFile = '';
      let rescanTimer: ReturnType<typeof setTimeout> | undefined;
      let rescanQueue = Promise.resolve();

      const invalidateVirtualEntries = (ids: string[]): void => {
        for (const id of ids) {
          const mod = server.moduleGraph.getModuleById(id);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        // .mdx route modules resolve to '\0open-mdx:*.tsx' virtual modules
        // (plugin-mdx.ts): the module graph keys them by the virtual id, so a
        // route-dir .mdx edit must drop them by prefix or the SSR runner would
        // keep serving the stale compiled page.
        const idMap = server.moduleGraph.idToModuleMap;
        if (!idMap) return;
        for (const mod of idMap.keys()) {
          if (mod.startsWith('\0open-mdx:')) {
            const moduleFile = mod.slice('\0open-mdx:'.length, -'.tsx'.length);
            if (moduleFile === latestChangedFile) {
              const found = server.moduleGraph.getModuleById(mod);
              if (found) server.moduleGraph.invalidateModule(found);
            }
          }
        }
      };

      /**
       * Serialize descriptor rescans behind one debounced queue. A new event
       * arriving during a scan marks another pass dirty, so filesystem event
       * order—not whichever async scan happens to finish last—determines the
       * final descriptor.
       */
      const scheduleDescriptorRescan = (kind: 'route' | 'island', file: string): void => {
        if (kind === 'route') routeDirty = true;
        else islandDirty = true;
        latestChangedFile = file;
        if (rescanTimer) clearTimeout(rescanTimer);
        rescanTimer = setTimeout(() => {
          rescanTimer = undefined;
          rescanQueue = rescanQueue.then(async () => {
            const scanRoutesNow = routeDirty;
            const scanIslandsNow = islandDirty;
            routeDirty = false;
            islandDirty = false;
            if (scanRoutesNow) await rescanRoutes();
            if (scanIslandsNow) await rescanIslands();
            invalidateVirtualEntries([
              RESOLVED_ENTRY_ID,
              ...(scanIslandsNow ? [RESOLVED_CLIENT_ENTRY_ID] : []),
            ]);
            log.info(`Sources changed: ${relative(process.cwd(), latestChangedFile)} - reloading`);
            server.hot.send({ type: 'full-reload' });
          }).catch((err: unknown) => {
            // A broken source must not poison the queue: the next edit chains
            // after this handled rejection and gets a fresh rescan attempt.
            log.error(`Descriptor rescan failed: ${formatError(err)}`);
          });
        }, 25);
      };

      // Route contents affect renderIntent, metadata and enhanced-form
      // admission, so change events require the same descriptor rebuild as
      // add/unlink—not only normal client HMR.
      const onRouteChanged = (file: string) => {
        if (!file.startsWith(absoluteRoutesDir)) return;
        if (!/\.(ts|tsx|js|jsx|mdx)$/.test(file)) return;
        scheduleDescriptorRescan('route', file);
      };

      // #1062: same chain for the island SET (extension filter mirrors
      // scanIslands). The island client entry is a virtual module too, so it
      // must be invalidated alongside the SSR entry — otherwise the browser
      // re-requests the cached client map and new islands never hydrate.
      const onIslandChanged = (file: string) => {
        if (!file.startsWith(absoluteIslandsDir)) return;
        if (!/\.(ts|tsx|js|jsx)$/.test(file)) return;
        scheduleDescriptorRescan('island', file);
      };

      // Explicitly invalidate both the changed module/importer chain and the
      // virtual SSR entry. Vite's client transform already sees the edit; this
      // closes the separate SSR-runner cache path used by hono dev serving.
      const onSsrSourceChanged = (file: string) => {
        const modules = server.moduleGraph.getModulesByFile(file);
        if (modules) {
          for (const mod of modules) server.moduleGraph.invalidateModule(mod);
        }
        invalidateVirtualEntries([RESOLVED_ENTRY_ID]);
      };

      for (const event of ['add', 'change', 'unlink'] as const) {
        server.watcher.on(event, onRouteChanged);
        server.watcher.on(event, onIslandChanged);
      }
      server.watcher.on('change', onSsrSourceChanged);
      server.httpServer?.on('close', () => {
        if (rescanTimer) clearTimeout(rescanTimer);
        for (const event of ['add', 'change', 'unlink'] as const) {
          server.watcher.off(event, onRouteChanged);
          server.watcher.off(event, onIslandChanged);
        }
        server.watcher.off('change', onSsrSourceChanged);
      });
    },
  };

  const virtualEntryPlugin: Plugin = {
    name: 'open:virtual-entry',

    resolveId(id) {
      if (id === VIRTUAL_ENTRY_ID) return RESOLVED_ENTRY_ID;
      if (id === VIRTUAL_BUILD_TRIGGER_ID) return RESOLVED_BUILD_TRIGGER_ID;
      if (id === VIRTUAL_POLYFILL_ID) return RESOLVED_POLYFILL_ID;
    },

    load(id) {
      if (id === RESOLVED_POLYFILL_ID) {
        if (resolvedOptions.renderer === 'lit') {
          // #1339: the lit SSR path needs the @lit-labs/ssr global DOM shim —
          // not the native Map-backed customElements stub — installed before
          // any route module evaluates (ESM evaluates this first import
          // before every other entry import).
          return `import '@lit-labs/ssr/lib/install-global-dom-shim.js';\n`;
        }
        return generateCustomElementsPolyfill();
      }
      if (id === RESOLVED_BUILD_TRIGGER_ID) {
        return 'export default null;';
      }
      if (id === RESOLVED_ENTRY_ID) {
        // Reuse the descriptor built in buildStart(): the emitted entry code
        // and ctx.phase1.ssrAdmissionPlan must come from one instantiation.
        // The descriptor does not depend on late-settled plugin data, so
        // regeneration is only a fallback for the pre-buildStart placeholder.
        const entryCode = entryDescriptor ? renderEntry(entryDescriptor) : generateEntry(
          ctx.phase1.cachedRoutes || [],
          ctx.phase1.islandTagNames,
          ctx.phase1.packageManifests,
          ctx.phase1.islandFiles,
        );
        return `import '${VIRTUAL_POLYFILL_ID}';\n` + entryCode;
      }
    },
  };

  // SPA mode is client-only: the @hono/vite-dev-server middleware would import
  // route modules on the server to SSR-render them, but route modules call
  // `customElements.define(...)` at module top level (and may touch `document`/
  // `localStorage`), which crashes with "customElements is not defined" in a
  // server context. In SPA mode the client bootstrap (e.g. reader.tsx) owns
  // rendering, so Vite's built-in SPA middleware (index.html + HMR) is all we
  // need. Skip the SSR dev server entirely.
  const plugins: Plugin[] = [
    mdxPlugin({ routesDir: resolvedOptions.routesDir }),
    corePlugin,
    virtualEntryPlugin,
  ];

  if (resolvedOptions.mode !== 'spa') {
    plugins.push(
      lazyHonoDevServer((honoDevServer) => ({
        entry: VIRTUAL_ENTRY_ID,
        // ADR-0123 item 2 (#858): with middleware.use configured, the entry
        // exposes openElementDevFetch — the dev-server-shaped adapter over the
        // same composed fetch-middleware handler that the start CLI, the e2e
        // fixture server, and the Nitro entry use. Without it, keep the
        // default export (the bare Hono app) so the dev path is unchanged.
        ...(resolvedOptions.middleware?.use?.length ? { export: 'openElementDevFetch' } : {}),
        injectClientScript: true,
        // #951: the upstream exclude regexes test req.url WITH its query
        // string, so vite's versioned module URLs (/.vite/deps/x.js?v=hash —
        // the optimized-dependency form of every bare import in the dev island
        // client graph) fell through to the Hono app and 404'd. Extend the
        // defaults to let versioned module requests reach Vite.
        exclude: [...honoDevServer.defaultOptions.exclude, /\?v=[A-Za-z0-9]+$/],
      })),
    );
  }

  plugins.push(
    islandTransformPlugin(resolvedOptions.islandsDir!),
    buildPlugin(resolvedOptions, ctx),
    // #951: dev-only serving of the island client entry at the same public
    // URL the production build emits (<base>client/islands/client.js).
    devIslandClientPlugin(resolvedOptions, ctx),
  );

  return plugins;
}
