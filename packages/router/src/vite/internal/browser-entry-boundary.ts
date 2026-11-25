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
import ts from 'typescript';
import { errorToEnvelope } from '@openelement/protocol/diagnostics';
import { BrowserEntryBoundaryErrorCode, buildError } from '../../internal/error-codes.ts';
import { recordBuildDiagnostic } from './build-diagnostics.ts';

export { BrowserEntryBoundaryErrorCode } from '../../internal/error-codes.ts';

/** The `node:`-scheme prefix a Node builtin must carry. */
const NODE_BUILTIN_PREFIX = 'node:';
const SERVER_ONLY_SPECIFIER = '@openelement/protocol/server-only';
const SERVER_ONLY_BROWSER_ID = '\0open:server-only';
const SERVER_ONLY_HINT = 'Move the marked module behind a server loader or import only its types.';

/**
 * Is this specifier an explicit Node builtin? `node:` plus a name — the
 * scheme alone (`node:`) is not a builtin, and a bare name is not matched
 * (see the header).
 */
export function isNodeBuiltinSpecifier(specifier: string): boolean {
  return specifier.startsWith(NODE_BUILTIN_PREFIX) && specifier.length > NODE_BUILTIN_PREFIX.length;
}

function importsServerOnly(source: string, file: string): boolean {
  // preProcessFile is a lexical pass. Only a candidate importing the marker
  // needs an AST to distinguish runtime imports from type-only declarations.
  if (
    !ts
      .preProcessFile(source)
      .importedFiles.some(({ fileName }) => fileName === SERVER_ONLY_SPECIFIER)
  ) {
    return false;
  }
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest);
  return parsed.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === SERVER_ONLY_SPECIFIER &&
      statement.importClause?.isTypeOnly !== true,
  );
}

/**
 * Resolve browser module edges before Vite's resolver can externalize them.
 */
export function browserEntryBoundaryPlugin(): Plugin {
  let building = false;
  function rejectServerOnly(importer?: string): never {
    const code = BrowserEntryBoundaryErrorCode.SERVER_ONLY_IMPORT;
    const error = buildError(
      code,
      `[${code}] The browser entry's module graph reaches "${SERVER_ONLY_SPECIFIER}"` +
        `${importer === undefined ? '' : ` from ${importer}`}. ${SERVER_ONLY_HINT}`,
    );
    if (building) {
      recordBuildDiagnostic({
        ...errorToEnvelope(error, { hint: SERVER_ONLY_HINT }),
        ...(importer === undefined ? {} : { file: importer }),
      });
    }
    throw error;
  }
  function checkAuthoredModule(source: string, id: string): void {
    // A generated island keeps only the imports its emitted bindings
    // reference. Check authored marker imports before that transform.
    if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(id.split('?', 1)[0] ?? '')) return;
    if (importsServerOnly(source, id)) rejectServerOnly(id);
  }
  return {
    name: 'open:browser-entry-boundary',
    // Before Vite's own resolver: the browser stub is produced by the core
    // resolve plugin, so a normal-order hook would never see the specifier.
    enforce: 'pre',
    applyToEnvironment: (environment) => environment.config.consumer === 'client',
    config(_config, env) {
      if (env.command !== 'serve') return;
      return {
        optimizeDeps: {
          rolldownOptions: {
            plugins: [
              {
                name: 'open:server-only-dependency-optimizer',
                transform: checkAuthoredModule,
                resolveId(source, importer) {
                  if (source === SERVER_ONLY_SPECIFIER) rejectServerOnly(importer);
                },
              },
            ],
          },
        },
      };
    },
    configResolved: (config) => {
      building = config.command === 'build';
    },
    resolveId(source, importer) {
      if (source === SERVER_ONLY_SPECIFIER) return SERVER_ONLY_BROWSER_ID;
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
    load(id) {
      // A resolve-only metadata walk may inspect server modules while
      // collecting their styles. Only browser loading rejects a resolved edge.
      if (id === SERVER_ONLY_BROWSER_ID) rejectServerOnly();
    },
    transform: checkAuthoredModule,
  };
}
