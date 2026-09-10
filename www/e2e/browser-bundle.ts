/**
 * Bundle a repo TypeScript module into a single ES-module string that a
 * browser probe can import (via a Blob URL) inside page.evaluate.
 *
 * The built www site does not ship the app router/SPA modules, so e2e specs
 * that must exercise their real behavior — not a test-side re-implementation
 * — bundle the actual sources in memory with the project's own Vite.
 */

import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { compileElementProgram } from '../../packages/adapter-vite/src/internal/compiler/semantic-core/compile.ts';

// The SPA/router sources import '@openelement/element' at runtime (`createLogger`,
// and JSX via jsx-runtime). The e2e bare bundle runs with `configFile: false`, so it
// does not inherit the workspace alias that the real www build gets from
// adapter-vite's Vite plugin. Mirror that alias here so Rolldown can resolve the
// package from source. See www/vite.config.ts and packages/adapter-vite workspace-alias.
const ELEMENT_ENTRY = fileURLToPath(
  new URL('../../packages/element/src/index.ts', import.meta.url),
);
const ELEMENT_DIR = fileURLToPath(new URL('../../packages/element/src', import.meta.url));

const bundleCache = new Map<string, Promise<string>>();

/**
 * The defineApp surface used by the browser probes in spa-action.spec.ts and
 * nested-open-button-submit.spec.ts. Shared so the two specs cannot drift.
 */
export interface SpaModule {
  defineApp(options: {
    mode: 'spa';
    routerMode: 'history';
    routes: Array<{
      path: string;
      tagName: string;
      loader?: (ctx: { params: Record<string, string> }) => Promise<unknown>;
      action?: (
        ctx: { params: Record<string, string>; formData?: FormData },
      ) => Promise<unknown>;
    }>;
  }): { mount(selector: string): void; dispose(): void };
}

/** Bundle `entry` (a file: URL) as an unminified ES module, cached per run. */
export function bundleModuleForBrowser(entry: URL): Promise<string> {
  const key = entry.href;
  let cached = bundleCache.get(key);
  if (!cached) {
    cached = (async () => {
      const entryPath = resolve(fileURLToPath(entry));
      const result = await build({
        logLevel: 'silent',
        configFile: false,
        plugins: [{
          name: 'e2e-compiled-element',
          enforce: 'pre',
          transform(code, id) {
            // The browser probe intentionally bundles the real package source,
            // but Vite's bare esbuild pass does not lower the compile-time
            // decorator syntax. Run the same compiled-element boundary used by
            // the product pipeline for a decorated entry before bundling it.
            if (resolve(id.split('?')[0]) !== entryPath || !code.includes('@element(')) {
              return null;
            }
            return compileElementProgram(code, entryPath).code;
          },
        }],
        resolve: {
          // Array form with an exact-match regex for the bare specifier:
          // the object form prefix-matches, so '@openelement/element' would
          // hijack '@openelement/element/jsx-runtime' and rewrite it to
          // '.../index.ts/jsx-runtime' (UNLOADABLE_DEPENDENCY, seen when
          // bundling JSX sources like open-button.tsx for #650).
          alias: [
            {
              find: '@openelement/element/build-utils',
              replacement: resolve(ELEMENT_DIR, 'build-utils.ts'),
            },
            {
              // @openelement/app authoring sources import this subpath
              // (Beta.2.2); mirror it like the other element subpaths.
              find: '@openelement/element/authoring',
              replacement: resolve(ELEMENT_DIR, 'authoring.ts'),
            },
            {
              // The Lit server path imports the pure HTML utilities leaf
              // (Beta.2.2 #1339 boundary); mirror it here.
              find: '@openelement/element/html',
              replacement: resolve(ELEMENT_DIR, 'html.ts'),
            },
            {
              // app SPA/router sources log through the kernel-free logger
              // leaf (Beta.2.2 #1339 boundary); mirror it here.
              find: '@openelement/element/logger',
              replacement: resolve(ELEMENT_DIR, 'logger.ts'),
            },
            {
              find: '@openelement/element/jsx-runtime',
              replacement: resolve(ELEMENT_DIR, 'jsx-runtime.ts'),
            },
            { find: /^@openelement\/element$/, replacement: ELEMENT_ENTRY },
          ],
        },
        esbuild: { jsx: 'automatic', jsxImportSource: '@openelement/element' },
        build: {
          write: false,
          minify: false,
          lib: { entry: fileURLToPath(entry), formats: ['es'], name: 'e2eProbe' },
        },
      });
      const outputs = (Array.isArray(result) ? result : [result]).flatMap((single) =>
        'output' in single ? single.output : []
      );
      const code = outputs
        .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
        .filter(Boolean)
        .join('\n');
      if (!code) throw new Error(`[e2e] empty browser bundle for ${key}`);
      return code;
    })();
    bundleCache.set(key, cached);
  }
  return cached;
}
