/**
 * @openelement/router/vite - Tailwind preset, DEV half (#1582, alpha.12).
 *
 * The preset's build half (preset-tailwind.ts, #1505) delivers the compiled
 * theme as a linked asset; the dev pipeline never read `tailwind` at all, so
 * `pnpm dev` on the alpha.11 starter rendered every `var(--paper/--ink/
 * --brand/…)` empty (issue #1582: the authored `@theme` block is an unknown
 * at-rule to the browser — only the Tailwind compile turns the roles into
 * real custom properties, which is exactly why the build output was colored).
 * Dev must deliver the COMPILED theme; serving the authored sheet verbatim
 * cannot work (the ruled-out approaches in #1582).
 *
 * The delivery, one seam:
 *
 * 1. `renderStagedPresetEntry()` — the SAME generated entry the build
 *    compiles (declared layer order + `@import 'tailwindcss'` + the declared
 *    theme/components sources, app-relative paths resolved against the app
 *    root) — is staged under `.openElement/tailwind-preset/entry.css` and
 *    served by the dev server as a module.
 * 2. `@tailwindcss/vite` is mounted into the dev css channel through a
 *    delegating wrapper (the peer is optional and resolved lazily, like the
 *    build half and like `@hono/vite-dev-server`): a plugin returned from a
 *    `config` hook would be ignored by Vite 8 (user plugins are flattened
 *    before the `config` hook runs — verified against vite 8.0.16), so the
 *    peer's hooks are proxied from one `apply: 'serve'` plugin instead.
 * 3. The dev document head carries `<link rel="stylesheet">` to that URL,
 *    joined through the resolved `base`. The head precedes every page
 *    `@scope` style by construction (page static styles are emitted into the
 *    body's markup), so the tokens are available before page styles evaluate
 *    — the same relation the build's head link has.
 *
 * OFF stays OFF: with no `tailwind` key the plugin resolves nothing, loads no
 * peer, writes no staging file, and contributes no head fragment. The build
 * delivery is untouched (`apply: 'serve'` vs. `closeBundle`): no artifact can
 * carry both channels.
 *
 * HMR: a `theme.css` edit reaches the browser as a Vite `css-update` for the
 * staged entry (the peer registers every scanned/loaded file as a watch
 * file), and the client re-requests the link with a `?t=` stamp, which both
 * `.*\.css$` and `\?t\=\d+$` in the Hono dev server's exclude list let
 * through to Vite (the versioned-module trap the issue names).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { join } from 'pathe';
import type { Plugin } from 'vite';
import { createLogger } from '@openelement/element';
import {
  presetStagingDir,
  renderStagedPresetEntry,
  resolveTailwindPresetOptions,
  tailwindPresetPlugins,
  type TailwindPresetOptions,
} from './preset-tailwind.ts';
import { appendInjectStylesheets, type OpenPluginState } from './plugin-config.ts';

const log = createLogger('router-vite:tailwind-preset-dev');

/** The staged entry the build half also compiles, project-relative. */
export const DEV_PRESET_ENTRY = '.openElement/tailwind-preset/entry.css' as const;

/** The public dev URL of the staged entry, joined through the Vite `base`. */
export function devPresetEntryHref(base: string): string {
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  return `${cleanBase}${DEV_PRESET_ENTRY}`;
}

/**
 * Stage the dev entry under `.openElement/tailwind-preset/`. Text-identical to
 * the build staging (one generator), so a dev/prod comparison diffs only the
 * compile, never the input.
 */
export function stageDevPresetEntry(
  root: string,
  options: TailwindPresetOptions,
): { dir: string; entryPath: string } {
  const dir = presetStagingDir(root);
  mkdirSync(dir, { recursive: true });
  const entryPath = join(dir, 'entry.css');
  writeFileSync(entryPath, renderStagedPresetEntry(root, options), 'utf8');
  return { dir, entryPath };
}

/** The peer's plugin hooks this wrapper proxies. */
type ProxiedHook = 'configResolved' | 'configureServer' | 'transform' | 'hotUpdate';

/**
 * The peer plugins that apply to the dev command. The peer ships one plugin
 * per command (`@tailwindcss/vite:generate:serve` / `:generate:build`, each
 * with an `apply`), and Vite filters those itself — but this wrapper calls
 * hooks directly, so it owes the same filter. Without it the build variant's
 * transform would run in dev too, minifying the served sheet and registering
 * duplicate watch files.
 */
function applicablePlugins(plugins: readonly Plugin[], mode: string): Plugin[] {
  const env = { command: 'serve' as const, mode };
  return plugins.filter((plugin) => {
    if (!plugin.apply) return true;
    if (typeof plugin.apply === 'function') {
      return plugin.apply({ mode } as never, env);
    }
    return plugin.apply === 'serve';
  });
}

/**
 * Call one peer hook, preserving the peer's own plugin order: a hook that
 * returns nothing is skipped rather than treated as "no transform", so a later
 * peer plugin's result wins.
 */
async function callPeerHook(
  plugins: readonly Plugin[],
  hook: ProxiedHook,
  context: unknown,
  args: unknown[],
): Promise<unknown> {
  let result: unknown;
  for (const plugin of plugins) {
    // Typed as unknown on purpose: the hook property's declared union trips
    // code scanning when truthiness-narrowed, and only function/object/absent
    // shapes reach the checks below anyway.
    const candidate: unknown = plugin[hook];
    if (candidate === null || candidate === undefined) continue;
    const fn =
      typeof candidate === 'function'
        ? candidate
        : typeof candidate === 'object' && candidate !== null && 'handler' in candidate
          ? (candidate as { handler: unknown }).handler
          : undefined;
    if (typeof fn !== 'function') continue;
    const value = await (fn as (this: unknown, ...hookArgs: unknown[]) => unknown).apply(
      context,
      args,
    );
    if (value !== undefined) result = value;
  }
  return result;
}

/**
 * The dev pipeline's half of the Tailwind preset. Always present in the plugin
 * list (the list is fixed at `openElement()` call time while the `tailwind`
 * key may live in `openelement.config.ts`, resolved later), and inert until
 * {@linkcode resolveTailwindPresetOptions} answers with options — so a
 * preset-less app pays one resolved-options read and nothing else, and the
 * optional peer is never loaded.
 */
export function devTailwindPresetPlugin(state: OpenPluginState): Plugin {
  let peer: Plugin[] | undefined;
  let entryUrl: string | undefined;
  const loadPeer = async (mode: string): Promise<Plugin[]> =>
    (peer ??= applicablePlugins(await tailwindPresetPlugins(), mode));

  return {
    name: 'open:tailwind-preset-dev',
    // The build's preset delivery owns `build`; the two channels never
    // coexist, which is what makes "no double injection" structural.
    apply: 'serve',
    // The peer's dev half is `enforce: 'pre'` and compiles the css before
    // vite's own css plugin reads it; the wrapper takes the same seat.
    enforce: 'pre',

    async configResolved(config) {
      const options = resolveTailwindPresetOptions(state.resolvedOptions.tailwind);
      if (!options) return;
      const root = config.root ?? process.cwd();
      stageDevPresetEntry(root, options);
      // Fail closed at dev start rather than on the first css request: a
      // preset-enabled dev server that cannot compile is an error, never a
      // silently unstyled page (the #1582 symptom).
      const plugins = await loadPeer(config.mode);
      const base = config.base ?? '/';
      entryUrl = devPresetEntryHref(base);
      // The link rides the structured stylesheet channel, so the framework's
      // one `<link>` serializer builds it and the href passes the protocol
      // blocklist. Idempotent across Vite's config re-resolution (a dev server
      // restart re-runs configResolved on the same plugin instance).
      appendInjectStylesheets(state, [entryUrl]);
      // No staging-path log line: the debug channel prints by default, and the
      // absolute filesystem path of a build-internal file is noise no dev can
      // act on — the info line below already names the URL the sheet is served
      // at, which is the fact a dev uses.
      await callPeerHook(plugins, 'configResolved', this, [config]);
    },

    async configureServer(server) {
      if (!peer) return;
      // The channel verdict, stated where a dev run shows it: tokens ride the
      // compiled theme sheet, and the build-side bundle link is build-only.
      log.info(
        `tailwind preset active — tokens ride the compiled theme sheet (${entryUrl}); ` +
          'the build-side bundle link stays build-only',
      );
      await callPeerHook(peer, 'configureServer', this, [server]);
    },

    async transform(code, id) {
      if (!peer) return;
      return (await callPeerHook(peer, 'transform', this, [code, id])) as string | undefined;
    },

    async hotUpdate(context) {
      if (!peer) return;
      await callPeerHook(peer, 'hotUpdate', this, [context]);
    },
  };
}
