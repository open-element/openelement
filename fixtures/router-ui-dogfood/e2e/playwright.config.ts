/**
 * Playwright configuration for the @openelement/ui dogfood qualification
 * fixture (#1226, v0.44 Beta.2).
 *
 * Tests run against the built fixture app
 * (fixtures/router-ui-dogfood/dist), served statically by
 * e2e/server.ts.
 *
 * Prerequisites:
 *   deno task fixture:ui-dogfood:build
 *
 * Run: deno task fixture:ui-dogfood:e2e
 */
import { defineConfig } from '@playwright/test';
import process from 'node:process';

const PORT = Number(process.env.UI_DOGFOOD_E2E_PORT ?? 4197);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Serial by design (#1232): one fixture server owns one port, so
  // fullyParallel and workers agree on sequential execution.
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
    // `exec` prevents the shell Playwright launches from orphaning Deno when
    // the suite finishes or is interrupted.
    command:
      `exec deno run --config ../../../deno.json -A server.ts --port ${PORT} --dir ../dist`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
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
