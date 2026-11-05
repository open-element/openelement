/**
 * The dev-server watcher hook of the open build plugin (issue #1473
 * extraction).
 *
 * `configureServer` watches the routes/islands dirs and the resolved
 * openelement.config.ts, serializes descriptor rescans behind one debounced
 * queue, and invalidates the virtual entries on source changes. `closeBundle`
 * is the one idempotent disposal hook Vite calls in both normal and
 * middleware mode; `configureServer`'s return value is a post hook, never a
 * dispose function.
 */

import process from 'node:process';
import type { Plugin, ViteDevServer } from 'vite';
import { createLogger } from '@openelement/element';
import { relative, resolve } from 'pathe';
import { DEFAULT_ISLANDS_DIR } from './internal/paths.ts';
import { reportRecoveryFailure } from './internal/build-diagnostics.ts';
import { RESOLVED_CLIENT_ENTRY_ID } from './dev-island-client.ts';
import { rescanIslands, rescanRoutes, scanPackageIslandsInto } from './plugin-scanners.ts';
import { RESOLVED_ENTRY_ID } from './plugin-virtual-modules.ts';
import type { OpenPluginState } from './plugin-config.ts';
import { realPathKey } from './internal/real-path-key.ts';

const log = createLogger('router-vite');

/** One dev server's live watcher hook set, keyed by the `ViteDevServer` identity. */
interface WatchRegistration {
  /**
   * Installed only after the initial package scan resolves. A close that lands
   * while that scan is still awaiting finds the placeholder and cancels it.
   */
  dispose: (() => void) | null;
  /** Set when `closeBundle` has attributed a close to this server. */
  closed: boolean;
}

/**
 * Whether this server's watcher can prove it is closed.
 *
 * Chokidar's `FSWatcher.close()` sets `closed = true` synchronously, and
 * Vite's `server.close()` invokes `watcher.close()` before the plugin
 * container's `closeBundle` (`Promise.allSettled([watcher.close(), ...,
 * environment.close(), ...])`), so by the time this hook runs the outgoing
 * server's flag is already flipped. Vite's `NoopWatcher` (watch disabled)
 * exposes no such field, so `undefined` means "cannot attribute a close to
 * this server".
 */
function watcherClosedState(server: ViteDevServer): boolean | undefined {
  const closed = (server.watcher as unknown as { closed?: unknown }).closed;
  return typeof closed === 'boolean' ? closed : undefined;
}

/** Create the `configureServer` / `closeBundle` hooks of `open:core` over the shared state. */
export function createConfigureServerHook(
  state: OpenPluginState,
): Pick<Plugin, 'configureServer' | 'closeBundle'> {
  // Vite closes the dev server through its plugin container in BOTH normal and
  // middleware mode (`closeBundle`), so that hook is the one disposal path.
  // The `configureServer` return value is Vite's post-middleware hook, never a
  // cleanup: it stays unused here.
  //
  // A Vite restart reuses this plugin instance and runs the replacement
  // server's `configureServer` BEFORE the outgoing server's `closeBundle`.
  // Sharing one disposer set let that outgoing close collect the replacement's
  // cleanup too. Identity-keyed registrations let `closeBundle` dispose only
  // the server Vite has actually closed.
  const registrations = new Map<ViteDevServer, WatchRegistration>();
  return {
    async configureServer(server: ViteDevServer) {
      const registration: WatchRegistration = { dispose: null, closed: false };
      // Register the placeholder BEFORE the scan await: a close landing in
      // that window must be attributable to this exact server and cancellable.
      registrations.set(server, registration);
      // Vite runs this hook BEFORE `buildStart`, and the Tailwind dev channels
      // resolve their plan in their own `configureServer` — so the package
      // manifest scan runs here first: a declared compilation requirement
      // (a declared or scan-derived package requirement) must be visible before
      // those hooks decide the pipeline exists. Same function as buildStart's
      // scan (idempotent): the routes have not been scanned yet, so the
      // derivation walks the islands/layouts it can see, and buildStart's pass
      // completes the set from the full graph. The dev server's own plugin
      // container stands in for the buildStart resolver capture.
      try {
        await scanPackageIslandsInto(state, [], {
          resolve: (specifier, importer) =>
            server.pluginContainer.resolveId(specifier, importer) as ReturnType<
              import('./internal/module-graph-walk.ts').ModuleWalkResolver['resolve']
            >,
        });
      } catch (error) {
        // A failed scan installed nothing; do not leave a placeholder for a
        // later closeBundle to replay.
        if (registrations.get(server) === registration) registrations.delete(server);
        throw error;
      }
      // If this server closed while the scan was in flight (Vite flipped its
      // watcher flag, or closeBundle already cancelled the placeholder), add
      // no watch paths, listeners or debounce state to a dead server.
      if (
        registration.closed ||
        registrations.get(server) !== registration ||
        watcherClosedState(server) === true
      ) {
        if (registrations.get(server) === registration) registrations.delete(server);
        return;
      }
      const absoluteRoutesDir = realPathKey(
        resolve(process.cwd(), state.resolvedOptions.routesDir!),
      );
      const absoluteIslandsDir = realPathKey(
        resolve(process.cwd(), state.resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR),
      );
      server.watcher.add(absoluteRoutesDir);
      server.watcher.add(absoluteIslandsDir);

      let closed = false;
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
        if (closed) return;
        if (kind === 'route') routeDirty = true;
        else islandDirty = true;
        latestChangedFile = file;
        if (rescanTimer) clearTimeout(rescanTimer);
        rescanTimer = setTimeout(() => {
          rescanTimer = undefined;
          if (closed) return;
          rescanQueue = rescanQueue
            .then(async () => {
              // A close that landed while this pass waited in the queue must
              // stop it before it touches the module graph or the client.
              if (closed) return;
              const scanRoutesNow = routeDirty;
              const scanIslandsNow = islandDirty;
              routeDirty = false;
              islandDirty = false;
              if (scanRoutesNow) await rescanRoutes(state);
              if (closed) return;
              if (scanIslandsNow) await rescanIslands(state);
              if (closed) return;
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
              // The handled rejection is the dev channel's only report of the
              // failure (#1616): it names the failure's code per the envelope
              // when the failure carries one, and the served entry keeps the
              // last good descriptor.
              if (closed) return;
              reportRecoveryFailure(log, 'Descriptor rescan failed', err);
            });
        }, 25);
      };

      // Route contents affect renderIntent, metadata and enhanced-form
      // admission, so change events require the same descriptor rebuild as
      // add/unlink—not only normal client HMR.
      const onRouteChanged = (file: string) => {
        if (closed) return;
        if (!realPathKey(file).startsWith(absoluteRoutesDir)) return;
        if (!/\.(ts|tsx|js|jsx|mdx)$/.test(file)) return;
        scheduleDescriptorRescan('route', file);
      };

      // #1062: same chain for the island SET (extension filter mirrors
      // scanIslands). The island client entry is a virtual module too, so it
      // must be invalidated alongside the SSR entry — otherwise the browser
      // re-requests the cached client map and new islands never hydrate.
      const onIslandChanged = (file: string) => {
        if (closed) return;
        if (!realPathKey(file).startsWith(absoluteIslandsDir)) return;
        if (!/\.(ts|tsx|js|jsx)$/.test(file)) return;
        scheduleDescriptorRescan('island', file);
      };

      // Explicitly invalidate both the changed module/importer chain and the
      // virtual SSR entry. Vite's client transform already sees the edit; this
      // closes the separate SSR-runner cache path used by hono dev serving.
      const onSsrSourceChanged = (file: string) => {
        if (closed) return;
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
        if (closed) return;
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
          'Restart the dev server (`oe dev`, or the equivalent dev script of your package manager) to apply the new openelement.config.ts options.',
        );
      };
      if (state.resolvedConfigFile !== null) server.watcher.add(state.resolvedConfigFile);
      server.watcher.on('change', onAppConfigChanged);

      // One idempotent cleanup covers normal and middleware-mode shutdown. It
      // removes only the listeners THIS hook installed — never a shared
      // `unwatch(path)`, which would detach other plugins from those dirs — and
      // it flips the closed guard so an already-queued rescan stops before
      // invalidating modules or requesting a reload.
      const cleanup = () => {
        if (closed) return;
        closed = true;
        // closeBundle deletes the entry itself; a direct cleanup must not leave
        // a stale registration behind either.
        if (registrations.get(server) === registration) registrations.delete(server);
        if (rescanTimer) {
          clearTimeout(rescanTimer);
          rescanTimer = undefined;
        }
        routeDirty = false;
        islandDirty = false;
        latestChangedFile = '';
        for (const event of ['add', 'change', 'unlink'] as const) {
          server.watcher.off(event, onRouteChanged);
          server.watcher.off(event, onIslandChanged);
        }
        server.watcher.off('change', onSsrSourceChanged);
        server.watcher.off('change', onAppConfigChanged);
      };
      registration.dispose = cleanup;
    },
    // Vite calls this from its plugin container on every dev-server close,
    // including middleware mode (where `httpServer` is null and no HTTP close
    // event exists). Returning a post-middleware hook from `configureServer`
    // would be wrong here: Vite runs that value, it does not dispose with it.
    closeBundle() {
      const entries = [...registrations];
      let identified = false;
      for (const [server, registration] of entries) {
        const watcherClosed = watcherClosedState(server);
        // A watcher shape without the flag cannot be attributed to any server:
        // leave it for the conservative fallback below (or for a later
        // identifiable close when it is mixed with chokidar-shaped watchers).
        if (watcherClosed === undefined) continue;
        identified = true;
        // A restart runs the replacement server's configureServer first, so
        // its watcher is still open while this hook serves the outgoing
        // server. Only the server Vite has closed is ours to dispose.
        if (!watcherClosed) continue;
        registration.closed = true;
        registration.dispose?.();
        registrations.delete(server);
      }
      if (identified) return;
      // NoopWatcher (`server.watch: null`) exposes no `closed` flag, so this
      // close cannot be attributed to a server. Conservatively keep the
      // pre-restart-fix behavior for that shape: dispose every registration.
      // With no identifiable replacement there is nothing a partial pass could
      // preserve correctly.
      for (const [, registration] of entries) {
        registration.closed = true;
        registration.dispose?.();
      }
      registrations.clear();
    },
  };
}
