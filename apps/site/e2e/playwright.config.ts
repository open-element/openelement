/**
 * Playwright configuration for openElement E2E tests.
 *
 * Tests run against the built www site (static HTML).
 * Uses a simple HTTP server instead of Vite preview (which may fail
 * in CI due to config resolution issues).
 *
 * Prerequisites:
 *   1. deno task build   (build the www site to www/dist/)
 *
 * Run: deno task test:e2e
 */
import { defineConfig } from '@playwright/test';
import process from 'node:process';

// This value must be derived once for both the web server and every worker.
// Deriving it from process.pid makes the workers navigate to different ports.
const PORT = Number(process.env.openElement_E2E_PORT ?? 4174);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // fullyParallel and workers must agree (#1232): fullyParallel with a single
  // worker was a contradiction — parallelism was declared but never allowed.
  // Tests are context-isolated and the static server is read-only, so
  // parallel workers are safe; CI stays conservative on the shared runner.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : '50%',
  // CI-visible reporting (#1232): 'github' annotates failures inline on the
  // workflow run; the HTML report is uploaded as a failure artifact by
  // .github/workflows/autoflow-ci.yml and never auto-opens a browser.
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  timeout: 120_000,
  // Visual baselines are product artifacts, not host-OS artifacts. JetBrains
  // Mono is self-hosted and a small pixel allowance absorbs rasterizer-only
  // differences between the macOS authoring environment and Linux CI.
  snapshotPathTemplate: '{snapshotDir}/{testFilePath}-snapshots/{arg}-chromium-canonical{ext}',

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
    },
  },

  use: {
    baseURL,
    trace: 'on-first-retry',
    // Failure evidence lands in test-results/ for the CI artifact upload.
    screenshot: 'only-on-failure',
  },

  // Auto-start a Deno static file server for www/dist/.
  // Callers that need parallel isolation can pass openElement_E2E_PORT.  A
  // deterministic default keeps the server and all workers on the same URL.
  webServer: {
    // `exec` prevents the shell Playwright launches from orphaning Deno when
    // the suite finishes or is interrupted.
    command: `exec deno run -A static-server.ts --port ${PORT} --dir ../dist`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // E2E must not depend on third-party analytics availability: resolve
        // the GoatCounter endpoints to nowhere so the page load event never
        // waits on an external fetch (hangs on networks where the domain is
        // unreachable). Chromium-only switch — WebKit rejects unknown launch
        // args at browserType.launch, so this must not live in the shared use.
        launchOptions: {
          args: [
            '--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND, MAP openelement.goatcounter.com ~NOTFOUND',
          ],
        },
      },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
  ],
});
