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
import { islandTransformPlugin, layoutAdmissionFromOptions } from './island-transform.ts';
import { devIslandClientPlugin } from './dev-island-client.ts';
import { lazyHonoDevServer } from './dev-server.ts';
import { devStylePlugin } from './dev-style.ts';
import { devStyleComponentsPlugin } from './dev-style-components.ts';
import { createDevStyleSession } from './internal/dev-style-session.ts';
import { elementStyleLinksPlugin } from './internal/element-style-links.ts';
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
  /**
   * ONE style session for the dev server (alpha15 A05): the document sheet and
   * the component sheet are two views of the same engine, so they compile from
   * the same provider and the same loaded configuration, and a configuration
   * change rebuilds one generator that both channels hear about. Built lazily
   * by the first channel that needs it, since the plan may only become visible
   * after the manifest scan.
   */
  const styleSession = createDevStyleSession(state);

  const plugins: Plugin[] = [
    mdxPlugin({ routesDir: state.resolvedOptions.routesDir }),
    corePlugin,
    // the dev half of the island style asset protocol — the
    // compiled-element transform above activates the protocol, and this plugin
    // serves each authored edge as a real `text/css` dev resource plus the
    // URL-carrying adapters (S-C1.3; no CSS text ever rides a dev module).
    devStyleAssetPlugin(),
    // the dev half of the Tailwind entry: the same generated entry the client
    // build compiles, served as a module through the lazily-mounted
    // `@tailwindcss/vite` peer with a head `<link>` to it. `apply: 'serve'`
    // keeps it out of `vite build` entirely, where the client build's own
    // mount owns the compile. Both channels link through the same head
    // channel, so they still never coexist in one artifact.
    devStylePlugin(state, styleSession),
    // alpha15 S lane (S5-A): the dev channel of the component stylesheet —
    // serves the officially compiled sheet at a stable dev URL, feeds the dev
    // DSD link, and hands the client its shared constructable sheet. Placed
    // before the empty-list fallback so its resolutions win in dev.
    devStyleComponentsPlugin(state, styleSession),
    // alpha15 S lane: the generated SSR/dev entry imports the component
    // stylesheet channel; the build that knows the emitted addresses provides
    // them (the SSG build), and every other channel resolves the empty list.
    elementStyleLinksPlugin([]),
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
    // The layout convention module lives outside islandsDir
    // (`app/layout.tsx`): the gate admits exactly the resolved layout
    // module with its resolved tag (router-convention ↔ element-compile-gate
    // seam, docs/architecture/seams.md).
    islandTransformPlugin(
      state.resolvedOptions.islandsDir!,
      layoutAdmissionFromOptions(state.resolvedOptions.layout),
    ),
    buildPlugin(state.resolvedOptions, state.ctx),
    // #951: dev-only serving of the island client entry at the same public
    // URL the production build emits (<base>client/islands/client.js).
    devIslandClientPlugin(state.resolvedOptions, state.ctx, styleSession),
  );

  return plugins;
}
