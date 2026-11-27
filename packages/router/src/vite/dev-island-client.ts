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

import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import process from 'node:process';
import type { Plugin } from 'vite';

import type { FrameworkOptions } from './framework.ts';
import type { OpenElementBuildContext } from './build-context.ts';

import { generateClientEntry } from './internal/ssg/index.ts';
import { resolveElementDocumentServicesModule } from './internal/ssg/entry-client-codegen.ts';
import type { DevLiveStyleSheetGroup } from './internal/ssg/entry-client-codegen.ts';
import { buildClientIslandEntries } from './internal/ssg/client-island-entries.ts';
import { VIRTUAL_RUNTIME_SPECIFIERS } from './internal/ssg/entry-generators.ts';
import { DEFAULT_ISLANDS_DIR } from './internal/paths.ts';
import { compilerBehaviorDeclarations } from './internal/ssg/client-admission.ts';
import { runtimeModulePath } from './internal/runtime-module-path.ts';
import { islandStyleDeclarations } from './internal/island-style-declarations.ts';
import { devAuthoredIslandStyleGraphIds } from './internal/style-assets.ts';

const VIRTUAL_CLIENT_ENTRY_ID = 'virtual:open-client-entry';
// Exported for plugin.ts: the dev watcher invalidates this module when the
// island set changes so the client entry re-renders from the rescan (#1062).
export const RESOLVED_CLIENT_ENTRY_ID = '\0' + VIRTUAL_CLIENT_ENTRY_ID;
const CLIENT_ENTRY_PUBLIC_PATH = 'client/islands/client.js';

/**
 * Pre-bundle framework dependencies that islands may reach on activation.
 * Late optimizer discovery can hold the module graph while Vite starts a new
 * optimization pass, delaying registration and early interaction handling.
 */
export const DEV_RUNTIME_PREBUNDLE_PACKAGES = [
  '@openelement/element',
  '@openelement/router',
] as const;

/**
 * The `node_modules/<name>/package.json` that resolves from `root`, or
 * undefined when the package is not reachable from the project at all.
 * Resolution walks parents like Node does, so a workspace root's link is
 * found from a nested fixture too.
 */
function packageManifestFor(root: string, name: string): string | undefined {
  let dir = resolve(root);
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * True when `<name>` resolves to a copy INSTALLED under the project's own
 * node_modules (a packed consumer), false when it resolves anywhere else —
 * above all a linked workspace package (`packages/<name>` in this repo, the
 * fixture and www development shape).
 *
 * The distinction decides whether pre-bundling is legal: forcing a LINKED
 * package into `optimizeDeps.include` would stop its source edits from
 * reaching the dev server through HMR and could serve a pre-bundled copy
 * beside the source one, which is exactly the identity split the linked
 * shape must not have. A linked package therefore stays excluded, Vite's own
 * linked-package behavior.
 */
function resolvesToInstalledCopy(root: string, name: string): boolean {
  const manifest = packageManifestFor(root, name);
  if (manifest === undefined) return false;
  try {
    const installedPrefix = join(realpathSync(resolve(root)), 'node_modules') + sep;
    return realpathSync(manifest).startsWith(installedPrefix);
  } catch {
    // An unreadable path proves nothing about the install shape: stay on the
    // conservative side (no forced pre-bundle) instead of guessing.
    return false;
  }
}

/**
 * The `optimizeDeps.include` entries for one dev project root: both packages
 * when both are installed copies, otherwise none. All-or-nothing keeps a
 * half-installed tree (one linked, one installed) from pre-bundling the
 * linked half.
 */
export function devRuntimePrebundleInclude(root: string): string[] {
  return DEV_RUNTIME_PREBUNDLE_PACKAGES.every((name) => resolvesToInstalledCopy(root, name))
    ? [...DEV_RUNTIME_PREBUNDLE_PACKAGES]
    : [];
}

// Runtime module paths resolve through the shared runtimeModulePath helper
// (internal/runtime-module-path.ts).

/**
 * The dev live-sheet groups the generated client entry must carry (F16).
 *
 * Each admitted generated island's declared sheets are delivered TWO ways in
 * dev: the SSR document's declarative `<link>` (first paint, no-JS, dev
 * resource endpoint) and a realm-held `CSSStyleSheet` the element adopts. The
 * adopted object is the copy a CSS-only edit re-fills in place (the link's
 * browser cache never moves), so the dev entry must hold it and attach it to
 * the island's constructor — the one seam that reaches an ADOPTED DSD root even
 * though `customElements.define` has already upgraded it.
 *
 * The graph ids are the SAME registry keys the SSR links are built from
 * (`devAuthoredIslandStyleGraphIds` shares the key loop with
 * `devAuthoredIslandStyleUrls`), and the dev style plugin answers them with the
 * live adapter module. Build never computes this list: the built entry is
 * byte-pinned and its sheets are content-addressed assets, not live resources.
 */
function devLiveStyleSheetGroups(): DevLiveStyleSheetGroup[] {
  return islandStyleDeclarations().flatMap((declaration) => {
    const graphIds = devAuthoredIslandStyleGraphIds(declaration);
    return graphIds.length === 0 ? [] : [{ tagName: declaration.tagName, graphIds }];
  });
}

export function devIslandClientPlugin(
  options: FrameworkOptions,
  ctx: OpenElementBuildContext,
): Plugin {
  let base = '/';

  return {
    name: 'open:dev-island-client',
    apply: 'serve',

    // Dev-only, and only for an installed framework copy: the island page's
    // runtime import is discovered late otherwise (see
    // DEV_RUNTIME_PREBUNDLE_PACKAGES). These entries change the dev server's
    // dependency optimization alone — no shipped bytes, no build graph, and
    // the zero-island page still never requests the runtime. A linked
    // workspace package resolves empty here so source HMR stays intact.
    config(userConfig) {
      const include = devRuntimePrebundleInclude(userConfig.root ?? process.cwd());
      if (include.length === 0) return;
      return { optimizeDeps: { include } };
    },

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
        return runtimeModulePath('./ssg/form-enhancement-loader.ts');
      }
      return resolveElementDocumentServicesModule(id);
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
      const devLiveStyleSheets = devLiveStyleSheetGroups();
      return generateClientEntry(islandEntries, {
        enhancedForms,
        specializeScheduler: true,
        // F16 dev live-sheet channel: emitted ONLY when an admitted generated
        // island declares sheets, and only in dev — the build entry never
        // receives this option and must stay byte-identical.
        ...(devLiveStyleSheets.length === 0 ? {} : { devLiveStyleSheets }),
      });
    },
  };
}
