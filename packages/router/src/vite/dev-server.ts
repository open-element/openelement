/**
 * Lazy @hono/vite-dev-server registration for the openElement Vite plugin.
 *
 * @hono/vite-dev-server is an OPTIONAL peer of @openelement/router: only the
 * Vite dev server (`vite dev` / `deno task dev`) needs it — `build`, `start`
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

import type { Plugin } from 'vite';
import type { DevServerOptions } from '@hono/vite-dev-server';

type HonoDevServerModule = typeof import('@hono/vite-dev-server');

type ProxiedHook = 'config' | 'configResolved' | 'configureServer' | 'handleHotUpdate';

export function lazyHonoDevServer(
  options: (mod: HonoDevServerModule) => DevServerOptions,
): Plugin {
  let pending: Promise<Plugin> | undefined;
  const load = (): Promise<Plugin> => {
    pending ??= (async () => {
      let mod: HonoDevServerModule;
      try {
        mod = await import('@hono/vite-dev-server');
      } catch (cause) {
        throw new Error(
          'openElement dev mode requires @hono/vite-dev-server (an optional peer of ' +
            '@openelement/router). Install it into your app to use `deno task dev`: add ' +
            '"@hono/vite-dev-server": "npm:@hono/vite-dev-server@^0.25.3" to the deno.json ' +
            'imports (npm consumers: `npm install --save-dev @hono/vite-dev-server`).',
          { cause },
        );
      }
      return mod.default(options(mod)) as Plugin;
    })();
    return pending;
  };

  const proxy = <H extends ProxiedHook>(hook: H): NonNullable<Plugin[H]> =>
    (async function (this: unknown, ...args: unknown[]) {
      const plugin = await load();
      const candidate = plugin[hook] as unknown;
      const fn = typeof candidate === 'function'
        ? candidate
        : (candidate && typeof candidate === 'object' && 'handler' in candidate
          ? (candidate as { handler: unknown }).handler
          : undefined);
      if (typeof fn !== 'function') return undefined;
      return (fn as (this: unknown, ...hookArgs: unknown[]) => unknown).apply(this, args);
    }) as unknown as NonNullable<Plugin[H]>;

  return {
    name: '@hono/vite-dev-server',
    // The SSR dev server exists only in `vite dev`; builds must not load the peer.
    apply: 'serve',
    config: proxy('config'),
    configResolved: proxy('configResolved'),
    configureServer: proxy('configureServer'),
    handleHotUpdate: proxy('handleHotUpdate'),
  };
}
