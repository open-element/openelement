/**
 * Playwright configuration for the site-light-probe fixture (#1148).
 *
 * Tests run against the built fixture app
 * (tests/fixtures/site-light-probe/dist), served as static files by
 * e2e/static-server.ts. The fixture is deliberately minimal: it proves
 * light-mode in-place activation on real public package exports without any
 * Site shell, content collections, or navigation.
 *
 * Prerequisites:
 *   deno task --cwd tests/fixtures/site-light-probe build
 *
 * Run: deno task --cwd tests/fixtures/site-light-probe e2e:browsers
 */
import { defineConfig } from '@playwright/test';
import process from 'node:process';

const PORT = Number(process.env.SITE_LIGHT_PROBE_E2E_PORT ?? 4281);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : '50%',
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: 'test-results',
  timeout: 120_000,

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Auto-start the fixture's static server. `exec` prevents the shell
  // Playwright launches from orphaning Deno when the suite finishes.
  webServer: {
    command:
      `exec deno run --config ../../../../deno.json --allow-read --allow-net --allow-env --deny-ffi --no-prompt static-server.ts --port ${PORT} --dir ../dist`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },

  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
