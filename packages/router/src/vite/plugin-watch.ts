/**
 * The dev-server watcher hook of the open build plugin (issue #1473
 * extraction).
 *
 * `configureServer` watches the routes/islands dirs and the resolved
 * openelement.config.ts, serializes descriptor rescans behind one debounced
 * queue, and invalidates the virtual entries on source changes.
 */

import process from 'node:process';
import type { Plugin, ViteDevServer } from 'vite';
import { createLogger, formatError } from '@openelement/element';
import { relative, resolve } from 'pathe';
import { DEFAULT_ISLANDS_DIR } from './internal/paths.ts';
import { RESOLVED_CLIENT_ENTRY_ID } from './dev-island-client.ts';
import { rescanIslands, rescanRoutes } from './plugin-scanners.ts';
import { RESOLVED_ENTRY_ID } from './plugin-virtual-modules.ts';
import type { OpenPluginState } from './plugin-config.ts';

const log = createLogger('router-vite');

/** Create the `configureServer` hook of `open:core` over the shared state. */
export function createConfigureServerHook(state: OpenPluginState): Pick<Plugin, 'configureServer'> {
  return {
    configureServer(server: ViteDevServer) {
      const absoluteRoutesDir = resolve(process.cwd(), state.resolvedOptions.routesDir!);
      const absoluteIslandsDir = resolve(
        process.cwd(),
        state.resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
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
          rescanQueue = rescanQueue
            .then(async () => {
              const scanRoutesNow = routeDirty;
              const scanIslandsNow = islandDirty;
              routeDirty = false;
              islandDirty = false;
              if (scanRoutesNow) await rescanRoutes(state);
              if (scanIslandsNow) await rescanIslands(state);
              invalidateVirtualEntries([
                RESOLVED_ENTRY_ID,
                ...(scanIslandsNow ? [RESOLVED_CLIENT_ENTRY_ID] : []),
              ]);
              log.info(
                `Sources changed: ${relative(process.cwd(), latestChangedFile)} - reloading`,
              );
              server.hot.send({ type: 'full-reload' });
            })
            .catch((err: unknown) => {
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
      // #1411: `openelement.config.ts` is the framework options' home, so an
      // edit to it must restart the dev process. Re-resolving in place cannot
      // rebuild the already-emitted virtual entries and the Vite config this
      // plugin returned, and a half-applied options object is exactly the
      // "two homes" state the config file removes — fail closed by restarting.
      const onAppConfigChanged = (file: string) => {
        if (state.resolvedConfigFile === null || file !== state.resolvedConfigFile) return;
        log.info(
          `openelement.config.ts changed - restarting the dev server (Vite config is frozen per run)`,
        );
        const restart = (server as unknown as { restart?: () => unknown }).restart;
        if (typeof restart === 'function') {
          void restart.call(server);
          return;
        }
        // No restart hook (older Vite): surface the need instead of serving
        // stale options.
        log.warn(
          'Restart the dev server (`pnpm dev` / `npm run dev`) to apply the new openelement.config.ts options.',
        );
      };
      if (state.resolvedConfigFile !== null) server.watcher.add(state.resolvedConfigFile);
      server.watcher.on('change', onAppConfigChanged);
      server.httpServer?.on('close', () => {
        if (rescanTimer) clearTimeout(rescanTimer);
        for (const event of ['add', 'change', 'unlink'] as const) {
          server.watcher.off(event, onRouteChanged);
          server.watcher.off(event, onIslandChanged);
        }
        server.watcher.off('change', onSsrSourceChanged);
        server.watcher.off('change', onAppConfigChanged);
      });
    },
  };
}
