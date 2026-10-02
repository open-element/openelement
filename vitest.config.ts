/**
 * Vitest runner topology (B3 test migration, step 1 — infrastructure only).
 *
 * One project per existing `deno test` universe, so per-area filters
 * (`--project router`) and per-project settings stay possible after the
 * codemod (tools/repo/codemod-deno-test-to-vitest.ts) converts registration.
 * The Deno runner is untouched by this file: it stays authoritative until a
 * later B3 step flips the cutover, which is why nothing here is wired into
 * the `test` / `verify` gate scripts yet.
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
 * benchmarks/ keeps `deno test` (root `bench` script) and is deliberately
 * not a project. `element-browser` is the vitest-browser-mode replacement
 * for the @web/test-runner universe in packages/element/__wtr__ (#1333
 * conformance suite): chai-based suites are collected from the same files
 * until the port lands, served against the working-tree runtime source
 * exactly as the wtr config did.
 */
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    projects: [
      {
        test: { name: 'element', include: ['packages/element/__tests__/**/*.test.ts'] },
      },
      {
        test: { name: 'router', include: ['packages/router/__tests__/**/*.test.ts'] },
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
        },
      },
      {
        test: { name: 'tests', include: ['tests/fixtures/web-component-interop/**/*.test.ts'] },
      },
      {
        resolve: {
          alias: [
            // Same working-tree contract as __wtr__/web-test-runner.config.js:
            // the bare runtime specifier and the two production ui source
            // modules served from packages/ui/src resolve to THIS tree.
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
          // The wtr suites follow web-test-runner's injected-globals convention
          // (bare describe/it, chai imported explicitly), so only this project
          // opts into vitest globals — the node projects stay explicit-import
          // (globals: false), matching what the codemod emits.
          globals: true,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
