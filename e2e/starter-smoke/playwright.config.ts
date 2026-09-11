/**
 * Playwright configuration for the packed-starter smoke gate (#934/#936).
 *
 * Tests run against the starter generated and built by setup.ts
 * (e2e/starter-smoke/work/my-blog), served by the starter's own `start`
 * command — static dist/ plus request-time routes via dist/server/index.js.
 * This is the exact user surface: everything runs from the packed create
 * tarball output + monorepo framework sources.
 *
 * Prerequisites:
 *   deno run -A e2e/starter-smoke/setup.ts
 *
 * Run: deno task test:starter-smoke
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

  webServer: {
    command: `exec deno run --config deno.json -A ../../../../packages/router/src/cli/start.ts`,
    cwd: new URL('./work/my-blog', import.meta.url).pathname,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      OPEN_ELEMENT_PORT: String(PORT),
    },
  },
});
