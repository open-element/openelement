/**
 * @openelement/router — dev island client plugin (#951).
 *
 * Production serves the island client entry as a built file at
 * `<base>client/islands/client.js` (cli/build-client.ts), injected into HTML
 * post-build. In dev there is no client build, so the URL used to fall
 * through to the SSR dev server and 500 ("Import
 * 'file:///client/islands/client.js' failed") — the island entry was treated
 * as a file path that does not exist, and islands never hydrated.
 *
 * This plugin (dev only, apply: 'serve') resolves that exact public URL to
 * the virtual client entry and serves the generated client entry code
 * through Vite's normal dev transform pipeline, so island imports, the
 * client runtimes and HMR all behave like any other dev module. The
 * generated SSR entry embeds the matching <script> tag at render time
 * through wrapInDocument's script descriptors (entry-orchestrator.ts,
 * __clientScriptDescriptors).
 */

import process from 'node:process';
import type { Plugin } from 'vite';

import type { FrameworkOptions } from './framework.ts';
import type { OpenElementBuildContext } from './build-context.ts';

import { generateClientEntry, islandsMightUseRegions } from './internal/ssg/index.ts';
import { buildClientIslandEntries } from './internal/ssg/client-island-entries.ts';
import { VIRTUAL_RUNTIME_SPECIFIERS } from './internal/ssg/entry-generators.ts';
import { DEFAULT_ISLANDS_DIR } from './internal/paths.ts';
import { compilerBehaviorDeclarations } from './internal/ssg/client-admission.ts';
import { runtimeModulePath } from './internal/runtime-module-path.ts';
import { ISLAND_ADMISSION } from '@openelement/protocol/island-admission';

const VIRTUAL_CLIENT_ENTRY_ID = 'virtual:open-client-entry';
// Exported for plugin.ts: the dev watcher invalidates this module when the
// island set changes so the client entry re-renders from the rescan (#1062).
export const RESOLVED_CLIENT_ENTRY_ID = '\0' + VIRTUAL_CLIENT_ENTRY_ID;
const CLIENT_ENTRY_PUBLIC_PATH = 'client/islands/client.js';

// Runtime module paths resolve through the shared runtimeModulePath helper
// (internal/runtime-module-path.ts).

export function devIslandClientPlugin(
  options: FrameworkOptions,
  ctx: OpenElementBuildContext,
): Plugin {
  let base = '/';

  return {
    name: 'open:dev-island-client',
    apply: 'serve',

    configResolved(config) {
      base = config.base || '/';
    },

    resolveId(id) {
      // The browser requests the same public URL the build emits; map it to
      // the virtual client entry before Vite tries (and fails) to resolve it
      // as a file under root. Strip the query first: after HMR invalidates
      // the module the browser re-requests it with `?t=` (and Vite may add
      // `?import`), which must still hit this mapping.
      const cleanId = id.split('?', 1)[0].split('#', 1)[0];
      if (
        cleanId === `/${CLIENT_ENTRY_PUBLIC_PATH}` ||
        cleanId === `${base}${CLIENT_ENTRY_PUBLIC_PATH}`
      ) {
        return RESOLVED_CLIENT_ENTRY_ID;
      }
      // #868: the client runtimes resolve to their real source modules (same
      // mapping as build-client.ts) so they transform like any other module.
      if (id === VIRTUAL_RUNTIME_SPECIFIERS.scheduler) {
        return runtimeModulePath('./ssg/island-scheduler.ts');
      }
      if (id === VIRTUAL_RUNTIME_SPECIFIERS.enhance) {
        return runtimeModulePath('./ssg/enhance-client.ts');
      }
      return null;
    },

    load(id) {
      if (id !== RESOLVED_CLIENT_ENTRY_ID) return;
      const root = process.cwd();
      const islandsDir = options.islandsDir || DEFAULT_ISLANDS_DIR;
      // #569: an island-free app with data-open-enhance forms still needs the
      // client entry — it carries the form-enhancement layer.
      const enhancedForms = (ctx.phase1.cachedRoutes ?? []).some(
        (route) => route.type === 'page' && route.hasEnhancedForms === true,
      );
      const islandEntries = buildClientIslandEntries({
        root,
        islandsDir,
        islandTagNames: ctx.phase1.islandTagNames ?? [],
        islandFiles: ctx.phase1.islandFiles ?? [],
        islandMeta: ctx.phase1.islandMeta ?? {},
        packageIslandDecls: ctx.phase1.packageIslandDecls ?? [],
        compilerBehaviorDecls: compilerBehaviorDeclarations(
          ctx.phase1.staticComponents,
          options.island?.upgradeStrategy,
        ),
        upgradeStrategy: options.island?.upgradeStrategy,
      });
      // #1548: same regions scan the production build runs, so dev serves the
      // same entry specialization (and exercises it) instead of diverging
      // from the built bundle. The scan is conservative: any unresolvable
      // island module keeps the builders-carrying entry.
      const mightUseRegions = islandsMightUseRegions({
        root,
        islandsDir,
        islandTagNames: ctx.phase1.islandTagNames ?? [],
        islandFiles: ctx.phase1.islandFiles ?? [],
        packageIslandDecls: ctx.phase1.packageIslandDecls ?? [],
        compilerBehaviorDecls: compilerBehaviorDeclarations(
          ctx.phase1.staticComponents,
          options.island?.upgradeStrategy,
        ),
        staticSidecars: [ISLAND_ADMISSION],
      });
      return generateClientEntry(islandEntries, {
        enhancedForms,
        renderer: options.renderer,
        ...(mightUseRegions ? {} : { includeRegionsRuntime: false }),
      });
    },
  };
}
