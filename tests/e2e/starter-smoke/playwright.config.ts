/**
 * Playwright configuration for the packed-starter smoke gate (#934/#936).
 *
 * Tests run against the starter generated and built by setup.ts
 * (tests/e2e/starter-smoke/work/my-blog), served by the starter's own `start`
 * command — static dist/ plus request-time routes via dist/server/index.js.
 * This is the exact user surface: everything runs from the packed create
 * tarball output + monorepo framework sources.
 *
 * Prerequisites:
 *   deno task --cwd tests/e2e/starter-smoke setup
 *
 * Run: deno task --cwd tests/e2e/starter-smoke test
 */
import { defineConfig } from '@playwright/test';
import process from 'node:process';

const PORT = Number(process.env.STARTER_SMOKE_PORT ?? 4274);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // dev.spec.ts targets the vite dev server (playwright.dev.config.ts), not
  // the production `start` server this config boots.
  // dev.spec.ts targets the vite dev server, not the production start server.
  testIgnore: 'dev.spec.ts',
  // Serial by design (#1232): one packed starter serves one app on one port,
  // so fullyParallel and workers agree on sequential execution.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // CI-visible reporting (#1232): 'github' annotates failures on the run.
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 60_000,

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // The #942 replay contract is a real-browser contract: the interaction
  // matrix (including the shadow-DSD pre-hydration replay) runs on all
  // three engines. Serial workers share the one packed starter server.
  projects: [
    {
      name: 'chromium',
      // bfcache.spec.ts runs only in the Chrome-channel project below
      // (bundled Chromium ships --disable-back-forward-cache).
      testIgnore: 'bfcache.spec.ts',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      testIgnore: 'bfcache.spec.ts',
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      testIgnore: 'bfcache.spec.ts',
      use: { browserName: 'webkit' },
    },
    // BFCache-capable installed Chrome channel (#943). Bundled Chromium ships
    // with --disable-back-forward-cache, so this is the only lane that can
    // prove the restore contract.
    {
      name: 'chrome-bfcache',
      testMatch: 'bfcache.spec.ts',
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        // Playwright disables BFCache for every Chromium-based launch; a
        // restore is only observable once that default switch is dropped.
        // Headed (xvfb in CI) because Chrome's headless mode does not restore.
        headless: false,
        launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] },
      },
    },
  ],

  webServer: {
    command:
      `exec deno run --config deno.json --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys --allow-ffi --no-prompt ../../../../../packages/router/src/cli/start.ts`,
    cwd: new URL('./work/my-blog', import.meta.url).pathname,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      OPEN_ELEMENT_PORT: String(PORT),
    },
  },
});
