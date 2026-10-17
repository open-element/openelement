/**
 * The dev server's ONE style session (alpha15 A05).
 *
 * Dev has two sheet channels — the document sheet (`dev-style.ts`) and the
 * component sheet (`dev-style-components.ts`) — and they describe the same
 * engine. Building the integration in each plugin gave two generators for one
 * configuration, and a change to the configuration itself reached neither: the
 * component channel's memoized integration was never rebuilt, and the document
 * channel's change identity was made of the theme, the reset policy and the
 * candidate set, none of which a `uno.config.ts` edit moves.
 *
 * One session owns the provider's lifecycle for the whole dev server:
 *
 * - `resolve()` builds the integration on first demand and hands the same one
 *   to both channels. Demand can arrive from an admitted package requirement,
 *   which only the manifest scan makes visible, so the plan is read inside the
 *   builder rather than from `configResolved`.
 * - `attach(server)` installs the ONE watcher subscription that rebuilds the
 *   engine's generator when a configuration input moves and then tells every
 *   channel. The subscription lives here rather than in the channels, so a
 *   rebuild is one event with two listeners instead of two half-rebuilds that
 *   can disagree about which configuration is live.
 *
 * WHICH FILES COUNT AS CONFIGURATION INPUTS. The engine's own loader states
 * them: `loadConfig().sources` is the list `@unocss/vite` itself watches for
 * exactly this purpose (its `ConfigHMRPlugin` does `server.watcher.add(sources)`
 * and reloads on a change), so this session consumes the engine's answer
 * instead of searching for conventional file names itself. The loader reports
 * the configuration file and not its transitive imports, which is also the
 * engine's own coverage — a module the configuration imports is not watched
 * here either, and inventing that search would be inventing policy the engine
 * does not have.
 *
 * The session remembers every path the loader has EVER reported rather than
 * just its current answer: after a configuration file is deleted the loader
 * reports no sources at all, and a watch list that followed it would never see
 * the file come back.
 */

import type { ViteDevServer } from 'vite';
import { realpathSync } from 'node:fs';
import { basename, dirname, sep } from 'node:path';
import { createLogger } from '@openelement/element';
import { createStyleBuildIntegration, type StyleBuildIntegration } from './style-provider.ts';
import { stylePlanForApp } from './style-plan.ts';
import { reportRecoveryFailure } from './build-diagnostics.ts';
import type { OpenPluginState } from '../plugin-config.ts';

const log = createLogger('router-vite:style-session');

/**
 * Set-key discipline for configuration inputs: identity is a fact about the
 * FILE, not about the spelling it was reached through. The engine's loader
 * reports paths as given (`/var/folders/…` under an OS temp root) while the
 * file-events stream reports the realpath (`/private/var/folders/…`), so a
 * plain string set would never recognize its own file's change. Keys are
 * realpaths; a path not yet on disk (a configuration watched from before it
 * existed) falls back to its parent directory's real path plus the entry
 * name, which stays stable across both spellings.
 */
const realKey = (file: string): string => {
  try {
    return realpathSync.native(file);
  } catch {
    try {
      return realpathSync.native(dirname(file)) + sep + basename(file);
    } catch {
      return file;
    }
  }
};

export interface DevStyleSession {
  /** The project root; both channels learn it in `configResolved`. */
  setRoot(root: string): void;
  /** The current integration, built on first demand. */
  resolve(): Promise<StyleBuildIntegration | undefined>;
  /** The current integration once built, for synchronous hooks. */
  current(): StyleBuildIntegration | undefined;
  /** Subscribe to "the engine's configuration moved; both sheets are stale". */
  onConfigurationChange(listener: () => void): void;
  /** Install the session's one watcher subscription (idempotent). */
  attach(server: ViteDevServer): void;
}

export function createDevStyleSession(state: OpenPluginState): DevStyleSession {
  let root: string | undefined;
  let server: ViteDevServer | undefined;
  let integration: StyleBuildIntegration | undefined;
  let building: Promise<StyleBuildIntegration | undefined> | undefined;
  let listening = false;
  /** Every configuration input this session has ever seen. */
  const configurationInputs = new Set<string>();
  const listeners = new Set<() => void>();

  /** Watch one configuration input, whether it exists yet or not. */
  const watch = (file: string): void => {
    const key = realKey(file);
    if (configurationInputs.has(key)) return;
    configurationInputs.add(key);
    server?.watcher.add(file);
  };

  const build = async (): Promise<StyleBuildIntegration | undefined> => {
    const projectRoot = root;
    if (projectRoot === undefined) return undefined;
    const plan = stylePlanForApp(
      state.ctx,
      projectRoot,
      state.resolvedOptions.tailwind,
      state.resolvedOptions.unocss,
    );
    if (plan === undefined) return undefined;
    const resolved = await createStyleBuildIntegration({
      root: projectRoot,
      plan,
      unocss: state.resolvedOptions.unocss,
      componentSheetCandidates: () => state.classCandidates.all(),
      documentCandidates: () => state.classCandidates.allLight(),
      sources: () => new Map(),
    });
    for (const file of resolved.provider.watchFiles) watch(file);
    return resolved;
  };

  const resolve = async (): Promise<StyleBuildIntegration | undefined> => {
    building ??= build().then(
      (resolved) => {
        integration = resolved;
        return resolved;
      },
      (error: unknown) => {
        // A failed build is not cached: the next demand retries, so a broken
        // configuration is fixable without restarting the dev server.
        building = undefined;
        throw error;
      },
    );
    return await building;
  };

  /** Rebuild the engine's generator from the configuration as it is now. */
  const rebuild = async (reason: string): Promise<void> => {
    log.info(`style configuration changed (${reason}) — rebuilding the engine’s generator`);
    building = undefined;
    await resolve();
    for (const listener of listeners) listener();
  };

  return {
    setRoot(value: string) {
      root = value;
    },

    resolve,

    current() {
      return integration;
    },

    onConfigurationChange(listener: () => void) {
      listeners.add(listener);
    },

    attach(value: ViteDevServer) {
      server = value;
      if (listening) return;
      listening = true;
      const react = (file: string): void => {
        if (!configurationInputs.has(realKey(file))) return;
        void rebuild(file).catch((error: unknown) => {
          // The handled rejection is the operator's only signal (#1616): the
          // report names the failure's code per the envelope, and the safe
          // state is stated — the served sheets keep the previously loaded
          // configuration until a fix lands and the next change rebuilds.
          reportRecoveryFailure(
            log,
            `reloading the style configuration after ${file} failed — the served sheets keep ` +
              `the previously loaded configuration`,
            error,
          );
        });
      };
      server.watcher.on('change', react);
      server.watcher.on('add', react);
      server.watcher.on('unlink', react);
      // Inputs learned before the server existed still need registering.
      for (const file of configurationInputs) server.watcher.add(file);
    },
  };
}
