/**
 * This is the core build plugin implementation. It is NOT part of the
 * public API. Use `openPipeline()` from the main entry instead.
 *
 * Internal only: called by openPipeline() and the @openelement/router umbrella.
 *
 * This file only COMPOSES: the shared plugin state comes from
 * plugin-config.ts, each hook family lives in its own single-duty module
 * (plugin-config.ts, plugin-scanners.ts, plugin-hmr.ts, plugin-watch.ts,
 * plugin-virtual-modules.ts), and the assembly below fixes the plugin names,
 * the hook set and the returned plugin order.
 */

import type { Plugin } from 'vite';
import type { FrameworkOptions } from './framework.ts';
import type { SsgBehaviorOptions } from '@openelement/protocol/ssg';
import { OpenElementBuildContext } from './build-context.ts';
import { buildPlugin } from './build.ts';
import { islandTransformPlugin } from './island-transform.ts';
import { devIslandClientPlugin } from './dev-island-client.ts';
import { lazyHonoDevServer } from './dev-server.ts';
import { devTailwindPresetPlugin } from './dev-tailwind.ts';
import { mdxPlugin } from './plugin-mdx.ts';
import { createConfigHooks, createOpenPluginState } from './plugin-config.ts';
import { createCompilerHooks } from './plugin-hmr.ts';
import { createBuildStartHook } from './plugin-scanners.ts';
import { createConfigureServerHook } from './plugin-watch.ts';
import { createVirtualEntryPlugin, VIRTUAL_ENTRY_ID } from './plugin-virtual-modules.ts';
import { devStyleAssetPlugin } from './internal/style-assets.ts';

/** Internal-only third argument of {@linkcode createOpenPlugin}. */
export interface CreateOpenPluginInternalOptions {
  /**
   * Whether the caller supplied framework options inline. `openElement()`
   * forwards the user object verbatim, so it can be derived; `openPipeline()`
   * builds a full options object from its own config shape and must state it.
   */
  inlineOptionsPresent?: boolean;
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
 * @param internal - Internal wiring switches (never user-facing)
 * @internal
 */
export function createOpenPlugin(
  options: FrameworkOptions & { ssg?: SsgBehaviorOptions } = {},
  externalCtx?: OpenElementBuildContext,
  internal: CreateOpenPluginInternalOptions = {},
): Plugin[] {
  const state = createOpenPluginState(options, externalCtx, internal);

  const corePlugin: Plugin = {
    name: 'open:core',
    // The transform hook compiles @element modules and must see the authored
    // TSX source: enforce 'pre' so it runs before Vite's builtin TS/JSX
    // lowering (see @openelement/compiler).
    enforce: 'pre',
    ...createConfigHooks(state, options),
    ...createCompilerHooks(state),
    ...createBuildStartHook(state),
    ...createConfigureServerHook(state),
  };

  const virtualEntryPlugin = createVirtualEntryPlugin(state);

  const plugins: Plugin[] = [
    mdxPlugin({ routesDir: state.resolvedOptions.routesDir }),
    corePlugin,
    // the dev half of the island style asset protocol — the
    // compiled-element transform above activates the protocol, and this
    // plugin serves the sheet adapters (inline form; no emitted asset in dev).
    devStyleAssetPlugin(),
    // the dev half of the Tailwind preset (#1582, alpha.12): the same staged
    // entry the build compiles, served as a module through the lazily-mounted
    // `@tailwindcss/vite` peer with a head `<link>` to it. `apply: 'serve'`
    // keeps it out of `vite build` entirely, where the build's own
    // closeBundle delivery owns the preset — the channels never coexist.
    devTailwindPresetPlugin(state),
    virtualEntryPlugin,
  ];

  plugins.push(
    lazyHonoDevServer((honoDevServer) => ({
      entry: VIRTUAL_ENTRY_ID,
      // with middleware.use configured, the entry
      // exposes openElementDevFetch — the dev-server-shaped adapter over the
      // same composed fetch-middleware handler that the start CLI, the e2e
      // fixture server, and the Nitro entry use. Without it, the default
      // export (the WinterCG app, #1560) answers fetch(request, env, ctx)
      // directly, so the dev path is unchanged.
      ...(state.resolvedOptions.middleware?.use?.length ? { export: 'openElementDevFetch' } : {}),
      injectClientScript: true,
      // #951: the upstream exclude regexes test req.url WITH its query
      // string, so vite's versioned module URLs (/.vite/deps/x.js?v=hash —
      // the optimized-dependency form of every bare import in the dev island
      // client graph) fell through to the Hono app and 404'd. Extend the
      // defaults to let versioned module requests reach Vite.
      exclude: [...honoDevServer.defaultOptions.exclude, /\?v=[A-Za-z0-9]+$/],
    })),
  );

  plugins.push(
    islandTransformPlugin(state.resolvedOptions.islandsDir!),
    buildPlugin(state.resolvedOptions, state.ctx),
    // #951: dev-only serving of the island client entry at the same public
    // URL the production build emits (<base>client/islands/client.js).
    devIslandClientPlugin(state.resolvedOptions, state.ctx),
  );

  return plugins;
}
