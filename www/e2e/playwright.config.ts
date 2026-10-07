/**
 * Playwright configuration for openElement E2E tests.
 *
 * Tests run against the built site (static HTML).
 * Uses a simple HTTP server instead of Vite preview (which may fail
 * in CI due to config resolution issues).
 *
 * Prerequisites:
 *   1. pnpm run site:build   (build the site to www/dist/)
 *
 * Run: pnpm --dir www run e2e:browsers
 */
import { test as base, defineConfig } from '@playwright/test';
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
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Failure evidence lands in test-results/ for the CI artifact upload.
    screenshot: 'only-on-failure',
  },

  // Auto-start the node static file server (www/e2e/static-server.ts, a
  // node:* port — the fresh-clone runner has no deno binary) for www/dist/.
  // Callers that need parallel isolation can pass openElement_E2E_PORT.  A
  // deterministic default keeps the server and all workers on the same URL.
  // Applied to every test context: abort requests to the font CDN and analytics
// endpoints so external availability can never stall page load assertions.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/cdn\.jsdelivr\.net|goatcounter\.com|gc\.zgo\.at/, route =>
      route.abort(),
    );
    await use(page);
  },
});

webServer: {
    // `exec` prevents the shell Playwright launches from orphaning the
    // server when the suite finishes or is interrupted. Node direct-runs the
    // .ts entry (type stripping), the same as every other www script.
    command: `exec node static-server.ts --port ${PORT} --dir ../dist`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // E2E must not depend on third-party availability: resolve the
        // GoatCounter endpoints AND the font CDN (#1554) to nowhere so the
        // page load event never waits on an external fetch (hangs on networks
        // where the domain is unreachable; the font stylesheets are
        // render-blocking, so an unreachable CDN would otherwise stall first
        // paint instead of falling back to system fonts). Chromium-only
        // switch — WebKit rejects unknown launch args at browserType.launch,
        // so this must not live in the shared use.
        launchOptions: {
          args: [
            '--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND, MAP openelement.goatcounter.com ~NOTFOUND, MAP cdn.jsdelivr.net ~NOTFOUND',
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

  // Cross-browser CDN blocking (#1554 font delivery): render-blocking
  // jsDelivr stylesheets stall networkidle on unreachable networks. The
  // Chromium --host-resolver-rules above covers its engine; this context
  // fixture covers Firefox and WebKit, which reject that launch arg.
});
