/**
 * Framework-option resolution and the `config`/`configResolved` hooks of the
 * open build plugin (issue #1473 extraction).
 *
 * This module owns the shared {@linkcode OpenPluginState}: the resolved
 * options, the serialized head channel, the config-file resolution, and the
 * plugin-creation-time workspace-alias setup. The other plugin-*.ts modules
 * read and mutate this state through their hooks; plugin.ts only composes.
 * Moved out of plugin.ts verbatim: hook behavior is unchanged.
 */

import { type Alias, type ConfigEnv, loadConfigFromFile, type Plugin } from 'vite';
import type { FrameworkOptions } from './internal/protocol/framework.ts';
import type { SsgBehaviorOptions } from './internal/protocol/ssg.ts';

import { formatError } from '@openelement/element';
import { createLogger } from '@openelement/element';
import { hasInlineFrameworkOptions } from '../config.ts';
import { normalizeViteAliases } from './alias-utils.ts';
import { detectAppConfigFile, resolveAppConfig } from './app-config.ts';
import { resolveHeadConvention } from './head-convention.ts';
import { buildHeadExtras } from './head-injection.ts';
import {
  buildCriticalHeadExtras,
  minifyCriticalStyleBlocks,
} from './internal/ssg/critical-assets.ts';
import {
  CHUNK_SIZE_WARNING_LIMIT_KB,
  DEFAULT_COMPONENTS_DIR,
  DEFAULT_ISLANDS_DIR,
  DEFAULT_ROUTES_DIR,
} from './internal/paths.ts';
import { OpenElementBuildContext } from './build-context.ts';
import type { EntryDescriptor } from './internal/ssg/index.ts';
import { generateEntry } from './plugin-scanners.ts';
import { VIRTUAL_BUILD_TRIGGER_ID } from './plugin-virtual-modules.ts';
import {
  detectWorkspaceAliasHijack,
  findWorkspaceRoot,
  generateWorkspaceAliases,
  workspaceAliasHijackError,
} from './workspace-alias.ts';

const log = createLogger('router-vite');

type AliasOptionsInput = Record<string, string> | Alias[] | null | undefined;

function mergeAliasOptions(
  primary: AliasOptionsInput,
  fallback: AliasOptionsInput,
): Record<string, string> | Alias[] | null {
  if (!primary) return fallback ?? null;
  if (!fallback) return primary;

  const merged: Alias[] = [];
  const append = (aliases: AliasOptionsInput): void => {
    if (!aliases) return;
    if (Array.isArray(aliases)) {
      merged.push(...aliases);
      return;
    }
    for (const [find, replacement] of Object.entries(aliases)) {
      merged.push({ find, replacement });
    }
  };

  append(primary);
  append(fallback);
  return merged;
}

/**
 * Build the validated legacy head channel, then prepend the opt-in alpha.4
 * critical-assets channel. Both become one immutable document artifact; no
 * runtime renderer or client fallback is introduced by the convention.
 */
function computeHeadExtras(options: FrameworkOptions): {
  headExtras: string | undefined;
  allowHeadExtrasScripts: boolean;
} {
  const legacyHead = buildHeadExtras(options);
  const criticalHead = buildCriticalHeadExtras(options);
  const headExtrasParts = [
    criticalHead.headExtras,
    legacyHead.headExtras ? minifyCriticalStyleBlocks(legacyHead.headExtras) : undefined,
  ].filter((part): part is string => Boolean(part));
  return {
    headExtras: headExtrasParts.length > 0 ? headExtrasParts.join('\n  ') : undefined,
    allowHeadExtrasScripts:
      legacyHead.allowHeadExtrasScripts || criticalHead.allowHeadExtrasScripts,
  };
}

/**
 * The head-input view of a resolved options object: everything the user
 * configured, with the plugin's own serialized output replaced by the user's
 * raw `headExtras` (see the note in createOpenPlugin).
 */
function paramsFromRawHead(
  options: FrameworkOptions,
  rawHeadExtras: string | undefined,
): FrameworkOptions {
  return { ...options, headExtras: rawHeadExtras };
}

/**
 * The mutable per-plugin-instance state the open build plugin's hooks share.
 * Each plugin-*.ts module owns its hooks and reads/mutates exactly this data;
 * nothing else is shared between the modules.
 */
export interface OpenPluginState {
  /** The shared build context every phase reads and mutates. */
  readonly ctx: OpenElementBuildContext;
  /**
   * The validated options with the directory/head defaults applied. Captured
   * by reference by every downstream plugin, so the config-file resolution
   * can merge in place (see applyResolvedOptions).
   */
  readonly resolvedOptions: FrameworkOptions & {
    allowHeadExtrasScripts?: boolean;
    ssg?: SsgBehaviorOptions;
  };
  /**
   * `resolvedOptions.headExtras` is the plugin's SERIALIZED head channel
   * (head fragments + structured stylesheets/scripts). It is output, not
   * input: a re-validation pass must never see it, or the `<script>` tags
   * this plugin generates from `inject.scripts` would be rejected as raw user
   * markup (this repository's own site vite config is exactly that shape).
   * Keep the user's raw `headExtras` string separately as the only
   * re-validation input.
   */
  rawHeadExtras: string | undefined;
  headExtrasValue: string | undefined;
  allowHeadExtrasValue: boolean;
  /**
   * Whether the caller supplied framework options inline. `openElement()`
   * forwards the user object verbatim, so it can be derived; `openPipeline()`
   * builds a full options object from its own config shape and must state it.
   */
  readonly inlineOptionsPresent: boolean;
  // Vite's command for this run ('build' | 'serve'). Drives the dev/production
  // split of the default-CORS advisory (#1411).
  produceMode: 'build' | 'serve';
  resolvedConfigFile: string | null;
  // The element compiler records a logical source identity in the Part Program
  // (metadata.sourceFile / sourceMap.file). Passing Vite's absolute module id
  // embedded the build machine's path in client and SSR output and made chunk
  // bytes depend on the checkout location. Use a project-relative POSIX id
  // instead, matching the packed staging compiler's basename identity.
  viteRoot: string | undefined;
  workspaceRoot: string | undefined;
  // alpha.17 B1: the entry descriptor is instantiated once per buildStart and
  // shared between the emitted virtual entry code (renderEntry) and
  // ctx.phase1.ssrAdmissionPlan. Previously the descriptor was built twice
  // with divergent options (the plan saw CEM classifications, the emitted
  // entry did not).
  entryDescriptor: EntryDescriptor | null;
}

function applyResolvedOptions(state: OpenPluginState, merged: FrameworkOptions): void {
  if (merged.headExtras !== undefined) state.rawHeadExtras = merged.headExtras;
  Object.assign(state.resolvedOptions, merged);
  Object.assign(state.ctx.options, merged);
  // Options that PROJECT into plugin state (the locale declaration) must be
  // re-derived here: the context was constructed before the config file
  // resolved, so its constructor-time derivation would keep the pre-file
  // value and the build would emit a single-locale site.
  state.ctx.refreshDerivedState();
  const head = computeHeadExtras(paramsFromRawHead(state.resolvedOptions, state.rawHeadExtras));
  state.headExtrasValue = head.headExtras;
  state.allowHeadExtrasValue = head.allowHeadExtrasScripts;
  state.resolvedOptions.headExtras = state.headExtrasValue;
  state.resolvedOptions.allowHeadExtrasScripts = state.allowHeadExtrasValue;
}

/**
 * #1411: `openelement.config.ts` is the framework options' single home. The
 * file is loaded through Vite's own TS config loader (native Deno import —
 * zero new dependencies), so dev, `cli/build` and the SSG phases read one
 * options object, and an edit to it re-resolves the build.
 */
function appConfigPath(root: string): string | null {
  return detectAppConfigFile(root);
}

async function resolveAndApplyAppConfig(
  state: OpenPluginState,
  options: FrameworkOptions & { ssg?: SsgBehaviorOptions },
  root: string,
  env: {
    command: 'build' | 'serve';
    mode: string;
  },
): Promise<void> {
  state.produceMode = env.command;
  state.resolvedConfigFile = appConfigPath(root);
  let importedConfig: unknown;
  if (state.resolvedConfigFile !== null) {
    const loaded = await loadConfigFromFile(
      {
        mode: env.mode,
        command: env.command,
        isSsrBuild: false,
        isPreview: false,
      } as ConfigEnv,
      state.resolvedConfigFile,
      root,
      'silent',
      undefined,
      'native',
    );
    importedConfig = loaded?.config;
  }
  const resolved = resolveAppConfig({
    root,
    configFile: state.resolvedConfigFile,
    importedConfig,
    inlineOptions: options as Record<string, unknown>,
    inlineOptionsPresent: state.inlineOptionsPresent,
  });
  applyResolvedOptions(state, resolved.options);
  // The `app/head.tsx` convention is structural head content: it is compiled
  // through the app's own module graph (a `?inline` CSS import cannot load
  // through the config-file loader) and appended to the head channel AFTER
  // the resolved options are in place, so its fragments land in the same
  // serialized artifact as every other head entry.
  if (resolved.headConventionFile !== null) {
    const fragments = await resolveHeadConvention({
      root,
      relativePath: resolved.headConventionFile,
    });
    applyResolvedOptions(state, {
      inject: {
        ...state.resolvedOptions.inject,
        headFragments: [...(state.resolvedOptions.inject?.headFragments ?? []), ...fragments],
      },
    });
  }
  if (resolved.conventions.length > 0) {
    log.info(
      `openelement.config.ts conventions: ${resolved.conventions
        .map((use) => `${use.path} (${use.provides})`)
        .join(', ')}`,
    );
  }
}

/**
 * Build the shared plugin state for one {@linkcode createOpenPlugin} call:
 * the resolved options, the serialized head channel, the build context, and
 * the plugin-creation-time workspace-alias setup. Runs the exact setup
 * sequence createOpenPlugin always ran, in the same order.
 */
export function createOpenPluginState(
  options: FrameworkOptions & { ssg?: SsgBehaviorOptions } = {},
  externalCtx?: OpenElementBuildContext,
  internal: { inlineOptionsPresent?: boolean } = {},
): OpenPluginState {
  const rawHeadExtras: string | undefined = options.headExtras;
  const initialHead = computeHeadExtras(paramsFromRawHead(options, rawHeadExtras));
  const headExtrasValue = initialHead.headExtras;
  const allowHeadExtrasValue = initialHead.allowHeadExtrasScripts;

  const resolvedOptions: FrameworkOptions & {
    allowHeadExtrasScripts?: boolean;
    ssg?: SsgBehaviorOptions;
  } = {
    ...options,
    routesDir: options.routesDir || DEFAULT_ROUTES_DIR,
    islandsDir: options.islandsDir || DEFAULT_ISLANDS_DIR,
    componentsDir: options.componentsDir || DEFAULT_COMPONENTS_DIR,
    headExtras: headExtrasValue,
    allowHeadExtrasScripts: allowHeadExtrasValue,
  };

  const inlineOptionsPresent =
    internal.inlineOptionsPresent ?? hasInlineFrameworkOptions(options as Record<string, unknown>);

  const ctx = externalCtx || new OpenElementBuildContext(resolvedOptions);

  // #1415 Finding A: an app scaffolded inside a framework checkout declares
  // registry versions that the workspace aliases below would silently replace
  // with the checkout's sources — a build that reports success while resolving
  // a different framework version. Refuse before any alias is generated.
  const hijack = detectWorkspaceAliasHijack(Deno.cwd());
  if (hijack) throw workspaceAliasHijackError(hijack);

  // Pre-generate workspace aliases (sync, once, cached in ctx).
  // Phase 1 config, Phase 2 client build, and Phase 3 SSG build
  // all read ctx.phase1.userResolveAlias - zero redundant generation.
  let workspaceRoot: string | undefined;
  try {
    const wsRoot = findWorkspaceRoot(Deno.cwd());
    workspaceRoot = wsRoot ?? undefined;
    if (wsRoot) {
      ctx.phase1.userResolveAlias = generateWorkspaceAliases(wsRoot);
      log.info(
        `Auto-generated ${
          (ctx.phase1.userResolveAlias as Array<unknown>).length
        } resolve alias(es) from workspace`,
      );
    }
  } catch (e) {
    log.debug('Workspace not available - aliases stay null', e);
  }

  return {
    ctx,
    resolvedOptions,
    rawHeadExtras,
    headExtrasValue,
    allowHeadExtrasValue,
    inlineOptionsPresent,
    produceMode: 'build',
    resolvedConfigFile: null,
    viteRoot: undefined,
    workspaceRoot,
    entryDescriptor: null,
  };
}

/** Create the `config`/`configResolved` hooks of `open:core` over the state. */
export function createConfigHooks(
  state: OpenPluginState,
  options: FrameworkOptions & { ssg?: SsgBehaviorOptions },
): Pick<Plugin, 'config' | 'configResolved'> {
  return {
    async config(userConfig, env) {
      if (userConfig.resolve?.alias) {
        state.ctx.phase1.userResolveAlias = mergeAliasOptions(
          userConfig.resolve.alias as Record<string, string> | Alias[],
          state.ctx.phase1.userResolveAlias,
        );
      }

      const aliases = state.ctx.phase1.userResolveAlias as Alias[] | Record<string, string> | null;
      const normalizedAliases = normalizeViteAliases(aliases, Deno.cwd());
      if (normalizedAliases) {
        state.ctx.phase1.userResolveAlias = normalizedAliases;
      }

      // #1411: resolve `openelement.config.ts` + the file conventions before
      // the aliases are frozen into this hook's return value, so the resolved
      // options are visible to every later phase (SSG, client build) and to
      // the plugin closure itself. The project root is the process cwd — the
      // same anchor routesDir/islandsDir use.
      try {
        await resolveAndApplyAppConfig(state, options, Deno.cwd(), {
          command: env?.command === 'serve' ? 'serve' : 'build',
          mode: env?.mode ?? 'production',
        });
      } catch (error) {
        // A config-file failure is a build failure, never a warning: the
        // resolution is fail-closed by design (P6). Unit harnesses invoke this
        // hook directly (no Vite plugin context), so `this.error` is optional.
        const fail = (this as { error?: (message: string) => never } | undefined)?.error;
        if (typeof fail === 'function') fail.call(this, formatError(error));
        throw error;
      }

      return {
        resolve: normalizedAliases ? { alias: normalizedAliases } : undefined,
        // Chokidar's fs.watch backend drops consecutive change events within
        // 50ms. A quick fix after a syntax error can otherwise leave Vite's
        // SSR error cached forever (the packed Lit consumer on Linux).
        // Use its native write-stability queue, which delivers the final
        // write instead of throttling it away. Explicit watcher settings win.
        ...(userConfig.server?.watch === null ||
        userConfig.server?.watch?.awaitWriteFinish !== undefined
          ? {}
          : {
              server: {
                watch: { awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 } },
              },
            }),
        build: {
          // The generated virtual entry intentionally contains the whole route graph.
          // Keep the budget explicit so Vite does not report it as an unexpected warning.
          chunkSizeWarningLimit: CHUNK_SIZE_WARNING_LIMIT_KB,
          rollupOptions: {
            input: [VIRTUAL_BUILD_TRIGGER_ID],
          },
        },
      };
    },

    configResolved(cfg) {
      state.viteRoot = cfg.root;
      if (cfg.resolve?.alias && !state.ctx.phase1.userResolveAlias) {
        state.ctx.phase1.userResolveAlias = cfg.resolve.alias;
      }
      // v0.14.6: Generate placeholder entry code with empty routes in configResolved.
      // This is a Vite requirement - the virtual entry must exist before buildStart().
      // The real entry with actual routes is generated in buildStart() which runs later.
      // The returned code string is discarded: the call's job is to populate
      // entryDescriptor, which virtualEntryPlugin.load() renders from.
      generateEntry(
        state,
        [],
        state.ctx.phase1.islandTagNames,
        state.ctx.phase1.packageManifests,
        state.ctx.phase1.islandFiles,
      );
    },
  };
}
