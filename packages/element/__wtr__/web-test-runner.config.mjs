/**
 * Element browser conformance config (#1333) — Chromium + Firefox + WebKit
 * via @web/test-runner-playwright.
 *
 * Serving model:
 *   - rootDir is packages/element, so the working-tree runtime source at
 *     /src/** and the suite files at /__wtr__/** are both served directly.
 *   - The compiled fixtures under /__wtr__/generated/*.ts are the official
 *     compiler output (compileElementModule); they still carry TS annotations
 *     exactly as the Vite plugin emits them, and esbuildPlugin lowers them
 *     here the same way Vite's builtin TS lowering does downstream of the
 *     plugin in a real build. No second TSX transform is introduced.
 *   - The bare '@openelement/element' specifier in generated modules resolves
 *     to the workspace runtime (/src/index.ts) via the alias plugin below, so
 *     the suite tests THIS working tree, not a published tarball.
 *   - 'lit' and 'chai' resolve from this directory's own node_modules through
 *     nodeResolve (lit@3.3.3 pinned in package.json).
 */
import { defaultReporter } from '@web/test-runner';
import { playwrightLauncher } from '@web/test-runner-playwright';
import { esbuildPlugin } from '@web/dev-server-esbuild';

const openElementRuntimeAlias = {
  name: 'open-element-runtime-alias',
  resolveImport({ source }) {
    if (source === '@openelement/element') return '/src/index.ts';
    return undefined;
  },
};

/**
 * Zero-test runs must not report success (#1333 exit contract): WTR marks a
 * session passed unless it failed, so a run whose sessions executed zero
 * tests is flipped to failed here, with an explicit error on each session.
 */
const zeroTestsGuard = {
  name: 'zero-tests-guard',
  onTestRunFinished({ sessions }) {
    const total = sessions.reduce(
      (count, session) => count + (session.testResults ? countTests(session.testResults) : 0),
      0,
    );
    if (total === 0) {
      for (const session of sessions) {
        session.passed = false;
        session.errors.push({
          name: 'ZeroTestsError',
          message: 'zero tests executed; refusing to report success',
        });
      }
      console.error('zero-tests-guard: run executed 0 tests; marking the run as failed');
    }
  },
};

function countTests(suite) {
  return suite.tests.length + suite.suites.reduce((count, child) => count + countTests(child), 0);
}

export default {
  rootDir: new URL('../', import.meta.url).pathname,
  nodeResolve: true,
  files: ['tests/**/*.test.js'],
  // Trusted-input cases (sendKeys/sendMouse round-trip through the Playwright
  // driver) need more than mocha's 2s default; every wait is still a bounded
  // predicate poll, never a sleep.
  testFramework: { config: { timeout: 15000 } },
  browsers: [
    playwrightLauncher({ product: 'chromium' }),
    playwrightLauncher({ product: 'firefox' }),
    playwrightLauncher({ product: 'webkit' }),
  ],
  plugins: [openElementRuntimeAlias, esbuildPlugin({ ts: true, target: 'es2022' })],
  reporters: [defaultReporter(), zeroTestsGuard],
  // The dev build of lit (resolved by default) logs a one-line dev-mode
  // notice per page; filter exactly that notice, keep every other log.
  filterBrowserLogs({ args }) {
    return !(typeof args[0] === 'string' && args[0].startsWith('Lit is in dev mode.'));
  },
};
