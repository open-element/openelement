/**
 * Playwright configuration for the request-time rendering fixture.
 *
 * Tests run against the built fixture app (fixtures/
 * request-time/dist), served by e2e/server.ts: static files from disk,
 * renderIntent 'dynamic' routes delegated to dist/server/index.js.
 *
 * Prerequisites:
 *   deno task fixture:router-request-time:build
 *
 * Run: deno task fixture:router-request-time:e2e
 */
import { defineConfig } from '@playwright/test';
import process from 'node:process';

const PORT = Number(process.env.REQUEST_TIME_E2E_PORT ?? 4180);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Serial by design (#1232): one fixture server owns one port and delegates
  // to dist/server, so fullyParallel and workers agree on sequential runs.
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
      `OPEN_ELEMENT_DISABLE_CSRF=1 exec deno run --config ../../../deno.json -A server.ts --port ${PORT} --dir ../dist`,
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
