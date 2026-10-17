/**
 * Lazy @hono/vite-dev-server registration for the openElement Vite plugin.
 *
 * @hono/vite-dev-server is an OPTIONAL peer of @openelement/router: only the
 * Vite dev server (`oe dev` in a generated project; it boots Vite) needs it —
 * `build`, `start`
 * and Route Mode never touch it. A top-level import in plugin.ts made every
 * consumer of the ./vite plugin resolve the package at config-load time, so a
 * hermetic consumer that only builds failed with ERR_MODULE_NOT_FOUND. The
 * package is therefore loaded lazily on the first dev-server hook; if dev
 * mode runs without it installed, the load fails closed with an actionable
 * message naming the package to install.
 *
 * The wrapper keeps the upstream plugin name and proxies its four hooks
 * (config / configResolved / configureServer / handleHotUpdate, per
 * dev-server.mjs), so plugin ordering, vite's plugin log and the plugin-list
 * contract the router tests assert are unchanged. `apply: 'serve'` keeps the
 * peer out of `vite build` entirely.
 */

import type { Plugin, ViteDevServer } from 'vite';
import type { DevServerOptions } from '@hono/vite-dev-server';
import { installDevHostDelegation } from './internal/dev-host-delegation.ts';

type HonoDevServerModule = typeof import('@hono/vite-dev-server');

type ProxiedHook = 'config' | 'configResolved' | 'configureServer' | 'handleHotUpdate';

/**
 * The peer's hooks are proxied unchanged; the two dev-host gaps a peer pattern
 * list cannot express are closed by the router's own middlewares.
 */
export function lazyHonoDevServer(options: (mod: HonoDevServerModule) => DevServerOptions): Plugin {
  let pending: Promise<Plugin> | undefined;
  const load = (): Promise<Plugin> => {
    pending ??= (async () => {
      let mod: HonoDevServerModule;
      try {
        mod = await import('@hono/vite-dev-server');
      } catch (cause) {
        throw new Error(
          'openElement dev mode requires @hono/vite-dev-server (an optional peer of ' +
            '@openelement/router). Install it into your app to use `oe dev`: add ' +
            '"@hono/vite-dev-server": "^0.25.3" to the package.json dependencies ' +
            '(`npm install --save-dev @hono/vite-dev-server` does the same).',
          { cause },
        );
      }
      return mod.default(options(mod)) as Plugin;
    })();
    return pending;
  };

  const proxy = <H extends ProxiedHook>(hook: H): NonNullable<Plugin[H]> =>
    async function (this: unknown, ...args: unknown[]) {
      const plugin = await load();
      const candidate = plugin[hook] as unknown;
      const fn =
        typeof candidate === 'function'
          ? candidate
          : candidate && typeof candidate === 'object' && 'handler' in candidate
            ? (candidate as { handler: unknown }).handler
            : undefined;
      if (typeof fn !== 'function') return undefined;
      return (fn as (this: unknown, ...hookArgs: unknown[]) => unknown).apply(this, args);
    } as unknown as NonNullable<Plugin[H]>;

  const configureServer = function (this: unknown, server: ViteDevServer) {
    installDevHostDelegation(server);
    return (proxy('configureServer') as (server: ViteDevServer) => Promise<unknown>).call(
      this,
      server,
    );
  };

  return {
    name: '@hono/vite-dev-server',
    // The SSR dev server exists only in `vite dev`; builds must not load the peer.
    apply: 'serve',
    config: proxy('config'),
    configResolved: proxy('configResolved'),
    // Kept in Vite's pre phase (the peer's own order): Vite's HTML fallback
    // middleware REWRITES `req.url`, so an app middleware running after it
    // would receive the wrong route path. The two delegations a pattern list
    // cannot express run just before the peer's own middleware.
    configureServer: configureServer as unknown as NonNullable<Plugin['configureServer']>,
    handleHotUpdate: proxy('handleHotUpdate'),
  };
}
