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
 * mode runs without it installed, the load fails closed with a stable,
 * classifiable diagnostic naming the package to install. A peer that IS
 * installed but throws while loading gets a different code, so the hint never
 * tells a user to install what is already on disk.
 *
 * The wrapper keeps the upstream plugin name and proxies its four hooks
 * (config / configResolved / configureServer / handleHotUpdate, per
 * dev-server.mjs), so plugin ordering, vite's plugin log and the plugin-list
 * contract the router tests assert are unchanged. `apply: 'serve'` keeps the
 * peer out of `vite build` entirely.
 */

import type { HookHandler, Plugin, ServerHook, ViteDevServer } from 'vite';
import type { DevServerOptions } from '@hono/vite-dev-server';
import type { OpenElementError } from '@openelement/protocol/errors';
import {
  AdapterErrorCode,
  describeError,
  errorCause,
  isMissingPeerError,
  serveError,
} from '../internal/error-codes.ts';
import { installDevHostDelegation } from './internal/dev-host-delegation.ts';

type HonoDevServerModule = typeof import('@hono/vite-dev-server');

const PEER_SPECIFIER = '@hono/vite-dev-server';
const PROXIED_HOOKS = ['config', 'configResolved', 'configureServer', 'handleHotUpdate'] as const;

type ProxiedHook = (typeof PROXIED_HOOKS)[number];
type HookOf<H extends ProxiedHook> = NonNullable<Plugin[H]>;
type HandlerOf<H extends ProxiedHook> = HookHandler<HookOf<H>>;

/**
 * Classify one failed `import('@hono/vite-dev-server')`: only a resolution
 * failure naming the peer itself means the optional package is absent. An
 * installed package that throws while evaluating (or whose transitive import
 * fails) keeps its cause but reports the load-failure code, so `oe dev` never
 * tells the user to install something already on disk.
 */
function devServerLoadError(cause: unknown): OpenElementError {
  if (isMissingPeerError(cause, PEER_SPECIFIER)) {
    return serveError(
      AdapterErrorCode.HONO_DEV_SERVER_MISSING,
      'openElement dev mode requires @hono/vite-dev-server (an optional peer of ' +
        '@openelement/router). Install it into your app to use `oe dev`: add ' +
        '"@hono/vite-dev-server": "^0.25.3" to the package.json dependencies ' +
        '(`npm install --save-dev @hono/vite-dev-server` does the same).',
      { cause: errorCause(cause) },
    );
  }
  return serveError(
    AdapterErrorCode.HONO_DEV_SERVER_LOAD_FAILED,
    'openElement dev mode found @hono/vite-dev-server installed but it failed to load: ' +
      `${describeError(cause)}. The original failure is preserved as the cause; fix the ` +
      'broken install (or the transitive import it reports) instead of reinstalling.',
    { cause: errorCause(cause) },
  );
}

/**
 * One dynamic-dispatch boundary: a Vite hook is either a function or an
 * object hook whose `handler` carries the same signature. The conditional
 * `HandlerOf` keeps each proxied hook's parameters, return value and `this`
 * tied to its own `Plugin` member; only the runtime shape probe is dynamic.
 */
function handlerOf<H extends ProxiedHook>(plugin: Plugin, hook: H): HandlerOf<H> | undefined {
  const candidate: unknown = plugin[hook];
  const handler: unknown =
    typeof candidate === 'function'
      ? candidate
      : candidate !== null && typeof candidate === 'object' && 'handler' in candidate
        ? (candidate as { handler?: unknown }).handler
        : undefined;
  if (typeof handler !== 'function') return undefined;
  return handler as HandlerOf<H>;
}

/**
 * The object-hook meta a peer attached beside `handler` (`order` today, plus
 * any extension Vite/rolldown adds later). Returns `undefined` for a plain
 * function hook — the common case, and the one that must keep working as a
 * bare function — or for a malformed object, whose meta is simply not
 * inherited. Property reads are guarded so a hostile hook object cannot break
 * the lazy load.
 */
function objectHookMeta(candidate: unknown): Record<string, unknown> | undefined {
  if (candidate === null || typeof candidate !== 'object') return undefined;
  let handler: unknown;
  try {
    handler = (candidate as { handler?: unknown }).handler;
  } catch {
    return undefined;
  }
  if (typeof handler !== 'function') return undefined;
  const meta: Record<string, unknown> = {};
  for (const key of Object.keys(candidate)) {
    if (key === 'handler') continue;
    try {
      meta[key] = (candidate as Record<string, unknown>)[key];
    } catch {
      // A hostile accessor is skipped: the stable shape matters more than one
      // exotic meta field.
    }
  }
  return meta;
}

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
        mod = await import(PEER_SPECIFIER);
      } catch (cause) {
        throw devServerLoadError(cause);
      }
      const peer = mod.default(options(mod)) as Plugin;
      adoptPeerHookMeta(peer);
      return peer;
    })();
    return pending;
  };

  /**
   * Wrap one peer hook lazily. The wrapper keeps the hook member's own
   * signature (`this`, arguments, return value) while the module resolution
   * stays deferred until Vite actually invokes the hook.
   */
  const lazyHook = <H extends ProxiedHook>(hook: H): HandlerOf<H> => {
    const lazy = async function (
      this: ThisParameterType<HandlerOf<H>>,
      ...args: Parameters<HandlerOf<H>>
    ): Promise<Awaited<ReturnType<HandlerOf<H>>>> {
      const plugin = await load();
      const handler = handlerOf(plugin, hook);
      if (!handler) return undefined as Awaited<ReturnType<HandlerOf<H>>>;
      // `handlerOf` probes the function/object-hook shape dynamically, so the
      // generic union needs one local narrowing to the hook's own signature
      // before the forwarding call; the signature itself is `HandlerOf<H>`.
      const forward = handler as unknown as (
        this: ThisParameterType<HandlerOf<H>>,
        ...args: Parameters<HandlerOf<H>>
      ) => ReturnType<HandlerOf<H>>;
      return (await forward.apply(this, args)) as Awaited<ReturnType<HandlerOf<H>>>;
    };
    // The single assertion this module needs: the wrapper is a plain function
    // while the hook member is a function-or-object union. Its signature is
    // already the member's own `HandlerOf`.
    return lazy as HandlerOf<H>;
  };

  const peerConfigureServer = lazyHook('configureServer');
  const configureServer: ServerHook = function (
    this: ThisParameterType<ServerHook>,
    server: ViteDevServer,
  ): ReturnType<ServerHook> {
    installDevHostDelegation(server);
    return peerConfigureServer.call(this, server);
  };

  const plugin: Plugin = {
    name: PEER_SPECIFIER,
    // The SSR dev server exists only in `vite dev`; builds must not load the peer.
    apply: 'serve',
    config: lazyHook('config'),
    configResolved: lazyHook('configResolved'),
    // Kept in Vite's pre phase (the peer's own order): Vite's HTML fallback
    // middleware REWRITES `req.url`, so an app middleware running after it
    // would receive the wrong route path. The two delegations a pattern list
    // cannot express run just before the peer's own middleware.
    configureServer,
    handleHotUpdate: lazyHook('handleHotUpdate'),
  };

  /**
   * Preserve the peer hook's OBJECT-HOOK META (Vite's `order`, and any
   * extension a future peer attaches) once the lazy import has resolved: the
   * plugin member becomes `{ ...meta, handler: lazy }` instead of the bare
   * lazy function the constructor installed.
   *
   * Timing is deliberate. Construction cannot know the peer's hook shape
   * without resolving the optional package up front — the exact failure this
   * wrapper exists to prevent — so the peer is inspected at the first real
   * hook call. `config` is the first hook Vite sorts, so its own meta can only
   * be adopted after that sort; every downstream hook
   * (`configResolved` / `configureServer` / `handleHotUpdate`) is sorted later
   * and therefore sees the adopted object hook. Function hooks keep the bare
   * wrapper (the common case and the documented peer shape); a hostile or
   * malformed object simply does not inherit meta.
   */
  function adoptPeerHookMeta(peer: Plugin): void {
    const ownHooks = plugin as unknown as Record<string, unknown>;
    const peerHooks = peer as unknown as Record<string, unknown>;
    const handlers: Record<ProxiedHook, unknown> = {
      config: plugin.config,
      configResolved: plugin.configResolved,
      configureServer: plugin.configureServer,
      handleHotUpdate: plugin.handleHotUpdate,
    };
    for (const hook of PROXIED_HOOKS) {
      let meta: Record<string, unknown> | undefined;
      try {
        meta = objectHookMeta(peerHooks[hook]);
      } catch {
        meta = undefined;
      }
      if (!meta) continue;
      ownHooks[hook] = { ...meta, handler: handlers[hook] };
    }
  }

  return plugin;
}
