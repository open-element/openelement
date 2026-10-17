/**
 * @openelement/router/vite - the style entry's dev channel (alpha15 S lane;
 * the provider port's dev half, stage 2B).
 *
 * Dev must deliver the COMPILED stylesheet: an authored `@theme` block is an
 * unknown at-rule to the browser, and the role aliases seated on it stay empty
 * until the entry passes through the engine's compile (#1582). The delivery
 * follows the selected engine:
 *
 * - `graph-entry` (Tailwind): the same entry the client build compiles
 *   ({@linkcode renderTailwindEntry}) is served at the contract URL
 *   `/.openElement/tailwind.css` and linked from the document head through the
 *   framework's one structured stylesheet channel, so dev and build deliver
 *   one compiled fact. The peer's hooks are proxied rather than mounted,
 *   because `@tailwindcss/vite` is an optional peer resolved lazily and Vite 8
 *   flattens user plugins before the `config` hook runs (verified against
 *   vite 8.0.16).
 * - `generated` (UnoCSS): the engine compiles the document sheet from its own
 *   resolved configuration and candidates, and the dev server serves that text
 *   from a real `text/css` endpoint (`no-store`, versioned URL) which the head
 *   links. Nothing enters Vite's module graph, so no dev style-injector ever
 *   writes a `<style>` node.
 *
 * OFF stays OFF in both cases: with no declaration and no admitted requirement
 * the plugin resolves nothing, loads no peer, serves no module and contributes
 * no head fragment.
 *
 * HMR: on the Tailwind path the peer registers every scanned/loaded file as a
 * watch file, so a `theme.css` edit reaches the browser as a Vite `css-update`
 * for the served entry, and the client re-requests the link with a `?t=` stamp,
 * which both `.*\.css$` and `\?t\=\d+$` in the Hono dev server's exclude list
 * let through to Vite (the versioned-module trap #1582 names). On the generated
 * path the sheet is outside Vite's CSS graph, so a change that can move it
 * bumps the served version, re-points the head link and asks for one reload —
 * the same contract (no stale styles, no runtime DOM write) with an explicit
 * cost.
 */

import process from 'node:process';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { createLogger } from '@openelement/element';
import {
  renderTailwindEntry,
  tailwindEntryModuleId,
  tailwindEntryUrl,
  tailwindPlugins,
} from './tailwind.ts';
import { setFrameworkStylesheets, type OpenPluginState } from './plugin-config.ts';
import { RESOLVED_ENTRY_ID } from './plugin-virtual-modules.ts';
import { generateEntry } from './plugin-scanners.ts';
import { stylePlanForApp, type ResolvedStyleSelection } from './internal/style-plan.ts';
import type { DevStyleSession } from './internal/dev-style-session.ts';

const log = createLogger('router-vite:style-dev');

/** The peer's plugin hooks this wrapper proxies. */
type ProxiedHook = 'configResolved' | 'configureServer' | 'transform' | 'hotUpdate';

/**
 * The peer plugins that apply to the dev command. Without this filter the
 * build variant's transform would run in dev too, minifying the served sheet
 * and registering duplicate watch files.
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
        : typeof candidate === 'object' && 'handler' in candidate
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
 * The public dev URL of a generated document sheet. The version segment makes
 * every content-moving change a new resource; production keeps its single
 * content-addressed asset — the dev URL is not part of the built contract.
 */
function devDocumentSheetUrl(base: string, engine: string, version: string): string {
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  return `${cleanBase}.openElement/${engine}-document.${version}.css`;
}

/** A short stable digest of one compile's identity (dev cache busting). */
function versionDigest(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * The dev pipeline's half of the style entry. Always present in the plugin
 * list (the list is fixed at `openElement()` call time while the declaration
 * may live in `openelement.config.ts`, and a package requirement is only
 * visible after the manifest scan), and inert until the resolved PLAN exists —
 * so a style-less app pays one plan read and nothing else, and no engine's
 * package is ever loaded.
 */
export function devStylePlugin(state: OpenPluginState, session: DevStyleSession): Plugin {
  let peer: Plugin[] | undefined;
  let entryRoot: string | undefined;
  let entryOptions: ResolvedStyleSelection | undefined;
  let resolvedConfig: ResolvedConfig | undefined;
  /** The generated-document dev state (UnoCSS), built once in `configureServer`. */
  let generated:
    | {
        readonly url: () => string;
        readonly css: () => Promise<string>;
        readonly relevantChange: (file: string) => boolean;
      }
    | undefined;
  const loadPeer = async (mode: string): Promise<Plugin[]> =>
    (peer ??= applicablePlugins(await tailwindPlugins(), mode));

  return {
    name: 'open:style-dev',
    apply: 'serve',
    // The peer's dev half is `enforce: 'pre'` and compiles the CSS before
    // Vite's own css plugin reads it; the wrapper takes the same seat.
    enforce: 'pre',

    configResolved(config) {
      // The entry's identity is known now; whether the pipeline EXISTS is
      // decided in `configureServer` below, where a declared package
      // requirement is visible — the manifest scan runs in
      // `open:core`'s configureServer, which Vite calls before this plugin's.
      entryRoot = config.root ?? process.cwd();
      resolvedConfig = config;
      session.setRoot(entryRoot);
    },

    /**
     * Resolve the contract URL — and the entry's own module path — onto the
     * virtual entry's identity. Two spellings arrive here: an absolute path
     * (import-graph contexts) and the root-relative URL a document `<link>` /
     * browser refresh asks the dev server for (leading slash; the base
     * middleware strips the prefix first). Both map onto the identity path;
     * the `?t=` stamp rides along verbatim so cache-busting stays exactly as
     * Vite serves it. A generated-document provider serves no graph module.
     */
    resolveId(id) {
      if (entryRoot === undefined || entryOptions?.provider !== 'tailwind') return;
      return tailwindEntryModuleId(entryRoot, id);
    },

    /**
     * Serve the entry from memory: the same generator the client build
     * compiles, so dev and build feed one input and a dev/prod comparison
     * diffs only the compile. Deterministic by construction — the text is a
     * pure function of the resolved options — so no cache key is needed beyond
     * Vite's own module graph (a `?t=` request resolves to a fresh module and
     * re-runs the peer's compile, whose watch registration answers source
     * edits).
     */
    load(id) {
      if (entryRoot === undefined || entryOptions?.provider !== 'tailwind') return;
      if (tailwindEntryModuleId(entryRoot, id) !== id) return;
      return renderTailwindEntry(entryRoot, entryOptions);
    },

    async configureServer(server: ViteDevServer) {
      if (resolvedConfig === undefined || entryRoot === undefined) return;
      // The package manifest scan already ran (`open:core`'s configureServer,
      // which Vite calls before this hook), so a declared requirement is
      // visible here. Only a real plan contributes the head link; a style-less
      // app pays one plan read and nothing else.
      const plan = stylePlanForApp(
        state.ctx,
        entryRoot,
        state.resolvedOptions.tailwind,
        state.resolvedOptions.unocss,
      );
      if (!plan) return;
      entryOptions = plan;
      const base = server.config.base ?? '/';

      if (plan.provider === 'tailwind') {
        // Fail closed at dev start rather than on the first css request: a
        // Tailwind-enabled dev server that cannot compile is an error, never a
        // silently unstyled page (the #1582 symptom).
        const plugins = await loadPeer(server.config.mode);
        // The link rides the structured stylesheet channel, so the framework's
        // one `<link>` serializer builds it and the href passes the protocol
        // blocklist. Idempotent across Vite's config re-resolution: the setter
        // re-points the framework's own link instead of accumulating one.
        setFrameworkStylesheets(state, [tailwindEntryUrl(base)]);
        await callPeerHook(plugins, 'configResolved', this, [server.config]);
        // The channel verdict, stated where a dev run shows it.
        log.info(
          `tailwind entry active — the compiled stylesheet is served at ` +
            `${tailwindEntryUrl(base)} and linked in the document head`,
        );
        await callPeerHook(plugins, 'configureServer', this, [server]);
        return;
      }

      // A generated-document engine: the sheet is real CSS by the time it
      // exists, so the dev server serves it from a `text/css` endpoint and the
      // head links it — no module graph, no style injector. The integration
      // comes from the dev server's one style session, so this channel and the
      // component sheet compile from the same loaded configuration.
      const integration = await session.resolve();
      if (integration === undefined) return;
      session.attach(server);
      let version = versionDigest(`${plan.provider}#0`);
      const url = (): string => devDocumentSheetUrl(base, plan.provider, version);
      const css = async (): Promise<string> => {
        const compile = session.current()?.provider.compileDocument;
        if (compile === undefined) return '';
        return await compile({
          candidates: state.classCandidates.allLight(),
          sources: new Map(),
        });
      };
      const sourceIdentity = JSON.stringify({
        theme: plan.theme,
        documentReset: plan.documentReset,
        candidates: state.classCandidates.all(),
      });
      generated = {
        url,
        css,
        // The engine's configuration inputs are NOT this channel's business:
        // the session watches them and calls back through
        // `onConfigurationChange` below, which is what keeps one rebuild with
        // two listeners rather than two channels racing to discover it.
        relevantChange: (file) =>
          /\.(?:tsx|css)$/.test(file) || plan.theme.some((source) => file.endsWith(source)),
      };
      server.middlewares.use(async (request, response, next) => {
        const path = (request.url ?? '').split('?', 1)[0];
        if (path === undefined || !/\.openElement\/[a-z0-9-]+-document\.[^./]+\.css$/.test(path)) {
          next();
          return;
        }
        try {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/css; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(await css());
        } catch (error) {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(
            `[openElement] ${plan.provider} document stylesheet compile failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      });
      setFrameworkStylesheets(state, [url()]);
      log.info(
        `${plan.provider} document entry active — the compiled stylesheet is served at ` +
          `${url()} and linked in the document head`,
      );
      /**
       * A change that can move the sheet (an admitted candidate, a declared
       * theme source, or the engine's own configuration) re-points the head
       * link and asks for one reload. The sheet is outside Vite's CSS graph, so
       * there is no `css-update` to send for it; a reload is the honest cost of
       * "no stale styles" and is never a runtime DOM write.
       */
      const moveVersion = (): void => {
        version = versionDigest(`${sourceIdentity}#${Date.now()}`);
        setFrameworkStylesheets(state, [url()]);
        // The served link is baked twice: applyResolvedOptions (called above)
        // refreshes state.headExtrasValue, but the entry DESCRIPTOR captured
        // the old value and the virtual entry module renders from the
        // descriptor. Rebuild the descriptor from the phase-1 scan facts (the
        // #1028 rescan sequence minus the filesystem rescan — the only fact
        // that moved is the stylesheet hrefs) and invalidate the entry module
        // so the dev server re-evaluates it on the next request.
        generateEntry(
          state,
          state.ctx.phase1.cachedRoutes ?? [],
          state.ctx.phase1.islandTagNames,
          state.ctx.phase1.packageManifests,
          state.ctx.phase1.islandFiles,
        );
        if (state.entryDescriptor) {
          state.ctx.phase1.ssrAdmissionPlan = state.entryDescriptor.ssrAdmissionPlan;
        }
        const entry = server.moduleGraph.getModuleById(RESOLVED_ENTRY_ID);
        if (entry) server.moduleGraph.invalidateModule(entry);
        server.ws.send({ type: 'full-reload' });
      };
      // The engine's configuration moved: the generator was rebuilt by the
      // session, so this sheet's serves are stale at the URL the document
      // already declares — re-point the link and ask for the one reload the
      // generated path costs.
      session.onConfigurationChange(moveVersion);
      let lastIdentity = sourceIdentity;
      server.watcher.on('change', (file) => {
        if (!generated?.relevantChange(file)) return;
        const now = JSON.stringify({
          theme: plan.theme,
          documentReset: plan.documentReset,
          candidates: state.classCandidates.all(),
        });
        if (now === lastIdentity) return;
        lastIdentity = now;
        moveVersion();
      });
      server.watcher.on('unlink', (file) => {
        if (!generated?.relevantChange(file)) return;
        moveVersion();
      });
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
