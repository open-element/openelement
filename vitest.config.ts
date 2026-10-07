/**
 * Vitest runner topology (B3 test migration, step 1 — infrastructure only).
 *
 * One project per existing `deno test` universe, so per-area filters
 * (`--project router`) and per-project settings stay possible; test
 * registration is vitest-native (`test`/`describe` imported from `vitest`).
 * The cutover has landed: vitest is the wired runner (root `test`, the
 * gate:source/fast-checks layers, and the release train all drive these
 * projects).
 *
 * Versions (2026-10-02): vitest / @vitest/browser / @vitest/browser-playwright
 * pinned to 5.0.2 — newest of the stable 5.x line older than the workspace
 * `minimumReleaseAge: 4320` guard (5.0.3 shipped 2026-09-30, inside the
 * 3-day window). Peer range `vite ^6.4 || ^7 || ^8` matches vite 8.0.16;
 * engines `^22.12 || ^24 || >=26` match the Node >= 24 floor.
 *
 * Coverage of the Deno.test census (B3 inventory): every existing Deno.test
 * directory maps to exactly one project —
 *   element  packages/element/__tests__ (+ compiled-runtime/-claim/-server,
 *            v044-delivery subdirs)
 *   router   packages/router/__tests__ (+ v044-delivery)
 *   create   packages/create/__tests__
 *   ui       packages/ui/__tests__ + packages/ui/tools
 *   saas     apps/saas/app/__tests__
 *   www      www/__tests__ + www/tools (+ www/tools/lib)
 *   tools    tools/repo + tools/lib + tools/release
 *   tests    tests/fixtures/web-component-interop (the only Deno.test
 *            universe under tests/)
 *   benchmarks benchmarks/micro deterministic self-checks (B3 补漏,
 *            owner ruling: the micro lane migrates onto vitest). The
 *            in-repo benchmark-harness half (10 tests) was removed with the
 *            in-repo js-framework-benchmark surface on 2026-10-03 (owner
 *            ruling; upstream lane on the fork). The
 *            suite is a DOM-free structural check that never launches a
 *            browser, so a plain node project covers it — no
 *            browser-mode adaptation, no skips. benchmarks/streaming is a
 *            manual `node` measurement script, not a test universe.
 * `element-browser` is the vitest-browser-mode owner of the
 * packages/element/__wtr__ conformance suite (#1333): the chai-based suites
 * kept their files and their working-tree runtime aliases
 * (`@openelement/element` → source, the two production ui modules →
 * `packages/ui/src`) when the port landed; the retired web-test-runner
 * install chain is gone from `__wtr__/package.json`.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * Browser-instance matrix for the element-browser project.
 *   default | 'chromium' → [chromium]           (PR-layer subset)
 *   'firefox' | 'webkit' → [that engine]        (single-engine attribution:
 *                                        the browser:negative proofs drive
 *                                        each engine separately in serial, so
 *                                        one failing engine can never
 *                                        masquerade as three proven engines)
 *   'full'               → [chromium, firefox, webkit]  (release matrix)
 * anything else → hard error (fail closed, never a silently smaller run)
 */
function matrixInstances(): Array<{ browser: string }> {
  const matrix = process.env.OE_BROWSER_MATRIX ?? 'chromium';
  switch (matrix) {
    case 'chromium':
    case '':
      return [{ browser: 'chromium' }];
    case 'firefox':
      return [{ browser: 'firefox' }];
    case 'webkit':
      return [{ browser: 'webkit' }];
    case 'full':
      return [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }];
    default:
      throw new Error(`unknown OE_BROWSER_MATRIX: ${matrix}`);
  }
}

/**
 * Launch-failure negative seam (browser:negative only). When
 * OE_BROWSER_LAUNCH_EXECUTABLE is set, the playwright provider is
 * constructed with `launchOptions.executablePath` — the documented provider
 * option (@vitest/browser-playwright exports playwright({ launchOptions });
 * `resolveLaunchOptions` reads ONLY these call-site options, never
 * `browser.providerOptions` from the config tree, so a CLI/`providerOptions`
 * route cannot produce a genuine launch failure) — pointing the browser at
 * the given (deliberately nonexistent) executable. Unset on every real
 * lane: the provider is constructed exactly as before, so normal launch
 * behavior is untouched.
 */
const launchExecutable = process.env.OE_BROWSER_LAUNCH_EXECUTABLE;

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // The deno test runner executed every file in one sequential process; the
    // suites share fixture dists and spawn port-bound servers, so parallel
    // file execution reintroduces races that never existed pre-migration.
    fileParallelism: false,
    projects: [
      {
        // Decorator-syntax suites (compile-decorators, compiled-element-v1)
        // lower through vite 8's oxc transform, which reads the nearest
        // tsconfig — packages/element/tsconfig.json carries
        // experimentalDecorators for exactly this surface (Deno parsed them
        // natively pre-migration).
        // The #1386 emitted-module typecheck tests run a TypeScript program
        // per test; under the coverage lane's instrumentation that exceeds
        // vitest's 5s default, so the project carries the same per-test
        // budget the tools/benchmarks projects already declare.
        test: {
          name: 'element',
          include: ['packages/element/__tests__/**/*.test.ts'],
          // #1548: the Region builders reach the runtime through the regions
          // seam; tests driving the runtime internals install them exactly
          // like the entries do (see install-regions-runtime.ts).
          setupFiles: ['packages/element/__tests__/install-regions-runtime.ts'],
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'compiler',
          // The compiler sources live in packages/compiler since #1557; the
          // element-project suites that pair compile output against the
          // runtime stay in packages/element/__tests__ (cross-package relative
          // imports, test-graph only).
          include: ['packages/compiler/__tests__/**/*.test.ts'],
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'router',
          include: ['packages/router/__tests__/**/*.test.ts'],
          // Router suites spawn real subprocesses per test/hook — cli/start
          // boots, fixture vite SSG builds, dev-server boots — so the 5s/10s
          // defaults only hold on an idle machine (same class as the tools
          // and benchmarks budgets below; observed timing out under a loaded
          // dispatch even though every assertion was correct).
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: { name: 'create', include: ['packages/create/__tests__/**/*.test.ts'] },
      },
      {
        test: {
          name: 'ui',
          include: ['packages/ui/__tests__/**/*.test.ts', 'packages/ui/tools/**/*.test.ts'],
        },
      },
      {
        test: { name: 'saas', include: ['apps/saas/app/__tests__/**/*.test.ts'] },
      },
      {
        test: { name: 'www', include: ['www/__tests__/**/*.test.ts', 'www/tools/**/*.test.ts'] },
      },
      {
        test: {
          name: 'tools',
          include: [
            'tools/repo/**/*.test.ts',
            'tools/lib/**/*.test.ts',
            'tools/release/**/*.test.ts',
          ],
          // the tools suites spawn real pnpm/gate subprocesses (the deno
          // runner had no per-test budget); vitest defaults to 5s
          testTimeout: 120_000,
        },
      },
      {
        test: { name: 'tests', include: ['tests/fixtures/web-component-interop/**/*.test.ts'] },
      },
      {
        test: {
          name: 'benchmarks',
          include: ['benchmarks/micro/**/*.test.ts'],
          // the self-checks drive real compiles and 1k-row Region ops
          // (deterministic counts, but not free); the deno runner had no
          // per-test budget either
          testTimeout: 60_000,
        },
      },
      {
        plugins: [
          {
            // The __wtr__ conformance suite's sheet channel (#1558): the ui
            // fixture modules import their component `.css` sheets, and this
            // dev-graph stand-in for the router build's style-asset plugin
            // hands back the cross-realm sheet adapter (element's
            // StyleSheet over the authored file's bytes) — the same
            // fail-closed shape the real build serves, sized to the suite.
            name: 'open:wtr-css-sheet',
            enforce: 'pre',
            resolveId(source, importer) {
              if (!source.endsWith('.css') || !importer) return null;
              const clean = importer.split('?', 1)[0];
              const directory = clean.slice(0, clean.lastIndexOf('/'));
              const file = `${directory}/${source.replace(/^\.\//, '')}`;
              return `\0oe-wtr-css-sheet:${Buffer.from(file, 'utf8').toString('base64url')}.js`;
            },
            async load(id) {
              if (!id.startsWith('\0oe-wtr-css-sheet:')) return null;
              const file = Buffer.from(
                id.slice('\0oe-wtr-css-sheet:'.length, -'.js'.length),
                'base64url',
              ).toString('utf8');
              const css = await readFile(file, 'utf8');
              return [
                "import { StyleSheet } from '@openelement/element';",
                'const sheet = new StyleSheet();',
                `sheet.replaceSync(${JSON.stringify(css)});`,
                'export default sheet;',
                '',
              ].join('\n');
            },
          },
        ],
        resolve: {
          alias: [
            // The __wtr__ conformance suite's working-tree contract: the bare
            // runtime specifier and the two production ui source modules
            // resolve to THIS tree, never to a published artifact.
            {
              find: '@openelement/element',
              replacement: `${rootDir}packages/element/src/index.ts`,
            },
            {
              find: /^\.\/component-recipes\.ts$/,
              replacement: `${rootDir}packages/ui/src/component-recipes.ts`,
            },
            {
              find: /^\.\/instance-state\.ts$/,
              replacement: `${rootDir}packages/ui/src/instance-state.ts`,
            },
          ],
        },
        test: {
          name: 'element-browser',
          include: ['packages/element/__wtr__/tests/**/*.test.js'],
          // Engine matrix parity with the retired web-test-runner gate:
          // default (PR layer) is chromium; OE_BROWSER_MATRIX=full widens to
          // the chromium+firefox+webkit conformance matrix (release layer).
          // Unknown values fail closed.
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(
              launchExecutable ? { launchOptions: { executablePath: launchExecutable } } : {},
            ),
            instances: matrixInstances(),
          },
          // The wtr suites follow web-test-runner's injected-globals convention
          // (bare describe/it, chai imported explicitly), so only this project
          // opts into vitest globals — the node projects stay explicit-import
          // (globals: false), matching what the codemod emits.
          globals: true,
        },
      },
    ],
  },
});
