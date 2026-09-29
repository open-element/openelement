/**
 * Route/island/manifest discovery and the shared entry descriptor of the
 * open build plugin (issue #1473 extraction).
 *
 * `buildStart` owns the one-shot scan pass that populates ctx.phase1; the
 * rescan entry points serve the dev watcher (plugin-watch.ts). Moved out of
 * plugin.ts verbatim: behavior, log lines and error wrapping are unchanged.
 */

import type { Plugin } from 'vite';
import type { OpenElementPackageManifest, RouteEntry } from './internal/protocol/framework.ts';
import type { IslandDecl } from './internal/protocol/ssg.ts';
import { createLogger, formatError, OpenElementError } from '@openelement/element';
import { join } from '../internal/host-path.ts';
import { DEFAULT_ISLANDS_DIR, DEFAULT_ROUTES_DIR } from './internal/paths.ts';
import {
  buildEntryDescriptor,
  detectAndClassifyCemPackages,
  fileToTagName,
  renderEntry,
  scanForeignTags,
  scanIslandMeta,
  scanIslands,
  scanPackageManifests,
  scanRoutes,
  scanStaticComponents,
} from './internal/ssg/index.ts';
import type { EntryDescriptor } from './internal/ssg/index.ts';
import { buildPackageIslandDecls } from './internal/ssg/island-scanner.ts';
import { resolveIslandDeliveryTags } from './internal/ssg/delivery.ts';
import type { OpenPluginState } from './plugin-config.ts';

const log = createLogger('router-vite');

function buildDescriptor(
  state: OpenPluginState,
  routes: RouteEntry[],
  islandTagNames: string[] = [],
  packageManifests: OpenElementPackageManifest[] = [],
  islandFiles: string[] = [],
): EntryDescriptor {
  return buildEntryDescriptor(routes, {
    routesDir: state.resolvedOptions.routesDir,
    islandsDir: state.resolvedOptions.islandsDir,
    middleware: state.resolvedOptions.middleware,
    renderer: state.resolvedOptions.renderer,
    islandTagNames,
    islandFiles,
    islandMeta: state.ctx.phase1.islandMeta,
    staticComponents: state.ctx.phase1.staticComponents,
    packageManifests,
    cemClassifications: state.ctx.phase1.cemClassifications,
    foreignTags: state.ctx.phase1.foreignTags,
    headExtras: state.headExtrasValue,
    allowHeadExtrasScripts: state.allowHeadExtrasValue,
    html: state.resolvedOptions.html,
    upgradeStrategy: state.resolvedOptions.island?.upgradeStrategy || 'idle',
    appShell: state.resolvedOptions.appShell,
    layouts: state.resolvedOptions.layouts,
    // #1411: the default-CORS production advisory belongs to a production
    // build. Repeating it on every dev first run trained users to ignore it,
    // so the dev server (command 'serve') generates the same entry without
    // the warning; `cli/build` keeps it.
    warnOnDefaultCors: state.produceMode !== 'serve',
    // Same source as the SSG descriptor: the dev/SSR entry must resolve
    // locales identically or dev and build disagree about `/zh/...` paths.
    i18n: state.ctx.plugins.i18nOptions ?? undefined,
  });
}

export function generateEntry(
  state: OpenPluginState,
  routes: RouteEntry[],
  islandTagNames: string[] = [],
  packageManifests: OpenElementPackageManifest[] = [],
  islandFiles: string[] = [],
): string {
  state.entryDescriptor = buildDescriptor(
    state,
    routes,
    islandTagNames,
    packageManifests,
    islandFiles,
  );
  return renderEntry(state.entryDescriptor);
}

/**
 * #1028: dev-only route rescan. buildStart() scans the routes dir once, so a
 * route file added/removed while `deno task dev` runs never reached the
 * cached entryDescriptor and 404'd until restart. Re-scan, rebuild the
 * descriptor (virtualEntryPlugin.load() renders from it), and invalidate the
 * virtual entry module so the dev server re-evaluates it on the next pass.
 */
export async function rescanRoutes(state: OpenPluginState): Promise<void> {
  const routes = await scanRoutes(state.resolvedOptions.routesDir!, '', {
    root: state.viteRoot ?? Deno.cwd(),
    workspaceRoot: state.workspaceRoot,
  });
  state.ctx.phase1.cachedRoutes = routes;
  state.ctx.phase1.staticComponents = await scanStaticComponents({
    root: Deno.cwd(),
    routesDir: state.resolvedOptions.routesDir!,
    islandsDir: state.resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
    routes,
  });
  generateEntry(
    state,
    routes,
    state.ctx.phase1.islandTagNames,
    state.ctx.phase1.packageManifests,
    state.ctx.phase1.islandFiles,
  );
  if (state.entryDescriptor) {
    state.ctx.phase1.ssrAdmissionPlan = state.entryDescriptor.ssrAdmissionPlan;
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
export async function rescanIslands(state: OpenPluginState): Promise<void> {
  const islandsRoot = join(
    Deno.cwd(),
    state.resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
  );
  const islandFiles = await scanIslands(islandsRoot);
  state.ctx.phase1.islandTagNames = islandFiles.map((f) => fileToTagName(f));
  state.ctx.phase1.islandFiles = islandFiles;
  state.ctx.phase1.islandMeta = await scanIslandMeta(islandsRoot, islandFiles);
  generateEntry(
    state,
    state.ctx.phase1.cachedRoutes || [],
    state.ctx.phase1.islandTagNames,
    state.ctx.phase1.packageManifests,
    state.ctx.phase1.islandFiles,
  );
  if (state.entryDescriptor) {
    state.ctx.phase1.ssrAdmissionPlan = state.entryDescriptor.ssrAdmissionPlan;
  }
}

/** Create the `buildStart` hook of `open:core` over the shared plugin state. */
export function createBuildStartHook(state: OpenPluginState): Pick<Plugin, 'buildStart'> {
  return {
    async buildStart() {
      state.ctx.reset();

      try {
        const routes = await scanRoutes(state.resolvedOptions.routesDir!, '', {
          root: state.viteRoot ?? Deno.cwd(),
          workspaceRoot: state.workspaceRoot,
        });
        state.ctx.phase1.staticComponents = await scanStaticComponents({
          root: Deno.cwd(),
          routesDir: state.resolvedOptions.routesDir!,
          islandsDir: state.resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
          routes,
        });

        const islandsRoot = join(
          Deno.cwd(),
          state.resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
        );
        const islandFiles = await scanIslands(islandsRoot);
        state.ctx.phase1.islandTagNames = islandFiles.map((f) => fileToTagName(f));
        state.ctx.phase1.islandFiles = islandFiles;
        state.ctx.phase1.islandMeta = await scanIslandMeta(islandsRoot, islandFiles);

        if (
          state.resolvedOptions.packageIslands &&
          state.resolvedOptions.packageIslands.length > 0
        ) {
          state.ctx.phase1.packageManifests = await scanPackageManifests(
            state.resolvedOptions.packageIslands,
          );
          if (state.ctx.phase1.packageManifests.length > 0) {
            // Extract island declarations from manifests
            state.ctx.phase1.packageIslandDecls = buildPackageIslandDecls(
              state.ctx.phase1.packageManifests,
              state.resolvedOptions.island?.upgradeStrategy,
            );
            log.info(
              `Package islands: ${
                state.ctx.phase1.packageIslandDecls.map((i) => i.tagName).join(', ')
              }`,
            );
          }
        }

        // Cache routes for lazy load() regeneration.
        state.ctx.phase1.cachedRoutes = routes;

        // v0.18.0: CEM auto-detection - scan node_modules for custom-elements.json
        // without importing or executing any package code. Runs BEFORE the entry
        // descriptor is built so the emitted entry and the SSR admission plan
        // share one descriptor instantiation (alpha.17 B1).
        try {
          const nodeModulesDir = join(Deno.cwd(), 'node_modules');
          state.ctx.phase1.cemClassifications = await detectAndClassifyCemPackages(
            nodeModulesDir,
          );
          if (state.ctx.phase1.cemClassifications.length > 0) {
            log.info(
              `CEM auto-detection: classified ${state.ctx.phase1.cemClassifications.length} component(s) from node_modules`,
            );
          }
        } catch (err) {
          // CEM detection is best-effort - never fail the build
          log.debug(
            `CEM auto-detection failed (non-fatal): ${formatError(err)}`,
          );
          state.ctx.phase1.cemClassifications = [];
        }

        // #979 (0.43.0-alpha.2): foreign-tag discovery. Scan page route and
        // island sources for custom-element tags that are neither local
        // islands, package-manifest islands, nor openElement-authored
        // elements, so the admission plan records them explicitly
        // (client-only, visibility only) instead of never seeing them.
        try {
          const knownTags = new Set<string>(state.ctx.phase1.islandTagNames);
          for (const [tagName, meta] of Object.entries(state.ctx.phase1.islandMeta)) {
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
          for (const pkg of state.ctx.phase1.packageManifests) {
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
            state.resolvedOptions.appShell,
            ...Object.values(state.resolvedOptions.layouts ?? {}),
          ];
          for (const shell of shellConfigs) {
            if (shell && typeof shell === 'object' && shell.tagName) {
              knownTags.add(shell.tagName);
            }
          }
          state.ctx.phase1.foreignTags = await scanForeignTags({
            routesDir: join(Deno.cwd(), state.resolvedOptions.routesDir || DEFAULT_ROUTES_DIR),
            islandsDir: islandsRoot,
            routeFiles: pageRoutes.map((r) => r.filePath),
            islandFiles,
            knownTags,
          });
          if (state.ctx.phase1.foreignTags.length > 0) {
            log.info(
              `Foreign WC tags consumed in JSX: ${state.ctx.phase1.foreignTags.join(', ')}`,
            );
          }
        } catch (err) {
          // Foreign-tag discovery is best-effort - never fail the build
          log.debug(
            `Foreign-tag scan failed (non-fatal): ${formatError(err)}`,
          );
          state.ctx.phase1.foreignTags = [];
        }

        // Single descriptor instantiation: the emitted entry code and the
        // admission plan come from the same object. The returned code string
        // is discarded — the call populates entryDescriptor, which
        // virtualEntryPlugin.load() renders from.
        generateEntry(
          state,
          routes,
          state.ctx.phase1.islandTagNames,
          state.ctx.phase1.packageManifests,
          state.ctx.phase1.islandFiles,
        );
        if (state.entryDescriptor) {
          state.ctx.phase1.ssrAdmissionPlan = state.entryDescriptor.ssrAdmissionPlan;
        }
        const pageCount = routes.filter(
          (r) => r.type === 'page' && !r.special,
        ).length;
        const apiCount = routes.filter(
          (r) => r.type === 'api' && !r.special,
        ).length;
        const totalIslands = state.ctx.phase1.islandTagNames.length +
          state.ctx.phase1.packageIslandDecls.length;
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
  };
}
