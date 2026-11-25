/**
 * browser-entry-boundary.ts — the browser entry's Node boundary (fail closed).
 *
 * The client build's module graph IS the browser's graph: the generated client
 * entry, every admitted island, and everything they import transitively. A
 * `node:*` specifier anywhere in that graph is a defect the bundler does NOT
 * surface as a failure — Vite's browser resolver replaces it with an empty
 * `__vite-browser-external` stub, logs only "Module node:fs has been
 * externalized for browser compatibility", and the build stays green
 * (reproduced on the fixture island: `import 'node:fs';` exits 0). The page
 * then ships and the feature dies at runtime with no build signal at all.
 * Lint may hint; only the build boundary can fail closed.
 *
 * The guard is a `resolveId` hook mounted in the production browser build
 * and the Vite development browser environment. It runs before Vite's own
 * resolver turns the specifier into a stub. `resolveId` is called for
 * every module edge the bundler follows — static and dynamic, direct and
 * transitive — so the whole client entry graph is covered by construction,
 * and the failure names both the specifier and the importing module.
 *
 * Deliberately NOT covered: the server half. A route module's `loader` (or any
 * module only the SSR graph reaches) may import `node:*` — that is the
 * zero-config server-side story — and this plugin is scoped to browser
 * environments. Bare builtin names (`fs`, `path`) are
 * not matched either: `node:` is the explicit, unambiguous spelling, and a
 * bare `fs` may legitimately be a package.
 */

import type { Plugin } from 'vite';
import { buildError } from '../../internal/error-codes.ts';

/** The `node:`-scheme prefix a Node builtin must carry. */
const NODE_BUILTIN_PREFIX = 'node:';

/** Stable code for the one failure this boundary raises. */
export const BrowserEntryBoundaryErrorCode = {
  /**
   * A `node:*` specifier resolved inside the client build's module graph. The
   * build fails instead of letting Vite stub the import to an empty module:
   * the client bundle runs in the browser, where no Node builtin exists.
   */
  NODE_BUILTIN_IMPORT: 'OE_CLIENT_BUILD_BROWSER_ENTRY_NODE_BUILTIN',
} as const;

/**
 * Is this specifier an explicit Node builtin? `node:` plus a name — the
 * scheme alone (`node:`) is not a builtin, and a bare name is not matched
 * (see the header).
 */
export function isNodeBuiltinSpecifier(specifier: string): boolean {
  return specifier.startsWith(NODE_BUILTIN_PREFIX) && specifier.length > NODE_BUILTIN_PREFIX.length;
}

/**
 * Resolve browser module edges before Vite's resolver can externalize them.
 */
export function browserEntryBoundaryPlugin(): Plugin {
  return {
    name: 'open:browser-entry-boundary',
    // Before Vite's own resolver: the browser stub is produced by the core
    // resolve plugin, so a normal-order hook would never see the specifier.
    enforce: 'pre',
    applyToEnvironment: (environment) => environment.config.consumer === 'client',
    resolveId(source, importer) {
      if (!isNodeBuiltinSpecifier(source)) return null;
      throw buildError(
        BrowserEntryBoundaryErrorCode.NODE_BUILTIN_IMPORT,
        `[${BrowserEntryBoundaryErrorCode.NODE_BUILTIN_IMPORT}] The browser entry's module graph ` +
          `imports the Node builtin "${source}" (from ${importer ?? 'the client entry'}). ` +
          'The client bundle runs in the browser, where Node builtins do not exist — Vite would ' +
          'silently replace this import with an empty module, so the page would ship and the ' +
          'feature would only fail at runtime. Move the Node code behind a server-only route ' +
          'loader or API route, or replace it with a browser-safe module. Only the client graph ' +
          'is checked: server-side modules (loaders, API routes, the SSR bundle) may import ' +
          'node:* freely.',
      );
    },
  };
}
