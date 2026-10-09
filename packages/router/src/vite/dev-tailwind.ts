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
 * The delivery, one seam, request-time:
 *
 * 1. `renderStagedPresetEntry()` — the SAME generated entry the build
 *    compiles (declared layer order + `@import 'tailwindcss'` + the declared
 *    theme/components sources, app-relative paths resolved against the app
 *    root) — is served by the dev server at the contract URL
 *    `/.openElement/tailwind-preset/entry.css`, as a module that exists only
 *    in memory: `resolveId` maps the URL onto the very path the build half
 *    stages its compile input at (so the peer compiler's resolution base for
 *    the entry's relative `@import`s is byte-identical on both channels) and
 *    `load` returns the generated text per request.
 *    The dev channel therefore owns NO file on disk. That is a correctness
 *    requirement, not a preference: the build half's inner vite build runs
 *    with `emptyOutDir: true` against that same directory
 *    (preset-tailwind.ts), so any `vite build` empties
 *    `.openElement/tailwind-preset/` — a disk-backed dev channel died with the
 *    build that happened to run beside it: the document kept linking the URL
 *    and the URL answered 404 until the dev server restarted and re-staged
 *    (the www site's dev/build coexistence, alpha.13 F lane).
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
 * peer, serves no module, writes nothing, and contributes no head fragment.
 * The build delivery is untouched (`apply: 'serve'` vs. `closeBundle`): no
 * artifact can carry both channels.
 *
 * HMR: a `theme.css` edit reaches the browser as a Vite `css-update` for the
 * served entry (the peer registers every scanned/loaded file as a watch
 * file), and the client re-requests the link with a `?t=` stamp, which both
 * `.*\.css$` and `\?t\=\d+$` in the Hono dev server's exclude list let
 * through to Vite (the versioned-module trap the issue names). Freshness rides
 * the peer's own mtime check over the declared sources: the stamped request is
 * a fresh module id, so the compile re-runs and answers the edit.
 */

import process from 'node:process';
import { join } from 'pathe';
import type { Plugin } from 'vite';
import { createLogger } from '@openelement/element';
import {
  renderStagedPresetEntry,
  resolveTailwindPresetOptions,
  tailwindPresetPlugins,
  type TailwindPresetOptions,
} from './preset-tailwind.ts';
import { appendInjectStylesheets, type OpenPluginState } from './plugin-config.ts';

const log = createLogger('router-vite:tailwind-preset-dev');

/** The served entry the build half also compiles, project-relative. */
export const DEV_PRESET_ENTRY = '.openElement/tailwind-preset/entry.css' as const;

/** The public dev URL of the served entry, joined through the Vite `base`. */
export function devPresetEntryHref(base: string): string {
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  return `${cleanBase}${DEV_PRESET_ENTRY}`;
}

/**
 * The absolute path the contract URL maps onto — the same path the build half
 * stages its compile input at. The module behind it is virtual (see
 * {@linkcode devTailwindPresetPlugin}'s `resolveId`/`load`): the path is used
 * for its identity, never for its contents, so a build that deletes it does
 * not disturb the dev channel.
 */
export function devPresetEntryPath(root: string): string {
  return join(root, DEV_PRESET_ENTRY);
}

/** The id without its `?query`/`#hash` suffix (Vite ids are POSIX-normalized). */
function devPresetEntryId(id: string): string {
  const suffix = id.search(/[?#]/);
  return suffix === -1 ? id : id.slice(0, suffix);
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
        : // Null already skipped above, so the object branch cannot be null
          // (and the null check would be a dead comparison for scanners).
          typeof candidate === 'object' && 'handler' in candidate
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
  let entryFile: string | undefined;
  let entryRoot: string | undefined;
  let entryOptions: TailwindPresetOptions | undefined;
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
      // Request-time delivery, decided here because only `configResolved`
      // sees the resolved options: remember the entry's identity (the path the
      // build stages at) and the options the generator needs. Nothing is
      // written — the module's text is produced on each load, so the build
      // half emptying `.openElement/tailwind-preset/` cannot take this channel
      // down (the dev server keeps serving the sheet; see the module header).
      entryOptions = options;
      entryRoot = root;
      entryFile = devPresetEntryPath(root);
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
      // No served-path log line: the debug channel prints by default, and the
      // absolute filesystem path of a module that is not a file is noise no
      // dev can act on — the info line below already names the URL the sheet
      // is served at, which is the fact a dev uses.
      await callPeerHook(plugins, 'configResolved', this, [config]);
    },

    /**
     * Resolve the contract URL onto the entry's identity path — regardless of
     * whether anything exists at that path. A build emptying the staging
     * directory must not turn the URL into a 404 (the alpha.13 F-lane
     * regression); this hook is what keeps the dev channel independent of the
     * disk. Two spellings arrive here: an absolute path (import-graph
     * contexts) and the root-relative URL a document `<link>` / browser
     * refresh asks the dev server for (leading slash; the base middleware
     * strips the prefix first). Both map onto the identity path; the query
     * suffix (`?t=` stamp) rides along verbatim so cache-busting stays exactly
     * as Vite serves it.
     */
    resolveId(id) {
      if (entryFile === undefined || entryRoot === undefined) return;
      const file = devPresetEntryId(id);
      const suffix = id.slice(file.length);
      if (file === entryFile) return entryFile + suffix;
      // Root-relative URL form ('/' + DEV_PRESET_ENTRY, POSIX separators —
      // Vite normalizes request ids before the plugin pipeline).
      if (file.startsWith('/') && join(entryRoot, file.slice(1)) === entryFile) {
        return entryFile + suffix;
      }
      return;
    },

    /**
     * Serve the entry from memory: the same generator the build compiles
     * (`renderStagedPresetEntry`), so dev and build feed one input and a
     * dev/prod comparison diffs only the compile. Deterministic by
     * construction — the text is a pure function of the resolved options and
     * the declared sources — so no cache key is needed beyond Vite's own
     * module graph (a `?t=` request resolves to a fresh module and re-runs the
     * peer's compile, whose mtime check over the declared sources answers the
     * edit).
     */
    load(id) {
      if (entryFile === undefined || entryRoot === undefined || entryOptions === undefined) return;
      if (devPresetEntryId(id) !== entryFile) return;
      return renderStagedPresetEntry(entryRoot, entryOptions);
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
